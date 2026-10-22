import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_PAGE,
  TmdbError,
  buildListRequest,
  buildUrl,
  clampPage,
  createClient,
  imageUrl,
  isValidKeyFormat,
  pickTrailer,
  safeUrl,
} from '../web-vanilla/js/api.js';

const TEST_KEY = 'chave-de-teste';
const V4_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0ZSJ9.assinatura';
const TODAY = new Date('2026-03-15T12:00:00Z');

/** fetch simulado: guarda as chamadas e responde com o que o teste definir. */
function fakeFetch(respond) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url: new URL(url), options });
    return respond(new URL(url));
  };
  return { fetch, calls };
}

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('buildUrl inclui chave e idioma e codifica o texto da busca', () => {
  const term = 'o "rei" & a rainha?';
  const url = new URL(buildUrl('/search/movie', { query: term, page: 2 }, { apiKey: TEST_KEY }));

  assert.equal(url.origin + url.pathname, 'https://api.themoviedb.org/3/search/movie');
  assert.equal(url.searchParams.get('api_key'), TEST_KEY);
  assert.equal(url.searchParams.get('language'), 'pt-BR');
  assert.equal(url.searchParams.get('page'), '2');
  // Regressão: a URL antiga terminava em `query="` e concatenava o texto sem codificar.
  assert.equal(url.searchParams.get('query'), term);
  assert.ok(!url.href.includes('"'));
});

test('buildUrl omite parâmetros vazios', () => {
  const url = new URL(buildUrl('/discover/movie', { with_genres: '', page: undefined }, { apiKey: TEST_KEY }));
  assert.deepEqual([...url.searchParams.keys()].sort(), ['api_key', 'language']);
});

