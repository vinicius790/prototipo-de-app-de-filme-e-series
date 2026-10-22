import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  CircuitState,
  LruCache,
  retryWithBackoff,
} from '../web-vanilla/js/lru-cache.js';
import { TmdbError, createClient } from '../web-vanilla/js/api.js';

// -------------------------------------------------------------
// Testes de LruCache
// -------------------------------------------------------------

test('LruCache: gravação e leitura básica em memória', () => {
  const cache = new LruCache({ maxSize: 3, ttl: 1000 });
  cache.set('a', 1);
  cache.set('b', 2);

  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('b'), 2);
  assert.equal(cache.get('inexistente'), null);
  assert.equal(cache.size, 2);
});

test('LruCache: expiração por TTL', () => {
  let currentTime = 1000;
  const cache = new LruCache({ maxSize: 10, ttl: 500, now: () => currentTime });

  cache.set('item', 'valor');
  assert.equal(cache.get('item'), 'valor');

  // Avança tempo dentro do TTL
  currentTime = 1400;
  assert.equal(cache.get('item'), 'valor');

  // Avança tempo após o TTL
  currentTime = 1501;
  assert.equal(cache.get('item'), null);
  assert.equal(cache.has('item'), false);
  assert.equal(cache.size, 0);
});

test('LruCache: expulsão do item menos recentemente usado (LRU)', () => {
  const cache = new LruCache({ maxSize: 3, ttl: 10000 });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);

  // Acessar 'a' torna ele mais recente
  assert.equal(cache.get('a'), 1);

  // Inserir 'd' deve expulsar 'b' (o mais antigo não acessado)
  cache.set('d', 4);

  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('b'), null, "'b' deveria ter sido expulso por LRU");
  assert.equal(cache.get('c'), 3);
  assert.equal(cache.get('d'), 4);
});

test('LruCache: fallback para localStorage quando ausente da memória', () => {
  const fakeStore = new Map();
  const mockStorage = {
    getItem: (key) => fakeStore.get(key) ?? null,
    setItem: (key, val) => fakeStore.set(key, String(val)),
    removeItem: (key) => fakeStore.delete(key),
    clear: () => fakeStore.clear(),
  };

  const cache1 = new LruCache({ maxSize: 2, ttl: 5000, storage: mockStorage, prefix: 'teste_' });
  cache1.set('filme:100', { id: 100, title: 'Inception' });

  // Cria uma nova instância de cache simulando um novo ciclo/sessão
  const cache2 = new LruCache({ maxSize: 2, ttl: 5000, storage: mockStorage, prefix: 'teste_' });
  assert.equal(cache2.size, 0, 'memória da nova instância começa vazia');

  // Busca do storage fallback e popula a memória
  const recovered = cache2.get('filme:100');
  assert.deepEqual(recovered, { id: 100, title: 'Inception' });
  assert.equal(cache2.size, 1, 'item recuperado do fallback foi colocado em memória');
});

test('LruCache: estatísticas de acerto (hit) e erro (miss)', () => {
  const cache = new LruCache({ maxSize: 5, ttl: 1000 });
  cache.set('k1', 'v1');

  cache.get('k1'); // hit
  cache.get('k1'); // hit
  cache.get('k2'); // miss
  cache.get('k3'); // miss

  const stats = cache.getStats();
  assert.equal(stats.hits, 2);
  assert.equal(stats.misses, 2);
  assert.equal(stats.hitRate, 0.5);
});

test('LruCache: pruneExpired remove itens expirados', () => {
  let currentTime = 1000;
  const cache = new LruCache({ maxSize: 5, ttl: 500, now: () => currentTime });

  cache.set('item1', 1);
  cache.set('item2', 2, 2000); // ttl customizado maior

  currentTime = 1600;
  const pruned = cache.pruneExpired();
  assert.equal(pruned, 1);
  assert.equal(cache.get('item1'), null);
  assert.equal(cache.get('item2'), 2);
});

// -------------------------------------------------------------
// Testes de Circuit Breaker
// -------------------------------------------------------------

