// Service worker do modo offline da versão Angular (script clássico, registrado em src/main.ts
// apenas no build de produção). Mesma estratégia do web-vanilla/sw.js:
// - Arquivos do app e respostas da API: rede primeiro; sem rede, usa a cópia guardada.
// - Pôsteres e fotos do TMDB: cópia guardada primeiro (não mudam), rede só na primeira vez.
// As respostas da API guardadas levam a data no cabeçalho `x-cached-at` e vencem em 24 horas.
// As constantes repetem as de src/app/core/offline.util.ts: este arquivo é servido como está,
// fora do bundle, e não pode importar de lá.

// Prefixo dos caches desta versão: na troca de versão só eles são apagados, porque o Cache
// Storage é da origem inteira e a versão web-vanilla (`movie-app-v…`) pode estar na mesma origem.
const CACHE_PREFIX = 'movie-app-ng-v';
const CACHE_NAME = `${CACHE_PREFIX}1`;
const CACHED_AT_HEADER = 'x-cached-at';
const API_TTL = 24 * 60 * 60 * 1000;
const MAX_IMAGES = 300;

// Arquivos do build (com hash no nome), escritos aqui por scripts/precache.mjs depois do
// `ng build` (script `postbuild`). Com eles a instalação guarda também os blocos das rotas
// carregadas sob demanda, e qualquer tela abre offline desde a primeira visita. Vazia (por
// exemplo, num `ng build` rodado sem o npm), a instalação descobre os mesmos arquivos sozinha:
// parte do index.html e segue as importações ("./chunk-….js") de cada módulo.
const PRECACHE = [];
/** Teto da descoberta sem lista, contra um laço de importações inesperado. */
const MAX_DISCOVERED = 500;

/** 'shell' | 'api' | 'image' | null (null: o service worker não se mete). */
function cachePolicy(requestUrl) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.origin === 'https://api.themoviedb.org') {
    return 'api';
  }
  if (url.origin === 'https://image.tmdb.org') {
    return 'image';
  }
  return url.origin === self.location.origin ? 'shell' : null;
}

function isExpired(cachedAt, now, ttl) {
  const time = Number(cachedAt);
  return cachedAt === null || cachedAt === '' || !Number.isFinite(time) || now - time > ttl;
}

function stamped(response) {
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT_HEADER, String(Date.now()));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch('./');
  if (!response.ok) {
    return;
  }
  const html = await response.clone().text();
  await cache.put('./', stamped(response));
  if (PRECACHE.length > 0) {
    await Promise.all(PRECACHE.map((asset) => cache.add(asset).catch(() => {})));
    return;
  }
  const seen = new Set();
  let pending = [...html.matchAll(/(?:src|href)="([^":]+\.(?:js|css))"/g)].map((match) => match[1]);
  while (pending.length > 0) {
    const batch = [...new Set(pending)].filter((asset) => !seen.has(asset));
    pending = [];
    for (const asset of batch.slice(0, MAX_DISCOVERED - seen.size)) {
      seen.add(asset);
    }
    await Promise.all(
      batch
        .filter((asset) => seen.has(asset))
        .map(async (asset) => {
          try {
            const response = await fetch(asset);
            if (!response.ok) {
              return;
            }
            if (asset.endsWith('.js')) {
              const code = await response.clone().text();
              for (const match of code.matchAll(/["'`]\.\/([\w.-]+\.(?:js|css))["'`]/g)) {
                pending.push(match[1]);
              }
            }
            await store(cache, asset, response);
          } catch {
            // Um arquivo que falhou não impede a instalação: ele é guardado quando for usado.
          }
        }),
    );
  }
}

/** Tira do cache os arquivos .js/.css de builds anteriores (os nomes com hash mudam a cada build). */
async function pruneOldBuild() {
  if (PRECACHE.length === 0) {
    return;
  }
  const current = new Set(PRECACHE.map((file) => new URL(file, self.location.href).href));
  const cache = await caches.open(CACHE_NAME);
  const stale = (await cache.keys()).filter((request) => {
    const url = new URL(request.url);
    return (
      url.origin === self.location.origin &&
      /\.(?:js|css)$/.test(url.pathname) &&
      !current.has(url.href)
    );
  });
  await Promise.all(stale.map((request) => cache.delete(request)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    precache()
      // Sem rede na instalação o cache começa vazio e se enche com o uso.
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      // Só os caches antigos desta versão: os da versão web-vanilla, na mesma origem, ficam.
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => pruneOldBuild().catch(() => {}))
      .then(() => self.clients.claim()),
  );
});

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
    if (
      cached &&
      (ttl === null || !isExpired(cached.headers.get(CACHED_AT_HEADER), Date.now(), ttl))
    ) {
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
  const images = (await cache.keys()).filter((request) => cachePolicy(request.url) === 'image');
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
  if (
    (response.ok || response.type === 'opaque') &&
    (await store(cache, request, response.clone()))
  ) {
    await trimImages(cache).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const policy = request.method === 'GET' ? cachePolicy(request.url) : null;
  if (policy === 'image') {
    event.respondWith(cacheFirst(request));
  } else if (policy === 'api') {
    event.respondWith(networkFirst(request, API_TTL));
  } else if (policy === 'shell') {
    event.respondWith(networkFirst(request, null));
  }
});