test('token v4 vai no cabeçalho Authorization e não na URL', async () => {
  const { fetch, calls } = fakeFetch(() => json({ results: [] }));
  await createClient({ apiKey: V4_TOKEN, fetch }).list({ media: 'movie' });

  assert.equal(calls[0].url.searchParams.has('api_key'), false);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${V4_TOKEN}`);
});

test('chave v3 vai na URL e não gera cabeçalho Authorization', async () => {
  const { fetch, calls } = fakeFetch(() => json({ results: [] }));
  await createClient({ apiKey: TEST_KEY, fetch }).list({ media: 'movie' });

  assert.equal(calls[0].url.searchParams.get('api_key'), TEST_KEY);
  assert.equal(calls[0].options.headers.Authorization, undefined);
});

test('clampPage mantém a página entre 1 e o limite do TMDB', () => {
  assert.equal(clampPage(3), 3);
  assert.equal(clampPage('7'), 7);
  assert.equal(clampPage(0), 1);
  assert.equal(clampPage(-4), 1);
  assert.equal(clampPage('abc'), 1);
  assert.equal(clampPage(undefined), 1);
  assert.equal(clampPage(9999), MAX_PAGE);
});

test('listagem padrão usa /discover ordenado por popularidade', () => {
  assert.deepEqual(buildListRequest({ media: 'movie', today: TODAY }), {
    path: '/discover/movie',
    params: { page: 1, include_adult: 'false', sort_by: 'popularity.desc' },
  });
});

test('gênero é enviado como id numérico; nomes são ignorados', () => {
  const withId = buildListRequest({ media: 'tv', genre: '18', today: TODAY });
  assert.equal(withId.params.with_genres, '18');

  // Regressão: o filtro antigo mandava "action", "comedy"... e o TMDB não devolvia nada útil.
  const withName = buildListRequest({ media: 'movie', genre: 'action', today: TODAY });
  assert.equal('with_genres' in withName.params, false);
});

test('"em cartaz" de filmes usa a janela de datas de lançamento', () => {
  const { path, params } = buildListRequest({ media: 'movie', list: 'now', genre: '28', today: TODAY });
  assert.equal(path, '/discover/movie');
  assert.equal(params['release_date.gte'], '2026-02-01');
  assert.equal(params['release_date.lte'], '2026-03-15');
  assert.equal(params.with_release_type, '2|3');
  assert.equal(params.with_genres, '28');
});

test('"no ar" de séries usa os próximos sete dias', () => {
  const { path, params } = buildListRequest({ media: 'tv', list: 'now', today: TODAY });
  assert.equal(path, '/discover/tv');
  assert.equal(params['air_date.gte'], '2026-03-15');
  assert.equal(params['air_date.lte'], '2026-03-22');
});

test('"mais bem avaliados" exige um mínimo de votos', () => {
  const { params } = buildListRequest({ media: 'movie', list: 'top', today: TODAY });
  assert.equal(params.sort_by, 'vote_average.desc');
  assert.equal(params['vote_count.gte'], '200');
});

test('busca por texto usa /search e descarta lista e gênero', () => {
  const request = buildListRequest({ media: 'tv', list: 'top', genre: '18', query: '  dark  ', page: 4 });
  assert.deepEqual(request, {
    path: '/search/tv',
    params: { page: 4, include_adult: 'false', query: 'dark' },
  });
});

test('tipo de mídia inválido é rejeitado', () => {
  assert.throws(() => buildListRequest({ media: 'person' }), TypeError);
});

test('list pede a página certa e normaliza filmes e séries', async () => {
  const { fetch, calls } = fakeFetch((url) =>
    json({
      page: Number(url.searchParams.get('page')),
      total_pages: 48213,
      total_results: 964251,
      results: url.pathname.endsWith('/tv')
        ? [{ id: 2, name: 'Série', first_air_date: '2020-05-01', vote_average: 8.4, poster_path: '/s.jpg', genre_ids: [18, 'x'] }]
        : [{ id: 1, title: 'Filme', release_date: '1999-03-31', vote_average: 7.9, backdrop_path: '/b.jpg' }],
    }),
  );
  const client = createClient({ apiKey: TEST_KEY, fetch, now: () => TODAY });

  const movies = await client.list({ media: 'movie', page: 3 });
  const series = await client.list({ media: 'tv' });

  // Regressão: a URL antiga saía com `<span class="math-inline">...&page=</span>{page}` no lugar da página.
  assert.equal(calls[0].url.searchParams.get('page'), '3');
  assert.ok(!decodeURIComponent(calls[0].url.href).includes('math-inline'));
  assert.equal(movies.page, 3);
  assert.equal(movies.totalPages, MAX_PAGE, 'o TMDB não serve páginas além da 500');
  assert.equal(movies.totalResults, 964251);
  assert.deepEqual(movies.items, [
    {
      id: 1,
      media: 'movie',
      title: 'Filme',
      overview: '',
      posterPath: null,
      backdropPath: '/b.jpg',
      rating: 7.9,
      date: '1999-03-31',
      genreIds: [],
    },
  ]);
  assert.deepEqual(series.items[0].genreIds, [18], 'ids de gênero que não são números inteiros saem');
  assert.equal(series.items[0].title, 'Série');
  assert.equal(series.items[0].date, '2020-05-01');
  assert.equal(series.items[0].media, 'tv');
});

test('resposta sem lista de resultados vira página vazia', async () => {
  const { fetch } = fakeFetch(() => json({}));
  const page = await createClient({ apiKey: TEST_KEY, fetch }).list({ media: 'movie' });
  assert.deepEqual(page, { page: 1, totalPages: 1, totalResults: 0, items: [] });
});

test('erros HTTP viram TmdbError com tipo e mensagem em português', async () => {
  const cases = [
    [401, 'auth'],
    [404, 'not-found'],
    [429, 'rate-limit'],
    [500, 'http'],
  ];
  for (const [status, kind] of cases) {
    const { fetch } = fakeFetch(() => json({ status_message: 'erro' }, status));
    await assert.rejects(createClient({ apiKey: TEST_KEY, fetch }).list({ media: 'movie' }), (error) => {
      assert.ok(error instanceof TmdbError);
      assert.equal(error.kind, kind);
      assert.equal(error.status, status);
      assert.ok(error.message.length > 10);
      return true;
    });
  }
});

test('falha de rede vira erro "network"; cancelamento passa direto', async () => {
  const offline = createClient({
    apiKey: TEST_KEY,
    fetch: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  await assert.rejects(offline.list({ media: 'movie' }), { kind: 'network' });

  const aborted = createClient({
    apiKey: TEST_KEY,
    fetch: async () => {
      throw new DOMException('cancelado', 'AbortError');
    },
  });
  await assert.rejects(aborted.list({ media: 'movie' }), { name: 'AbortError' });
});

test('sem chave nenhuma requisição é feita', async () => {
  const { fetch, calls } = fakeFetch(() => json({}));
  const client = createClient({ fetch });

  assert.equal(client.hasKey, false);
  await assert.rejects(client.list({ media: 'movie' }), { kind: 'no-key' });
  await assert.rejects(client.genres('movie'), { kind: 'no-key' });
  assert.equal(calls.length, 0);
});

test('gêneros vêm da API com ids reais e ficam em cache por tipo de mídia', async () => {
  const { fetch, calls } = fakeFetch((url) =>
    json({ genres: url.pathname.includes('/tv/') ? [{ id: 18, name: 'Drama' }] : [{ id: 28, name: 'Ação' }] }),
  );
  const client = createClient({ apiKey: TEST_KEY, fetch });

  assert.deepEqual(await client.genres('movie'), [{ id: 28, name: 'Ação' }]);
  assert.deepEqual(await client.genres('movie'), [{ id: 28, name: 'Ação' }]);
  assert.deepEqual(await client.genres('tv'), [{ id: 18, name: 'Drama' }]);
  assert.deepEqual(
    calls.map((call) => call.url.pathname),
    ['/3/genre/movie/list', '/3/genre/tv/list'],
  );
});

test('falha ao buscar gêneros não fica em cache', async () => {
  let attempts = 0;
  const { fetch } = fakeFetch(() => {
    attempts += 1;
    return attempts === 1 ? json({}, 500) : json({ genres: [{ id: 35, name: 'Comédia' }] });
  });
  const client = createClient({ apiKey: TEST_KEY, fetch });

  await assert.rejects(client.genres('movie'), { kind: 'http' });
  assert.deepEqual(await client.genres('movie'), [{ id: 35, name: 'Comédia' }]);
});

test('details traz elenco, trailer e campos de filme numa requisição', async () => {
  const cast = Array.from({ length: 20 }, (_, index) => ({
    id: index,
    name: `Pessoa ${index}`,
    character: `Papel ${index}`,
    profile_path: index === 0 ? '/foto.jpg' : null,
  }));
  const { fetch, calls } = fakeFetch(() =>
    json({
      id: 603,
      title: 'Matrix',
      tagline: 'Bem-vindo ao mundo real.',
      genres: [{ id: 28, name: 'Ação' }, { id: 878, name: 'Ficção científica' }],
      runtime: 136,
      budget: 63000000,
      revenue: 463517383,
      status: 'Released',
      homepage: 'javascript:alert(1)',
      credits: { cast },
      videos: { results: [{ site: 'YouTube', type: 'Trailer', key: 'abc123XYZ_-', name: 'Trailer oficial' }] },
    }),
  );
  const details = await createClient({ apiKey: TEST_KEY, fetch }).details('movie', 603);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, '/3/movie/603');
  assert.equal(calls[0].url.searchParams.get('append_to_response'), 'credits,videos');
  assert.equal(details.title, 'Matrix');
  assert.deepEqual(details.genres, ['Ação', 'Ficção científica']);
  assert.equal(details.genreIds.length, 2, 'os detalhes guardam os ids dos gêneros para as recomendações');
  assert.equal(details.runtime, 136);
  assert.equal(details.cast.length, 12);
  assert.deepEqual(details.cast[0], { id: 0, name: 'Pessoa 0', character: 'Papel 0', profilePath: '/foto.jpg' });
  assert.deepEqual(details.trailer, { key: 'abc123XYZ_-', name: 'Trailer oficial' });
  assert.equal(details.homepage, null, 'link com protocolo perigoso é descartado');
});

test('details de série usa temporadas, episódios e duração do episódio', async () => {
  const { fetch } = fakeFetch(() =>
    json({
      id: 1399,
      name: 'Game of Thrones',
      first_air_date: '2011-04-17',
      number_of_seasons: 8,
      number_of_episodes: 73,
      episode_run_time: [60],
      homepage: 'https://www.hbo.com/game-of-thrones',
      budget: 999,
    }),
  );
  const details = await createClient({ apiKey: TEST_KEY, fetch }).details('tv', 1399);

  assert.equal(details.title, 'Game of Thrones');
  assert.equal(details.seasons, 8);
  assert.equal(details.episodes, 73);
  assert.equal(details.runtime, 60);
  assert.equal(details.budget, 0, 'orçamento só existe para filmes');
  assert.equal(details.homepage, 'https://www.hbo.com/game-of-thrones');
  assert.deepEqual(details.cast, []);
  assert.equal(details.trailer, null);
});

test('details recusa id inválido sem chamar a API', async () => {
  const { fetch, calls } = fakeFetch(() => json({}));
  const client = createClient({ apiKey: TEST_KEY, fetch });

  await assert.rejects(client.details('movie', Number.NaN), { kind: 'not-found' });
  await assert.rejects(client.details('movie', -1), { kind: 'not-found' });
  await assert.rejects(client.details('person', 1), { kind: 'not-found' });
  assert.equal(calls.length, 0);
});

test('pickTrailer prefere trailer a teaser, depois português e oficial', () => {
  const video = (overrides) => ({ site: 'YouTube', type: 'Trailer', key: 'chave-valida', ...overrides });

  assert.equal(pickTrailer([]), null);
  assert.equal(pickTrailer(undefined), null);
  assert.equal(pickTrailer([video({ site: 'Vimeo' })]), null);
  assert.equal(pickTrailer([video({ type: 'Featurette' })]), null);
  assert.equal(pickTrailer([video({ key: '"><script>' })]), null, 'chave fora do formato do YouTube');

  assert.equal(
    pickTrailer([video({ type: 'Teaser', key: 'teaser-pt', iso_639_1: 'pt' }), video({ key: 'trailer-en' })]).key,
    'trailer-en',
  );
  assert.equal(
    pickTrailer([video({ key: 'trailer-en', official: true }), video({ key: 'trailer-pt', iso_639_1: 'pt' })]).key,
    'trailer-pt',
  );
  assert.equal(pickTrailer([video({ key: 'comum1' }), video({ key: 'oficial', official: true })]).key, 'oficial');
  assert.equal(pickTrailer([video({ name: '' })]).name, 'Trailer');
});

test('imageUrl só aceita caminhos no formato do TMDB', () => {
  assert.equal(imageUrl('/abc123.jpg'), 'https://image.tmdb.org/t/p/w342/abc123.jpg');
  assert.equal(imageUrl('/abc.jpg', 'w500'), 'https://image.tmdb.org/t/p/w500/abc.jpg');
  assert.equal(imageUrl(null), null);
  assert.equal(imageUrl(''), null);
  assert.equal(imageUrl('/x.jpg" onerror="alert(1)'), null);
  assert.equal(imageUrl('//evil.example/x.jpg'), null);
  assert.equal(imageUrl('/../../x.jpg'), null);
});

test('safeUrl só aceita http e https', () => {
  assert.equal(safeUrl('https://exemplo.com/filme'), 'https://exemplo.com/filme');
  assert.equal(safeUrl('http://exemplo.com/'), 'http://exemplo.com/');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(safeUrl('nao é url'), null);
  assert.equal(safeUrl(''), null);
  assert.equal(safeUrl(null), null);
});

test('isValidKeyFormat reconhece chave v3 e token v4', () => {
  assert.equal(isValidKeyFormat('0123456789abcdef'.repeat(2)), true);
  assert.equal(isValidKeyFormat(V4_TOKEN), true);
  assert.equal(isValidKeyFormat('curta'), false);
  assert.equal(isValidKeyFormat('0123456789abcdef'.repeat(2) + 'g'), false);
  assert.equal(isValidKeyFormat(''), false);
});
