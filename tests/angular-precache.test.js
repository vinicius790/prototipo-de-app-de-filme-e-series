// Lista de precache do service worker Angular gerada a partir do build (angular/scripts/precache.mjs)
// e usada de verdade pelo angular/public/sw.js. Roda sem as dependências do Angular: o "build"
// aqui é uma pasta temporária com arquivos de mentira e nomes com hash.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInThisContext } from 'node:vm';

import { MARKER, buildFiles, injectPrecache } from '../angular/scripts/precache.mjs';
import { ORIGIN, installServiceWorkerFakes } from './fake-sw.js';

const CACHE_NAME = 'movie-app-ng-v1';
const dist = mkdtempSync(join(tmpdir(), 'movie-app-build-'));
test.after(() => rmSync(dist, { recursive: true, force: true }));

const source = readFileSync(new URL('../angular/public/sw.js', import.meta.url), 'utf8');
writeFileSync(join(dist, 'sw.js'), source);
mkdirSync(join(dist, 'media'));
for (const file of [
  'index.html',
  'main-ABC123.js',
  'main-ABC123.js.map',
  'chunk-LISTAS1.js',
  'chunk-RECOM22.js',
  'styles-XYZ.css',
  'media/fonte-1.woff2',
  'config.json',
  'config.example.json',
]) {
  writeFileSync(join(dist, file), file.endsWith('.json') ? '{"apiKey":""}' : 'conteúdo');
}

const EXPECTED = [
  'chunk-LISTAS1.js',
  'chunk-RECOM22.js',
  'main-ABC123.js',
  'media/fonte-1.woff2',
  'styles-XYZ.css',
];

test('o arquivo de origem tem o ponto de injeção e o npm roda o script depois do build', () => {
  assert.ok(source.includes(MARKER));
  const scripts = JSON.parse(readFileSync(new URL('../angular/package.json', import.meta.url), 'utf8')).scripts;
  assert.equal(scripts.postbuild, 'node scripts/precache.mjs');
});

test('a lista tem todos os arquivos do build, menos sw.js, index.html, config e mapas', () => {
  assert.deepEqual(buildFiles(dist), EXPECTED);
  assert.deepEqual(injectPrecache(dist), EXPECTED);
  assert.ok(readFileSync(join(dist, 'sw.js'), 'utf8').includes(`const PRECACHE = ${JSON.stringify(EXPECTED)};`));
  assert.throws(() => injectPrecache(dist), /já foi escrita/, 'rodar de novo no mesmo build avisa');
});

test('instalação guarda todos os blocos do build, inclusive os de rotas sob demanda', async () => {
  const { stores, network, lifecycle, request } = installServiceWorkerFakes();
  network.respond = (url) =>
    new Response(url === `${ORIGIN}/` ? '<script src="main-ABC123.js"></script>' : 'arquivo', { status: 200 });
  runInThisContext(readFileSync(join(dist, 'sw.js'), 'utf8'), { filename: 'dist/sw.js' });

  await lifecycle('install');
  const cache = stores.get(CACHE_NAME);
  assert.deepEqual([...cache.entries.keys()].sort(), [`${ORIGIN}/`, ...EXPECTED.map((file) => `${ORIGIN}/${file}`)].sort());

  // Offline, a tela de listas (bloco carregado sob demanda e nunca aberto) já está guardada.
  network.online = false;
  assert.equal(await (await request(`${ORIGIN}/chunk-LISTAS1.js`)).text(), 'arquivo');

  // Um build novo: a ativação tira os .js/.css do build anterior e deixa o resto.
  await cache.put(`${ORIGIN}/chunk-ANTIGO.js`, new Response('velho'));
  await cache.put(`${ORIGIN}/styles-ANTIGO.css`, new Response('velho'));
  await cache.put(`${ORIGIN}/config.json`, new Response('{}'));
  await cache.put('https://image.tmdb.org/t/p/w342/p.jpg', new Response('img'));
  await lifecycle('activate');
  const kept = [...cache.entries.keys()];
  assert.equal(kept.includes(`${ORIGIN}/chunk-ANTIGO.js`), false);
  assert.equal(kept.includes(`${ORIGIN}/styles-ANTIGO.css`), false);
  for (const url of [`${ORIGIN}/config.json`, 'https://image.tmdb.org/t/p/w342/p.jpg', `${ORIGIN}/main-ABC123.js`]) {
    assert.ok(kept.includes(url), url);
  }
});