test('CircuitBreaker: transição para OPEN após falhas consecutivas e fast-fail', async () => {
  let now = 1000;
  const cb = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeoutMs: 5000,
    now: () => now,
  });

  assert.equal(cb.getState(), CircuitState.CLOSED);

  const fail = async () => {
    throw new TmdbError('network');
  };

  // 1ª e 2ª falhas: continua CLOSED
  await assert.rejects(cb.execute(fail));
  await assert.rejects(cb.execute(fail));
  assert.equal(cb.getState(), CircuitState.CLOSED);

  // 3ª falha: abre o circuito
  await assert.rejects(cb.execute(fail));
  assert.equal(cb.getState(), CircuitState.OPEN);
  assert.equal(cb.isOpen(), true);

  // Execuções em OPEN falham imediatamente sem executar a função original
  let called = false;
  await assert.rejects(
    cb.execute(async () => {
      called = true;
    }),
    (err) => err instanceof CircuitBreakerOpenError && err.kind === 'network',
  );
  assert.equal(called, false, 'função não deve ser executada com circuito aberto');
});

test('CircuitBreaker: transição OPEN -> HALF_OPEN -> CLOSED após recuperação', async () => {
  let now = 1000;
  const cb = new CircuitBreaker({
    failureThreshold: 2,
    resetTimeoutMs: 3000,
    halfOpenSuccessThreshold: 2,
    now: () => now,
  });

  const fail = async () => {
    throw new TmdbError('network');
  };
  const succeed = async () => 'sucesso';

  await assert.rejects(cb.execute(fail));
  await assert.rejects(cb.execute(fail));
  assert.equal(cb.getState(), CircuitState.OPEN);

  // Avança o tempo além do resetTimeout
  now = 4500;
  assert.equal(cb.getState(), CircuitState.HALF_OPEN);

  // 1º sucesso em HALF_OPEN
  const r1 = await cb.execute(succeed);
  assert.equal(r1, 'sucesso');
  assert.equal(cb.getState(), CircuitState.HALF_OPEN);

  // 2º sucesso consecutivo: fecha o circuito completamente
  const r2 = await cb.execute(succeed);
  assert.equal(r2, 'sucesso');
  assert.equal(cb.getState(), CircuitState.CLOSED);
});

test('CircuitBreaker: falha em HALF_OPEN reabre o circuito imediatamente', async () => {
  let now = 1000;
  const cb = new CircuitBreaker({
    failureThreshold: 2,
    resetTimeoutMs: 2000,
    halfOpenSuccessThreshold: 2,
    now: () => now,
  });

  const fail = async () => {
    throw new TmdbError('network');
  };

  await assert.rejects(cb.execute(fail));
  await assert.rejects(cb.execute(fail));
  assert.equal(cb.getState(), CircuitState.OPEN);

  // Avança para HALF_OPEN
  now = 3500;
  assert.equal(cb.getState(), CircuitState.HALF_OPEN);

  // Falha na primeira tentativa em HALF_OPEN reabre imediatamente
  await assert.rejects(cb.execute(fail));
  assert.equal(cb.getState(), CircuitState.OPEN);
});

// -------------------------------------------------------------
// Testes de Retry com Exponential Backoff
// -------------------------------------------------------------

test('retryWithBackoff: sucesso sem espera na primeira tentativa', async () => {
  let attempts = 0;
  const delays = [];
  const result = await retryWithBackoff(
    async (attempt) => {
      attempts++;
      return 'ok';
    },
    {
      sleep: async (ms) => delays.push(ms),
    },
  );

  assert.equal(result, 'ok');
  assert.equal(attempts, 1);
  assert.deepEqual(delays, []);
});

test('retryWithBackoff: retentativas com backoff exponencial até o sucesso', async () => {
  let attempts = 0;
  const delays = [];

  const result = await retryWithBackoff(
    async () => {
      attempts++;
      if (attempts < 3) {
        throw new TmdbError('network');
      }
      return 'recuperado';
    },
    {
      maxRetries: 3,
      initialDelayMs: 10,
      backoffFactor: 2,
      sleep: async (ms) => delays.push(ms),
    },
  );

  assert.equal(result, 'recuperado');
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [10, 20]); // 10ms (1ª falha), 20ms (2ª falha)
});

test('retryWithBackoff: esgotamento de retentativas lança erro original', async () => {
  let attempts = 0;
  await assert.rejects(
    retryWithBackoff(
      async () => {
        attempts++;
        throw new TmdbError('network');
      },
      {
        maxRetries: 2,
        initialDelayMs: 5,
        sleep: async () => {},
      },
    ),
    { kind: 'network' },
  );

  assert.equal(attempts, 3); // 1 chamada inicial + 2 retentativas
});

