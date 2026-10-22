// Teste de ponta a ponta num navegador de verdade (Edge ou Chrome já instalados, via Playwright),
// nas duas versões: service worker, modo offline com dados salvos e o aviso, telas sob demanda
// offline (Angular), gêneros completados para as recomendações e link de lista comprimido.
//
// Roda só sob demanda: fica fora do `npm test` e do CI e não instala nada no projeto.
//   1. Instale o playwright-core numa pasta FORA do projeto (ele não baixa navegador):
//        npm install --prefix <pasta> playwright-core
//   2. Para testar a versão Angular, gere o build: cd angular && npm install && npm run build
//   3. Na raiz do projeto:
//        node e2e/offline.e2e.mjs --deps <pasta> [--angular angular/dist/angular/browser]
//                                 [--channel msedge|chrome] [--headed]
//
// O TMDB é simulado pelo próprio teste (nenhuma requisição sai para a internet) e a chave usada
// é de mentira, gerada na hora e servida só em memória: nada é gravado em arquivo.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { resolveFile } from '../scripts/serve.mjs';

const { values: options } = parseArgs({
  options: {
    deps: { type: 'string' },
    angular: { type: 'string' },
    channel: { type: 'string', default: 'msedge' },
    headed: { type: 'boolean', default: false },
  },
});

// Sem isto o Playwright não intercepta as requisições feitas pelo próprio service worker.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

function loadPlaywright() {
  const base = options.deps ? join(resolve(options.deps), 'noop.js') : import.meta.url;
  try {
    return createRequire(base)('playwright-core');
  } catch {
    console.error(
      'playwright-core não encontrado. Instale numa pasta fora do projeto e informe com --deps:\n' +
        '  npm install --prefix <pasta> playwright-core\n' +
        '  node e2e/offline.e2e.mjs --deps <pasta>',
    );
    process.exit(1);
  }
}

const { chromium } = loadPlaywright();
const VANILLA = fileURLToPath(new URL('../web-vanilla', import.meta.url));
const ANGULAR = options.angular ? resolve(options.angular) : '';
// Formato de chave v3 (32 hexadecimais), gerada a cada execução e nunca gravada.
const FAKE_KEY = randomBytes(16).toString('hex');
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

/** Rede simulada: o servidor local e o "TMDB" deixam de responder quando `online` é falso. */
const network = { online: true, details: new Map() };

/** Servidor estático da pasta `root`, com a configuração (chave falsa) gerada em memória. */
async function serve(root) {
  const server = createServer(async (request, response) => {
    if (!network.online) {
      request.socket.destroy();
      return;
    }
    const { pathname } = new URL(request.url, 'http://localhost');
    let body;
    let type;
    if (pathname === '/config.js') {
      [body, type] = [`export default { apiKey: '${FAKE_KEY}' };`, TYPES['.js']];
    } else if (pathname === '/config.json') {
      [body, type] = [JSON.stringify({ apiKey: FAKE_KEY }), TYPES['.json']];
    } else {
      const file = resolveFile(root, request.url);
      body = file && existsSync(file) ? await readFile(file).catch(() => null) : null;
      type = TYPES[extname(file ?? '')] ?? 'application/octet-stream';
    }
    if (body === null) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(body);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

const GENRES = {
  movie: [
    { id: 28, name: 'Ação' },
    { id: 878, name: 'Ficção científica' },
  ],
  tv: [{ id: 18, name: 'Drama' }],
};

/** Respostas do TMDB simulado. */
function tmdb(url) {
  const path = url.pathname.replace(/^\/3/, '');
  const genreList = /^\/genre\/(movie|tv)\/list$/.exec(path);
  if (genreList) {
    return { genres: GENRES[genreList[1]] };
  }
  const listing = /^\/(?:discover|search)\/(movie|tv)$/.exec(path);
  if (listing) {
    const genre = Number(url.searchParams.get('with_genres')) || 0;
    const results = [1, 2, 3].map((index) => ({
      id: genre * 100 + index,
      [listing[1] === 'tv' ? 'name' : 'title']: `Título e2e ${genre}-${index}`,
      poster_path: `/poster-${index}.jpg`,
      backdrop_path: `/fundo-${index}.jpg`,
      vote_average: 7.5,
      release_date: '2020-01-01',
      genre_ids: [genre || 28],
    }));
    return { page: 1, total_pages: 1, total_results: results.length, results };
  }
  const details = /^\/(movie|tv)\/(\d+)$/.exec(path);
  if (details) {
    network.details.set(path, (network.details.get(path) ?? 0) + 1);
    return { id: Number(details[2]), title: 'Detalhes e2e', genres: [GENRES.movie[1]] };
  }
  return null;
}

async function newContext(browser) {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  // Qualquer outro endereço é bloqueado: o teste nunca sai para a internet.
  await context.route(
    (url) => url.hostname !== '127.0.0.1',
    (route) => route.abort('blockedbyclient'),
  );
  await context.route('https://image.tmdb.org/**', (route) =>
    network.online
      ? route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })
      : route.abort('internetdisconnected'),
  );
  await context.route('https://api.themoviedb.org/**', (route) => {
    if (!network.online) {
      return route.abort('internetdisconnected');
    }
    const url = new URL(route.request().url());
    assert.equal(url.searchParams.get('api_key'), FAKE_KEY, 'a chave vai em todas as chamadas');
    const body = tmdb(url);
    return route.fulfill({
      status: body ? 200 : 404,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body ?? { status_message: 'não encontrado' }),
    });
  });
  return context;
}

