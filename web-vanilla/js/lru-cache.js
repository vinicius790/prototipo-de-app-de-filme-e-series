// Cache LRU (Least Recently Used) com TTL em memória e fallback para IndexedDB/localStorage.
// Mecanismos de resiliência: Retry com Exponential Backoff e Circuit Breaker.
// Compatível com navegadores e ambientes de teste Node.js (sem window/DOM).

export const DEFAULT_MAX_SIZE = 100;
export const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutos
export const STORAGE_PREFIX = 'tmdb_lru_';

/** Erro lançado quando o Circuit Breaker está em estado ABERTO (OPEN). */
export class CircuitBreakerOpenError extends Error {
  constructor(message = 'Circuito aberto: serviço temporariamente indisponível após falhas consecutivas.') {
    super(message);
    this.name = 'CircuitBreakerOpenError';
    this.kind = 'network';
    this.circuitOpen = true;
  }
}

/**
 * Adapter seguro para localStorage.
 * Não quebra caso localStorage esteja desabilitado, em modo anônimo restrito ou no Node.js.
 */
class LocalStorageAdapter {
  constructor(prefix = STORAGE_PREFIX, customStorage = null) {
    this.prefix = prefix;
    this.storage = customStorage ?? (typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null);
  }

  isAvailable() {
    if (!this.storage) return false;
    try {
      const testKey = `${this.prefix}__test__`;
      this.storage.setItem(testKey, '1');
      this.storage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }

  get(key) {
    if (!this.isAvailable()) return null;
    try {
      const raw = this.storage.getItem(this.prefix + key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  set(key, entry) {
    if (!this.isAvailable()) return false;
    try {
      this.storage.setItem(this.prefix + key, JSON.stringify(entry));
      return true;
    } catch {
      return false;
    }
  }

  delete(key) {
    if (!this.isAvailable()) return;
    try {
      this.storage.removeItem(this.prefix + key);
    } catch {
      // Ignora erro
    }
  }

  clear() {
    if (!this.isAvailable()) return;
    try {
      if (typeof this.storage.key === 'function' && typeof this.storage.length === 'number') {
        const toRemove = [];
        for (let i = 0; i < this.storage.length; i++) {
          const k = this.storage.key(i);
          if (k && k.startsWith(this.prefix)) {
            toRemove.push(k);
          }
        }
        for (const k of toRemove) {
          this.storage.removeItem(k);
        }
      }
    } catch {
      // Ignora erro
    }
  }
}

/**
 * Adapter opcional e assíncrono para IndexedDB.
 */
class IndexedDbAdapter {
  constructor(dbName = 'tmdb_cache_db', storeName = 'lru_cache') {
    this.dbName = dbName;
    this.storeName = storeName;
    this._dbPromise = null;
  }

  isAvailable() {
    return typeof globalThis.indexedDB !== 'undefined';
  }

  async _getDb() {
    if (!this.isAvailable()) return null;
    if (this._dbPromise) return this._dbPromise;

    this._dbPromise = new Promise((resolve, reject) => {
      try {
        const req = globalThis.indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName, { keyPath: 'key' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          this._dbPromise = null;
          reject(req.error);
        };
      } catch (err) {
        this._dbPromise = null;
        reject(err);
      }
    }).catch(() => null);

    return this._dbPromise;
  }

  async get(key) {
    const db = await this._getDb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ? req.result.entry : null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async set(key, entry) {
    const db = await this._getDb();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        const req = store.put({ key, entry });
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  async delete(key) {
    const db = await this._getDb();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  async clear() {
    const db = await this._getDb();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}

/**
 * Cache LRU com TTL em memória e fallback com persistência.
 */
export class LruCache {
  /**
   * @param {object} [options]
   * @param {number} [options.maxSize=100] Capacidade máxima de itens mantidos em memória
   * @param {number} [options.ttl=300000] Tempo de vida padrão em milissegundos
   * @param {Storage|null} [options.storage] Storage customizado (ex: localStorage simulado em testes)
   * @param {string} [options.prefix='tmdb_lru_'] Prefixo para as chaves no storage
   * @param {() => number} [options.now] Função para obter timestamp atual
   */
  constructor({
    maxSize = DEFAULT_MAX_SIZE,
    ttl = DEFAULT_TTL_MS,
    storage = null,
    prefix = STORAGE_PREFIX,
    now = () => Date.now(),
  } = {}) {
    this.maxSize = Math.max(1, maxSize);
    this.ttl = Math.max(0, ttl);
    this.prefix = prefix;
    this.now = now;

    // Memória rápida O(1) usando Map (que preserva ordem de inserção)
    this.memory = new Map();

    // Fallbacks
    this.localStorageAdapter = new LocalStorageAdapter(this.prefix, storage);
    this.idbAdapter = new IndexedDbAdapter();

    this.hits = 0;
    this.misses = 0;
  }

  get size() {
    return this.memory.size;
  }

  /**
   * Retorna o valor em cache (síncrono: verifica memória e fallback localStorage).
   */
  get(key) {
    const currentTime = this.now();

    // 1. Verifica memória
    if (this.memory.has(key)) {
      const entry = this.memory.get(key);
      if (entry.expiresAt && entry.expiresAt <= currentTime) {
        this.delete(key);
        this.misses++;
        return null;
      }
      // Reinsere para mover para a posição de mais recentemente usado (MRU)
      this.memory.delete(key);
      entry.accessedAt = currentTime;
      this.memory.set(key, entry);
      this.hits++;
      return entry.value;
    }

    // 2. Fallback síncrono para localStorage
    const stored = this.localStorageAdapter.get(key);
    if (stored) {
      if (stored.expiresAt && stored.expiresAt <= currentTime) {
        this.delete(key);
        this.misses++;
        return null;
      }
      // Recupera para a memória respeitando o limite
      this._insertMemory(key, stored);
      this.hits++;
      return stored.value;
    }

    this.misses++;
    return null;
  }

  /**
   * Retorna o valor em cache de forma assíncrona (verifica memória, IndexedDB e localStorage).
   */
  async getAsync(key) {
    const syncValue = this.get(key);
    if (syncValue !== null) {
      return syncValue;
    }

    // Tenta IndexedDB se disponível
    const idbEntry = await this.idbAdapter.get(key);
    if (idbEntry) {
      const currentTime = this.now();
      if (idbEntry.expiresAt && idbEntry.expiresAt <= currentTime) {
        await this.deleteAsync(key);
        this.misses++;
        return null;
      }
      this._insertMemory(key, idbEntry);
      this.hits++;
      return idbEntry.value;
    }

    return null;
  }

  /**
   * Grava um valor no cache LRU.
   */
  set(key, value, customTtl) {
    const currentTime = this.now();
    const effectiveTtl = Number.isFinite(customTtl) ? customTtl : this.ttl;
    const expiresAt = effectiveTtl > 0 ? currentTime + effectiveTtl : 0;
    const entry = { value, expiresAt, accessedAt: currentTime };

    this._insertMemory(key, entry);

    // Persiste no fallback síncrono
    this.localStorageAdapter.set(key, entry);

    // Se IndexedDB estiver ativo, grava assincronamente sem bloquear
    if (this.idbAdapter.isAvailable()) {
      this.idbAdapter.set(key, entry).catch(() => {});
    }

    return this;
  }

  /**
   * Grava aguardando confirmação no IndexedDB (se disponível).
   */
  async setAsync(key, value, customTtl) {
    this.set(key, value, customTtl);
    if (this.idbAdapter.isAvailable()) {
      const currentTime = this.now();
      const effectiveTtl = Number.isFinite(customTtl) ? customTtl : this.ttl;
      const expiresAt = effectiveTtl > 0 ? currentTime + effectiveTtl : 0;
      await this.idbAdapter.set(key, { value, expiresAt, accessedAt: currentTime });
    }
  }

  _insertMemory(key, entry) {
    if (this.memory.has(key)) {
      this.memory.delete(key);
    } else if (this.memory.size >= this.maxSize) {
      // Remove o item menos recentemente usado (primeira chave do Map)
      const oldestKey = this.memory.keys().next().value;
      if (oldestKey !== undefined) {
        this.memory.delete(oldestKey);
        this.localStorageAdapter.delete(oldestKey);
        if (this.idbAdapter.isAvailable()) {
          this.idbAdapter.delete(oldestKey).catch(() => {});
        }
      }
    }
    this.memory.set(key, entry);
  }

  has(key) {
    return this.get(key) !== null;
  }

  delete(key) {
    this.memory.delete(key);
    this.localStorageAdapter.delete(key);
    if (this.idbAdapter.isAvailable()) {
      this.idbAdapter.delete(key).catch(() => {});
    }
  }

  async deleteAsync(key) {
    this.memory.delete(key);
    this.localStorageAdapter.delete(key);
    await this.idbAdapter.delete(key);
  }

  clear() {
    this.memory.clear();
    this.localStorageAdapter.clear();
    if (this.idbAdapter.isAvailable()) {
      this.idbAdapter.clear().catch(() => {});
    }
  }

  async clearAsync() {
    this.memory.clear();
    this.localStorageAdapter.clear();
    await this.idbAdapter.clear();
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      size: this.memory.size,
      maxSize: this.maxSize,
      ttl: this.ttl,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? Number((this.hits / total).toFixed(4)) : 0,
    };
  }

  pruneExpired() {
    const currentTime = this.now();
    let count = 0;
    for (const [key, entry] of this.memory.entries()) {
      if (entry.expiresAt && entry.expiresAt <= currentTime) {
        this.delete(key);
        count++;
      }
    }
    return count;
  }
}

/**
 * Estados do Circuit Breaker.
 */
export const CircuitState = Object.freeze({
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
});

/**
 * Circuit Breaker para proteção contra falhas em cascata e degradação de rede.
 */
export class CircuitBreaker {
  /**
   * @param {object} [options]
   * @param {number} [options.failureThreshold=5] Número consecutivo de falhas para abrir o circuito
   * @param {number} [options.resetTimeoutMs=10000] Tempo de espera em OPEN antes de testar em HALF_OPEN
   * @param {number} [options.halfOpenSuccessThreshold=2] Sucessos consecutivos necessários em HALF_OPEN para fechar o circuito
   * @param {() => number} [options.now]
   * @param {(err: any) => boolean} [options.isFailure] Identificador de erro que conta como falha do circuito
   */
  constructor({
    failureThreshold = 5,
    resetTimeoutMs = 10000,
    halfOpenSuccessThreshold = 2,
    now = () => Date.now(),
    isFailure = (err) => err?.name !== 'AbortError' && err?.kind !== 'no-key' && err?.kind !== 'auth' && err?.kind !== 'not-found',
  } = {}) {
    this.failureThreshold = Math.max(1, failureThreshold);
    this.resetTimeoutMs = Math.max(100, resetTimeoutMs);
    this.halfOpenSuccessThreshold = Math.max(1, halfOpenSuccessThreshold);
    this.now = now;
    this.isFailure = isFailure;

    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = 0;
  }

  getState() {
    if (this.state === CircuitState.OPEN) {
      if (this.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = CircuitState.HALF_OPEN;
        this.consecutiveSuccesses = 0;
      }
    }
    return this.state;
  }

  isOpen() {
    return this.getState() === CircuitState.OPEN;
  }

  onSuccess() {
    if (this.state === CircuitState.HALF_OPEN) {
      this.consecutiveSuccesses++;
      if (this.consecutiveSuccesses >= this.halfOpenSuccessThreshold) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.consecutiveSuccesses = 0;
      }
    } else {
      this.failureCount = 0;
    }
  }

  onFailure(error) {
    if (!this.isFailure(error)) {
      return;
    }
    this.lastFailureTime = this.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.consecutiveSuccesses = 0;
    } else {
      this.failureCount++;
      if (this.failureCount >= this.failureThreshold) {
        this.state = CircuitState.OPEN;
      }
    }
  }

  async execute(fn) {
    if (this.isOpen()) {
      throw new CircuitBreakerOpenError();
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  reset() {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = 0;
  }
}

/**
 * Função de Retry com Exponential Backoff.
 *
 * @template T
 * @param {() => Promise<T>} fn Operação a ser executada
 * @param {object} [options]
 * @param {number} [options.maxRetries=2] Número máximo de retentativas
 * @param {number} [options.initialDelayMs=50] Atraso inicial em ms
 * @param {number} [options.backoffFactor=2] Fator multiplicador de backoff
 * @param {number} [options.maxDelayMs=1000] Atraso máximo permitido em ms
 * @param {(err: any, attempt: number) => boolean} [options.shouldRetry]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @returns {Promise<T>}
 */
export async function retryWithBackoff(
  fn,
  {
    maxRetries = 2,
    initialDelayMs = 50,
    backoffFactor = 2,
    maxDelayMs = 1000,
    shouldRetry = (err) =>
      err?.name !== 'AbortError' &&
      err?.kind !== 'no-key' &&
      err?.kind !== 'auth' &&
      err?.kind !== 'not-found',
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {},
) {
  let attempt = 0;
  while (true) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= maxRetries || !shouldRetry(error, attempt)) {
        throw error;
      }
      const delay = Math.min(initialDelayMs * Math.pow(backoffFactor, attempt), maxDelayMs);
      attempt++;
      await sleep(delay);
    }
  }
}
