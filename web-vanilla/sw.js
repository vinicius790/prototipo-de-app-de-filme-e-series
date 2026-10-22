// Service worker do modo offline (módulo ES, registrado por js/app.js).
// - Arquivos do app e respostas da API: rede primeiro; sem rede, usa a cópia guardada.
// - Pôsteres e fotos do TMDB: cópia guardada primeiro (não mudam), rede só na primeira vez.
// As respostas da API guardadas levam a data no cabeçalho `x-cached-at` e vencem em 24 horas.

import {
  API_TTL,
  CACHE_NAME,
  CACHE_PREFIX,
  CACHED_AT_HEADER,
  MAX_IMAGES,
  SHELL_FILES,
  cachePolicy,
  isExpired,
} from './js/offline.js';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // Um arquivo ausente (config.js é opcional) não pode impedir a instalação.
      .then((cache) => Promise.all(SHELL_FILES.map((file) => cache.add(file).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      // Só os caches antigos desta versão: os da versão Angular, na mesma origem, ficam.
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function stamped(response) {
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT_HEADER, String(Date.now()));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Guardar é opcional: cota cheia não pode transformar uma resposta boa em erro. */
async function store(cache, request, response) {
  try {
    await cache.put(request, response);
    return true;
  } catch {
    return false;
  }
}

/** `ttl` nulo: a cópia não vence (arquivos do app). */
async function networkFirst(request, ttl) {
  const cache = await caches.open(CACHE_NAME);
  let response;
  try {
    response = await fetch(request);
  } catch (error) {
    const cached = await cache.match(request);
    if (cached && (ttl === null || !isExpired(cached.headers.get(CACHED_AT_HEADER), Date.now(), ttl))) {
      return cached;
    }
    if (cached) {
      await cache.delete(request);
    }
    throw error;
  }
  if (response.ok) {
    await store(cache, request, stamped(response.clone()));
  }
  return response;
}

async function trimImages(cache) {
  // keys() devolve na ordem de gravação: os primeiros são os mais antigos.
  const images = (await cache.keys()).filter(
    (request) => cachePolicy(request.url, self.location.origin) === 'image',
  );
  const excess = images.slice(0, Math.max(0, images.length - MAX_IMAGES));
  await Promise.all(excess.map((request) => cache.delete(request)));
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  // <img> de outra origem gera resposta opaca (status 0); ela pode ser guardada mesmo assim.
  if ((response.ok || response.type === 'opaque') && (await store(cache, request, response.clone()))) {
    await trimImages(cache).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const policy = request.method === 'GET' ? cachePolicy(request.url, self.location.origin) : null;
  if (policy === 'image') {
    event.respondWith(cacheFirst(request));
  } else if (policy === 'api') {
    event.respondWith(networkFirst(request, API_TTL));
  } else if (policy === 'shell') {
    event.respondWith(networkFirst(request, null));
  }
});
