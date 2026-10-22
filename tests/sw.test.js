// Executa o service worker de verdade (web-vanilla/sw.js) com Cache API, fetch e `self` simulados.

import assert from 'node:assert/strict';
import test from 'node:test';

import { API_TTL, CACHE_NAME, CACHED_AT_HEADER, MAX_IMAGES, SHELL_FILES } from '../web-vanilla/js/offline.js';
import { ORIGIN, installServiceWorkerFakes } from './fake-sw.js';

const API = 'https://api.themoviedb.org/3/discover/movie?page=1';
const POSTER = 'https://image.tmdb.org/t/p/w342/poster.jpg';

const { stores, flags, network, lifecycle, request } = installServiceWorkerFakes({
  oldCaches: ['movie-app-v0', 'movie-app-ng-v1'],
});

await import('../web-vanilla/sw.js');

const cache = () => stores.get(CACHE_NAME);

test('instalação guarda os arquivos do app e tolera um arquivo ausente', async () => {
  network.respond = (url) =>
    url.endsWith('/config.js') ? new Response('', { status: 404 }) : new Response('conteúdo', { status: 200 });
  await lifecycle('install');

  const saved = [...cache().entries.keys()];
  assert.equal(saved.length, SHELL_FILES.length - 1, 'tudo menos o config.js, que respondeu 404');
  assert.ok(saved.includes(`${ORIGIN}/js/app.js`));
  assert.ok(saved.includes(`${ORIGIN}/`));
  assert.equal(flags.skipWaiting, 1);
});

test('ativação apaga caches de versões antigas e assume as abas abertas', async () => {
  await lifecycle('activate');
  // O cache da versão Angular é da mesma origem, mas não é deste service worker.
  assert.deepEqual([...stores.keys()].sort(), ['movie-app-ng-v1', CACHE_NAME].sort());
  assert.equal(flags.claim, 1);
});

test('API: com rede devolve a resposta nova e guarda uma cópia com data', async () => {
  network.online = true;
  network.respond = () => new Response('{"results":[1]}', { status: 200, headers: { 'content-type': 'application/json' } });
  const response = await request(API);

  assert.equal(response.headers.has(CACHED_AT_HEADER), false, 'resposta da rede não leva a marca de cache');
  assert.deepEqual(await response.json(), { results: [1] });

  const stored = await cache().match(API);
  assert.ok(Number(stored.headers.get(CACHED_AT_HEADER)) > 0);
  assert.equal(stored.headers.get('content-type'), 'application/json');
});

test('API: sem rede devolve a cópia guardada, marcada com a data', async () => {
  network.online = false;
  const response = await request(API);

  assert.ok(response.headers.has(CACHED_AT_HEADER));
  assert.deepEqual(await response.json(), { results: [1] });
});

test('cache cheio (cota) não transforma resposta boa em erro', async () => {
  const put = cache().put;
  cache().put = async () => {
    throw new DOMException('cota', 'QuotaExceededError');
  };
  try {
    network.online = true;
    network.respond = () => new Response('{"novo":true}', { status: 200 });
    assert.deepEqual(await (await request('https://api.themoviedb.org/3/movie/2')).json(), { novo: true });
    network.respond = () => new Response('imagem nova', { status: 200 });
    assert.equal(await (await request('https://image.tmdb.org/t/p/w342/cota.jpg')).text(), 'imagem nova');
  } finally {
    cache().put = put;
  }
});

test('API: cópia vencida é apagada em vez de mostrada', async () => {
  const old = String(Date.now() - API_TTL - 60_000);
  await cache().put(API, new Response('{"velho":true}', { headers: { [CACHED_AT_HEADER]: old } }));
  network.online = false;

  await assert.rejects(request(API), TypeError);
  assert.equal(await cache().match(API), undefined);
});

test('API: sem rede e sem cópia o erro de rede chega ao app', async () => {
  network.online = false;
  await assert.rejects(request('https://api.themoviedb.org/3/movie/1'), TypeError);
});

test('API: resposta de erro (401, 500) não substitui a cópia boa', async () => {
  network.online = true;
  network.respond = () => new Response('{"results":[2]}', { status: 200 });
  await request(API);
  network.respond = () => new Response('{}', { status: 500 });

  assert.equal((await request(API)).status, 500);
  assert.deepEqual(await (await cache().match(API)).json(), { results: [2] });
});

test('pôster: busca na rede uma vez e depois serve do cache, mesmo offline', async () => {
  network.online = true;
  network.respond = () => new Response('imagem', { status: 200 });
  network.calls.length = 0;

  assert.equal(await (await request(POSTER)).text(), 'imagem');
  assert.equal(await (await request(POSTER)).text(), 'imagem');
  assert.equal(network.calls.length, 1);

  network.online = false;
  assert.equal(await (await request(POSTER)).text(), 'imagem');
});

test('pôsteres além do limite expulsam os mais antigos', async () => {
  network.online = true;
  network.respond = () => new Response('i', { status: 200 });
  const poster = (index) => `https://image.tmdb.org/t/p/w342/p${index}.jpg`;
  for (let index = 0; index < MAX_IMAGES + 3; index += 1) {
    await request(poster(index));
  }
  const images = [...cache().entries.keys()].filter((url) => url.startsWith('https://image.tmdb.org/'));

  assert.equal(images.length, MAX_IMAGES);
  assert.equal(images.includes(POSTER), false, 'o mais antigo saiu');
  assert.ok(images.includes(poster(MAX_IMAGES + 2)));
  assert.ok(cache().entries.has(`${ORIGIN}/js/app.js`), 'arquivos do app não entram na conta');
});

test('arquivos do app: rede primeiro, cópia guardada sem prazo quando offline', async () => {
  network.online = true;
  network.respond = () => new Response('versão nova', { status: 200 });
  assert.equal(await (await request(`${ORIGIN}/style.css`)).text(), 'versão nova');

  // Mesmo uma cópia muito antiga do app vale: sem ela a página nem abriria.
  const old = String(Date.now() - 100 * API_TTL);
  await cache().put(`${ORIGIN}/style.css`, new Response('versão guardada', { headers: { [CACHED_AT_HEADER]: old } }));
  network.online = false;
  assert.equal(await (await request(`${ORIGIN}/style.css`)).text(), 'versão guardada');
});

test('o service worker não interfere em outros sites nem em requisições que não são GET', () => {
  assert.equal(request('https://www.youtube-nocookie.com/embed/abc'), undefined);
  assert.equal(request(API, 'POST'), undefined);
  assert.equal(request(`${ORIGIN}/qualquer`, 'HEAD'), undefined);
});