async function setOnline(context, online) {
  network.online = online;
  await context.setOffline(!online);
}

/** Espera o service worker assumir a página (clients.claim) e recarrega para tudo passar por ele. */
async function waitForWorker(page) {
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, {
    timeout: 20_000,
  });
}

const goHash = (page, hash) => page.evaluate((target) => (location.hash = target), hash);

const versions = [
  {
    name: 'web-vanilla',
    root: VANILLA,
    status: '#conexao',
    list: '#/filmes',
    customList: (id) => `#/lista/${id}`,
    importPrefix: '#/lista/importar?d=',
    lazyScreens: [],
  },
  {
    name: 'Angular',
    root: ANGULAR,
    status: '.connection',
    list: '#/filmes',
    customList: (id) => `#/listas/${id}`,
    importPrefix: '#/listas/importar?d=',
    // Telas nunca abertas antes de ficar offline: só abrem se o precache guardou seus blocos.
    lazyScreens: [
      ['#/listas', 'Minhas listas'],
      ['#/chave', 'Configurar a chave do TMDB'],
    ],
  },
];

let browser;
test.before(async () => {
  browser = await chromium.launch({ channel: options.channel, headless: !options.headed });
});
test.after(() => browser?.close());

for (const version of versions) {
  const skip =
    version.root && existsSync(join(version.root, 'index.html'))
      ? false
      : 'sem build do Angular: rode `npm run build` em angular/ e passe --angular';

  test(`${version.name}: offline com dados salvos, gêneros completados e link comprimido`, { skip }, async (t) => {
    const { server, origin } = await serve(version.root);
    const context = await newContext(browser);
    const page = await context.newPage();
    t.after(async () => {
      await context.close();
      server.close();
      network.online = true;
      network.details.clear();
    });

    await t.test('primeira visita registra o service worker e mostra a listagem', async () => {
      await page.goto(`${origin}/${version.list}`);
      await page.locator('.card').first().waitFor();
      await waitForWorker(page);
      await page.reload();
      await page.locator('.card').first().waitFor();
      assert.equal(await page.locator(version.status).isVisible(), false, 'online não há aviso');
    });

    await t.test('offline, a página recarrega com os dados salvos e o aviso com a data', async () => {
      await setOnline(context, false);
      await page.reload();
      await page.locator('.card').first().waitFor();
      assert.equal(await page.locator('.card__title').first().textContent(), 'Título e2e 0-1');
      const status = page.locator(version.status);
      await status.waitFor({ state: 'visible' });
      assert.match(
        (await status.textContent()).trim(),
        /^Você está offline\. Mostrando dados salvos em \d{2}\/\d{2}\/\d{4}/,
      );
    });

    for (const [hash, heading] of version.lazyScreens) {
      await t.test(`offline, ${hash} (nunca aberta) abre pelo precache do build`, async () => {
        await goHash(page, hash);
        await page.locator('main h1', { hasText: heading }).first().waitFor({ timeout: 10_000 });
      });
    }

    await t.test('de volta online, favoritos antigos ganham gêneros e viram recomendação', async () => {
      await setOnline(context, true);
      await page.evaluate(() => {
        const old = { media: 'movie', title: 'Matrix', posterPath: null, rating: 8, date: '' };
        localStorage.setItem('movie-app:favoritos', JSON.stringify([{ id: 603, ...old }]));
      });
      await page.goto(`${origin}/#/recomendacoes`);
      await page.reload();
      await page.locator('.row h2', { hasText: 'Ficção científica · Filmes' }).waitFor();
      assert.equal((await page.locator('.row__why').first().textContent()).trim(), 'Porque você gostou de Matrix.');
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('movie-app:favoritos')));
      assert.deepEqual(saved[0].genreIds, [878]);

      await page.reload();
      await page.locator('.row h2').first().waitFor();
      assert.equal(network.details.get('/movie/603'), 1, 'os detalhes foram buscados uma vez só');
    });

    await t.test('lista longa gera link comprimido que abre a importação', async () => {
      const items = Array.from({ length: 150 }, (_, index) => ({
        id: index + 1,
        media: index % 2 ? 'tv' : 'movie',
        title: `Título de exemplo número ${index + 1}`,
      }));
      await page.evaluate((list) => {
        localStorage.setItem('movie-app:listas', JSON.stringify({ version: 1, lists: [list] }));
      }, { id: 'e2e', name: 'Maratona e2e', items });
      await page.goto(`${origin}/${version.customList('e2e')}`);
      await page.reload();
      const link = page.locator('#link-lista');
      await page.waitForFunction(() => document.querySelector('#link-lista')?.value.includes('d='));
      const url = await link.inputValue();
      const code = url.split('d=')[1];
      assert.ok(url.includes(version.importPrefix + 'z'), 'formato comprimido');
      const plain = Buffer.from(
        JSON.stringify({ v: 1, n: 'Maratona e2e', i: items.map((item) => [item.media === 'tv' ? 1 : 0, item.id, item.title]) }),
      ).toString('base64url');
      assert.ok(code.length < plain.length / 3, `${code.length} contra ${plain.length} sem compressão`);

      await page.evaluate(() => localStorage.removeItem('movie-app:listas'));
      await page.goto(url);
      await page.reload();
      await page.getByText('“Maratona e2e” · 150 títulos').waitFor();
    });
  });
}
