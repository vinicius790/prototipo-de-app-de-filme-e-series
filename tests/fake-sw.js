// Ambiente mínimo de service worker para o Node: Cache API, `self`, `fetch` e rede simulados.
// Usado para executar de verdade web-vanilla/sw.js e angular/public/sw.js nos testes.

export const ORIGIN = 'http://localhost:8080';

const urlOf = (request) => (typeof request === 'string' ? new URL(request, `${ORIGIN}/`).href : request.url);

export class FakeCache {
  entries = new Map();

  async match(request) {
    return this.entries.get(urlOf(request))?.clone();
  }

  async put(request, response) {
    const url = urlOf(request);
    this.entries.delete(url);
    this.entries.set(url, response);
  }

  async add(request) {
    const response = await globalThis.fetch(request);
    if (!response.ok) {
      throw new TypeError('resposta sem sucesso');
    }
    await this.put(request, response);
  }

  async delete(request) {
    return this.entries.delete(urlOf(request));
  }

  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
}

/** Instala os globais; carregue o service worker depois disso. */
export function installServiceWorkerFakes({ oldCaches = [] } = {}) {
  const stores = new Map(oldCaches.map((name) => [name, new FakeCache()]));
  globalThis.caches = {
    open: async (name) => stores.get(name) ?? stores.set(name, new FakeCache()).get(name),
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
  };

  const handlers = {};
  const flags = { skipWaiting: 0, claim: 0 };
  globalThis.self = {
    location: { origin: ORIGIN, href: `${ORIGIN}/sw.js` },
    addEventListener: (type, handler) => (handlers[type] = handler),
    skipWaiting: async () => (flags.skipWaiting += 1),
    clients: { claim: async () => (flags.claim += 1) },
  };

  /** `online` desligado faz todo fetch falhar como falharia sem conexão. */
  const network = { online: true, calls: [], respond: () => new Response('{"ok":true}', { status: 200 }) };
  globalThis.fetch = async (request) => {
    const url = urlOf(request);
    network.calls.push(url);
    if (!network.online) {
      throw new TypeError('Failed to fetch');
    }
    return network.respond(url);
  };

  /** Dispara um evento de ciclo de vida e espera o `waitUntil`. */
  async function lifecycle(type) {
    let pending;
    handlers[type]({ waitUntil: (promise) => (pending = promise) });
    await pending;
  }

  /** Dispara um `fetch`; devolve a resposta, ou `undefined` se o service worker não interferiu. */
  function request(url, method = 'GET') {
    let answer;
    handlers.fetch({ request: { url, method }, respondWith: (promise) => (answer = promise) });
    return answer;
  }

  return { stores, handlers, flags, network, lifecycle, request };
}
