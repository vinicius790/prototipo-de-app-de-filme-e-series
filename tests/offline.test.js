import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  API_TTL,
  CACHED_AT_HEADER,
  MAX_IMAGES,
  SHELL_FILES,
  cachePolicy,
  isExpired,
  offlineStatus,
} from '../web-vanilla/js/offline.js';

const APP = 'http://localhost:8080';
const WEB = fileURLToPath(new URL('../web-vanilla/', import.meta.url));

test('cachePolicy separa arquivos do app, API, imagens e o resto', () => {
  assert.equal(cachePolicy(`${APP}/js/app.js`, APP), 'shell');
  assert.equal(cachePolicy(`${APP}/`, APP), 'shell');
  assert.equal(cachePolicy('https://api.themoviedb.org/3/discover/movie?page=1', APP), 'api');
  assert.equal(cachePolicy('https://image.tmdb.org/t/p/w342/poster.jpg', APP), 'image');

  // Nada de YouTube nem de domínios parecidos com os do TMDB.
  assert.equal(cachePolicy('https://www.youtube-nocookie.com/embed/abc', APP), null);
  assert.equal(cachePolicy('https://api.themoviedb.org.exemplo.com/3/x', APP), null);
  assert.equal(cachePolicy('http://api.themoviedb.org/3/x', APP), null);
  assert.equal(cachePolicy('http://localhost:9999/js/app.js', APP), null);
  assert.equal(cachePolicy('não é url', APP), null);
});

test('isExpired vence pelo prazo e trata data ilegível como vencida', () => {
  const now = 1_800_000_000_000;
  assert.equal(isExpired(String(now - 1000), now), false);
  assert.equal(isExpired(now - API_TTL, now), false, 'exatamente no prazo ainda vale');
  assert.equal(isExpired(now - API_TTL - 1, now), true);
  assert.equal(isExpired(now - 5000, now, 1000), true, 'prazo próprio');
  for (const value of [null, '', 'ontem', undefined, Number.NaN]) {
    assert.equal(isExpired(value, now), true);
  }
});

test('offlineStatus: vazio quando está tudo normal, texto nos outros casos', () => {
  const cachedAt = new Date(2026, 4, 6, 7, 8).getTime();

  assert.equal(offlineStatus({ online: true, cachedAt: null }), '');
  assert.match(offlineStatus({ online: false, cachedAt: null }), /^Você está offline\. Só o que foi aberto/);

  const offlineWithData = offlineStatus({ online: false, cachedAt });
  assert.match(offlineWithData, /^Você está offline\. Mostrando dados salvos em 06\/05\/2026/);
  assert.match(offlineWithData, /07:08/);

  // Navegador diz "online", mas a resposta veio do cache: o TMDB não respondeu.
  assert.match(offlineStatus({ online: true, cachedAt }), /^Sem resposta do TMDB\. Mostrando dados salvos em/);
});

test('todos os arquivos do app listados para o cache existem (config.js é opcional)', () => {
  for (const file of SHELL_FILES) {
    if (file === './' || file === 'config.js') {
      continue;
    }
    assert.ok(existsSync(WEB + file), `falta ${file}`);
  }
});

test('todo módulo de js/ está na lista do cache offline', () => {
  const app = readFileSync(`${WEB}js/app.js`, 'utf8');
  const imported = [...app.matchAll(/from '\.\/([\w-]+\.js)'/g)].map((match) => `js/${match[1]}`);
  assert.ok(imported.length >= 5);
  for (const file of [...imported, 'js/app.js', 'index.html', 'style.css']) {
    assert.ok(SHELL_FILES.includes(file), `${file} precisa estar em SHELL_FILES`);
  }
});

test('o service worker usa as regras compartilhadas e é registrado pela página', () => {
  const worker = readFileSync(`${WEB}sw.js`, 'utf8');
  assert.match(worker, /from '\.\/js\/offline\.js'/);
  assert.match(worker, /addEventListener\('fetch'/);
  assert.match(worker, /request\.method === 'GET'/, 'só GET passa pelo cache');

  const app = readFileSync(`${WEB}js/app.js`, 'utf8');
  assert.match(app, /serviceWorker\.register\('sw\.js', \{ type: 'module' \}\)/);
  assert.ok(app.includes('CACHED_AT_HEADER'), 'a página lê a data das respostas guardadas');
  assert.equal(CACHED_AT_HEADER, 'x-cached-at');
  assert.ok(MAX_IMAGES > 0);
});