test('retryWithBackoff: erros não-recuperáveis (AbortError, 404, auth) não sofrem retry', async () => {
  let attempts = 0;
  await assert.rejects(
    retryWithBackoff(
      async () => {
        attempts++;
        throw new TmdbError('not-found', 404);
      },
      {
        maxRetries: 3,
        sleep: async () => {},
      },
    ),
    { kind: 'not-found' },
  );

  assert.equal(attempts, 1, 'não deve retentar 404');
});

// -------------------------------------------------------------
// Testes de Integração com o Client do TMDB
// -------------------------------------------------------------

test('Integração TMDB Client: buscas idênticas atingem o cache LRU sem repetir fetch', async () => {
  let fetchCount = 0;
  const fakeFetch = async () => {
    fetchCount++;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        page: 1,
        total_pages: 1,
        total_results: 1,
        results: [{ id: 603, title: 'Matrix', vote_average: 8.4 }],
      }),
    };
  };

  const client = createClient({
    apiKey: 'chave-teste',
    fetch: fakeFetch,
  });

  const res1 = await client.list({ media: 'movie', query: 'Matrix' });
  const res2 = await client.list({ media: 'movie', query: 'Matrix' });

  assert.equal(fetchCount, 1, 'fetch deve ser chamado apenas uma vez devido ao cache');
  assert.equal(res1.items[0].title, 'Matrix');
  assert.equal(res2.items[0].title, 'Matrix');
  assert.equal(client.cache.hits, 1);
});

test('Integração TMDB Client: detalhes com id repetido reutilizam cache', async () => {
  let fetchCount = 0;
  const fakeFetch = async () => {
    fetchCount++;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 603,
        title: 'Matrix',
        overview: 'Um clássico',
        genres: [{ id: 28, name: 'Ação' }],
      }),
    };
  };

  const client = createClient({
    apiKey: 'chave-teste',
    fetch: fakeFetch,
  });

  const d1 = await client.details('movie', 603);
  const d2 = await client.details('movie', 603);

  assert.equal(fetchCount, 1);
  assert.equal(d1.title, 'Matrix');
  assert.equal(d2.title, 'Matrix');
  assert.equal(client.cache.hits, 1);
});

test('Integração TMDB Client: falha de rede temporária sofre retry e tem sucesso', async () => {
  let attempts = 0;
  const fakeFetch = async () => {
    attempts++;
    if (attempts === 1) {
      throw new TypeError('Falha temporária de rede');
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ results: [{ id: 1, title: 'Título Teste' }] }),
    };
  };

  const client = createClient({
    apiKey: 'chave-teste',
    fetch: fakeFetch,
    retryOptions: { maxRetries: 2, initialDelayMs: 5 },
  });

  const res = await client.list({ media: 'movie', query: 'teste' });
  assert.equal(res.items.length, 1);
  assert.equal(attempts, 2, 'deve ter recuperado na 2ª tentativa');
});

test('Integração TMDB Client: circuito abre após falhas contínuas e protege contra sobrecarga', async () => {
  let attempts = 0;
  const fakeFetch = async () => {
    attempts++;
    throw new TypeError('Rede indisponível');
  };

  const cb = new CircuitBreaker({
    failureThreshold: 2,
    resetTimeoutMs: 10000,
  });

  const client = createClient({
    apiKey: 'chave-teste',
    fetch: fakeFetch,
    circuitBreaker: cb,
    retryOptions: { maxRetries: 0 },
  });

  // 1ª chamada falha
  await assert.rejects(client.list({ media: 'movie' }), { kind: 'network' });
  // 2ª chamada falha e abre circuito
  await assert.rejects(client.list({ media: 'movie' }), { kind: 'network' });

  assert.equal(cb.isOpen(), true);

  // 3ª chamada é bloqueada imediatamente pelo Circuit Breaker sem chamar fetch
  const attemptsBefore = attempts;
  await assert.rejects(client.list({ media: 'movie' }), (err) => err instanceof CircuitBreakerOpenError);
  assert.equal(attempts, attemptsBefore, 'fetch não deve ser chamado quando circuito estiver aberto');
});
