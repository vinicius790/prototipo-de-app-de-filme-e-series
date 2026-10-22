import {
  MAX_PAGE,
  buildListRequest,
  clampPage,
  imageUrl,
  normalizeDetails,
  pageRange,
  pickTrailer,
  ratingClass,
  safeUrl,
} from './tmdb.util';

const TODAY = new Date('2026-03-15T12:00:00Z');

describe('buildListRequest', () => {
  it('usa /discover por popularidade como padrão', () => {
    expect(buildListRequest({ media: 'movie' }, TODAY)).toEqual({
      path: '/discover/movie',
      params: { page: '1', include_adult: 'false', sort_by: 'popularity.desc' },
    });
  });

  it('envia o gênero só quando é um id numérico', () => {
    expect(buildListRequest({ media: 'tv', genre: '18' }, TODAY).params['with_genres']).toBe('18');
    // Regressão: o filtro antigo mandava "action", "comedy"... no lugar do id.
    expect(
      'with_genres' in buildListRequest({ media: 'movie', genre: 'action' }, TODAY).params,
    ).toBe(false);
  });

  it('monta a janela de datas de "em cartaz" e "no ar"', () => {
    const movies = buildListRequest({ media: 'movie', list: 'now' }, TODAY).params;
    expect(movies['release_date.gte']).toBe('2026-02-01');
    expect(movies['release_date.lte']).toBe('2026-03-15');

    const series = buildListRequest({ media: 'tv', list: 'now' }, TODAY).params;
    expect(series['air_date.gte']).toBe('2026-03-15');
    expect(series['air_date.lte']).toBe('2026-03-22');
  });

  it('busca por texto usa /search e descarta lista e gênero', () => {
    expect(
      buildListRequest(
        { media: 'tv', list: 'top', genre: '18', query: '  dark  ', page: 4 },
        TODAY,
      ),
    ).toEqual({ path: '/search/tv', params: { page: '4', include_adult: 'false', query: 'dark' } });
  });
});

describe('funções auxiliares', () => {
  it('clampPage mantém a página entre 1 e o limite do TMDB', () => {
    expect([3, '7', 0, -4, 'abc', undefined, 9999].map(clampPage)).toEqual([
      3,
      7,
      1,
      1,
      1,
      1,
      MAX_PAGE,
    ]);
  });

  it('pageRange mostra primeira, última e a vizinhança da atual', () => {
    expect(pageRange(1, 1)).toEqual([1]);
    expect(pageRange(250, 500)).toEqual([1, 'gap', 248, 249, 250, 251, 252, 'gap', 500]);
    expect(pageRange(500, 500)).toEqual([1, 'gap', 498, 499, 500]);
    expect(pageRange(1, 0)).toEqual([]);
  });

  it('imageUrl e safeUrl recusam valores fora do padrão', () => {
    expect(imageUrl('/abc.jpg', 'w500')).toBe('https://image.tmdb.org/t/p/w500/abc.jpg');
    expect(imageUrl('/x.jpg" onerror="alert(1)')).toBeNull();
    expect(imageUrl('//evil.example/x.jpg')).toBeNull();
    expect(imageUrl(null)).toBeNull();
    expect(safeUrl('https://exemplo.com/')).toBe('https://exemplo.com/');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl(undefined)).toBeNull();
  });

  it('pickTrailer prefere trailer a teaser, depois português e oficial', () => {
    const video = (overrides: object) => ({
      site: 'YouTube',
      type: 'Trailer',
      key: 'chave-valida',
      ...overrides,
    });
    expect(pickTrailer([])).toBeNull();
    expect(pickTrailer([video({ site: 'Vimeo' })])).toBeNull();
    expect(pickTrailer([video({ key: '"><script>' })])).toBeNull();
    expect(
      pickTrailer([
        video({ type: 'Teaser', key: 'teaser-pt', iso_639_1: 'pt' }),
        video({ key: 'trailer-en' }),
      ])?.key,
    ).toBe('trailer-en');
    expect(
      pickTrailer([
        video({ key: 'trailer-en', official: true }),
        video({ key: 'trailer-pt', iso_639_1: 'pt' }),
      ])?.key,
    ).toBe('trailer-pt');
  });

  it('ratingClass separa notas altas, médias e baixas', () => {
    expect([8, 7.99, 5, 4.9].map(ratingClass)).toEqual([
      'nota--alta',
      'nota--media',
      'nota--media',
      'nota--baixa',
    ]);
  });

  it('normalizeDetails limita o elenco, descarta link perigoso e separa filme de série', () => {
    const cast = Array.from({ length: 20 }, (_, index) => ({ id: index, name: `Pessoa ${index}` }));
    const movie = normalizeDetails(
      {
        id: 603,
        title: 'Matrix',
        runtime: 136,
        budget: 63000000,
        homepage: 'javascript:alert(1)',
        credits: { cast },
      },
      'movie',
    );
    expect(movie.cast).toHaveLength(12);
    expect(movie.homepage).toBeNull();
    expect(movie.runtime).toBe(136);
    expect(movie.genreIds).toEqual([]);

    const series = normalizeDetails(
      {
        id: 1,
        name: 'Dark',
        first_air_date: '2017-12-01',
        number_of_seasons: 3,
        episode_run_time: [60],
        budget: 9,
        genres: [
          { id: 18, name: 'Drama' },
          { id: 9648, name: 'Mistério' },
        ],
      },
      'tv',
    );
    // Os ids de gênero dos detalhes alimentam as recomendações.
    expect(series.genreIds).toEqual([18, 9648]);
    expect(series.title).toBe('Dark');
    expect(series.date).toBe('2017-12-01');
    expect(series.seasons).toBe(3);
    expect(series.runtime).toBe(60);
    expect(series.budget).toBe(0);
  });
});
