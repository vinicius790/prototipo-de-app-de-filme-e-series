// Executa o service worker da versão Angular (angular/public/sw.js, script clássico servido fora
// do bundle) com Cache API, fetch e `self` simulados. Roda sem as dependências do Angular.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInThisContext } from 'node:vm';

import { ORIGIN, installServiceWorkerFakes } from './fake-sw.js';

const CACHE_NAME = 'movie-app-ng-v1';
const API = 'https://api.themoviedb.org/3/movie/603?language=pt-BR';
const DAY = 24 * 60 * 60 * 1000;

const { stores, flags, network, lifecycle, request } = installServiceWorkerFakes({
  oldCaches: ['movie-app-ng-v0', 'movie-app-v1'],
});
const source = readFileSync(new URL('../angular/public/sw.js', import.meta.url), 'utf8');
runInThisContext(source, { filename: 'angular/public/sw.js' });

const cache = () => stores.get(CACHE_NAME);

// Trecho do index.html gerado pelo `ng build` (nomes com hash).
const INDEX = `<!doctype html><html><head><link rel="stylesheet" href="styles-ABC123.css"></head>
<body><app-root></app-root><script src="main-XYZ789.js" type="module"></script>
<a href="https://www.themoviedb.org/">externo</a></body></html>`;

test('as regras de prazo e de expiração são as mesmas de src/app/core/offline.util.ts', () => {
  const util = readFileSync(new URL('../angular/src/app/core/offline.util.ts', import.meta.url), 'utf8');
  assert.match(util, /API_TTL = 24 \* 60 \* 60 \* 1000/);
  assert.match(source, /API_TTL = 24 \* 60 \* 60 \* 1000/);
  assert.match(util, /CACHED_AT_HEADER = 'x-cached-at'/);
  assert.match(source, /CACHED_AT_HEADER = 'x-cached-at'/);
});

// Módulos no formato do esbuild do Angular: importações estáticas e dinâmicas, minificadas.
const MODULES = {
  [`${ORIGIN}/`]: INDEX,
  [`${ORIGIN}/main-XYZ789.js`]:
    `import{a as b}from"./chunk-COMUM.js";const r=[()=>import("./chunk-LISTAS.js"),()=>import('./chunk-CHAVE.js')];`,
  [`${ORIGIN}/chunk-LISTAS.js`]: 'import{c}from"./chunk-COMUM.js";import("./chunk-FUNDO.js");',
  [`${ORIGIN}/chunk-FUNDO.js`]: 'import("./chunk-LISTAS.js");', // ciclo: não pode travar
  [`${ORIGIN}/chunk-COMUM.js`]: 'export const c=1;',
  [`${ORIGIN}/chunk-CHAVE.js`]: 'export default 1;',
  [`${ORIGIN}/styles-ABC123.css`]: 'body{}',
};

test('sem lista do build (ng build direto), a instalação descobre todos os blocos sozinha', async () => {
  assert.ok(source.includes('const PRECACHE = [];'), 'o arquivo de origem não tem lista injetada');
  network.calls.length = 0;
  network.respond = (url) => new Response(MODULES[url] ?? 'não existe', { status: MODULES[url] ? 200 : 404 });
  await lifecycle('install');

  assert.deepEqual([...cache().entries.keys()].sort(), Object.keys(MODULES).sort());
  assert.equal(network.calls.length, Object.keys(MODULES).length, 'cada arquivo buscado uma vez só');
  assert.equal(flags.skipWaiting, 1);

  // Offline, o bloco de uma tela nunca aberta (sob demanda, dois níveis abaixo) já está guardado.
  network.online = false;
  assert.equal(await (await request(`${ORIGIN}/chunk-FUNDO.js`)).text(), MODULES[`${ORIGIN}/chunk-FUNDO.js`]);
  network.online = true;
});

test('ativação apaga caches de versões antigas, mas não o da versão web-vanilla', async () => {
  await lifecycle('activate');
  assert.deepEqual([...stores.keys()].sort(), [CACHE_NAME, 'movie-app-v1'].sort());
  assert.equal(flags.claim, 1);
});

test('API: rede primeiro; sem rede, a cópia marcada com a data; vencida, erro', async () => {
  network.online = true;
  network.respond = () => new Response('{"id":603}', { status: 200 });
  const fresh = await request(API);
  assert.equal(fresh.headers.has('x-cached-at'), false);

  network.online = false;
  const offline = await request(API);
  assert.ok(Number(offline.headers.get('x-cached-at')) > 0);
  assert.deepEqual(await offline.json(), { id: 603 });

  const old = String(Date.now() - DAY - 60_000);
  await cache().put(API, new Response('{}', { headers: { 'x-cached-at': old } }));
  await assert.rejects(request(API), TypeError);
  assert.equal(await cache().match(API), undefined);
});

test('pôster: uma ida à rede e depois só o cache, mesmo offline', async () => {
  const poster = 'https://image.tmdb.org/t/p/w500/poster.jpg';
  network.online = true;
  network.respond = () => new Response('imagem', { status: 200 });
  network.calls.length = 0;
  await request(poster);
  network.online = false;
  assert.equal(await (await request(poster)).text(), 'imagem');
  assert.equal(network.calls.length, 1);
});

test('cache cheio (cota) não transforma resposta boa em erro', async () => {
  const put = cache().put;
  cache().put = async () => {
    throw new DOMException('cota', 'QuotaExceededError');
  };
  try {
    network.online = true;
    network.respond = () => new Response('{"id":2}', { status: 200 });
    assert.deepEqual(await (await request('https://api.themoviedb.org/3/movie/2')).json(), { id: 2 });
    network.respond = () => new Response('imagem nova', { status: 200 });
    assert.equal(await (await request('https://image.tmdb.org/t/p/w500/cota.jpg')).text(), 'imagem nova');
  } finally {
    cache().put = put;
  }
});

test('instalação sem rede não falha: o cache se enche com o uso', async () => {
  network.online = false;
  await lifecycle('install');
  assert.equal(flags.skipWaiting, 2);
});

test('não interfere em outros sites nem em requisições que não são GET', () => {
  assert.equal(request('https://www.youtube-nocookie.com/embed/abc'), undefined);
  assert.equal(request(API, 'POST'), undefined);
});
