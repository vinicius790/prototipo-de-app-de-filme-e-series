import { HttpClient } from '@angular/common/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { TEST_KEY, loadKey, provideTesting } from '../testing';
import { ConfigService } from './config.service';
import { TmdbError } from './tmdb.interceptor';
import { TmdbService } from './tmdb.service';
import { MAX_PAGE } from './tmdb.util';

const V4_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0ZSJ9.assinatura';

describe('TmdbService + tmdbInterceptor', () => {
  let service: TmdbService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideTesting() });
    service = TestBed.inject(TmdbService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lista com chave, idioma, página e gênero na URL e normaliza a resposta', async () => {
    await loadKey(TEST_KEY);
    const result = firstValueFrom(service.list({ media: 'movie', genre: '28', page: 3 }));

    const request = http.expectOne(
      (req) => req.url === 'https://api.themoviedb.org/3/discover/movie',
    );
    expect(request.request.params.get('api_key')).toBe(TEST_KEY);
    expect(request.request.params.get('language')).toBe('pt-BR');
    expect(request.request.params.get('page')).toBe('3');
    expect(request.request.params.get('with_genres')).toBe('28');
    expect(request.request.headers.has('Authorization')).toBe(false);

    request.flush({
      page: 3,
      total_pages: 48213,
      total_results: 964251,
      results: [
        {
          id: 1,
          title: 'Matrix',
          release_date: '1999-03-31',
          vote_average: 8.2,
          poster_path: '/m.jpg',
        },
      ],
    });
    expect(await result).toEqual({
      page: 3,
      totalPages: MAX_PAGE,
      totalResults: 964251,
      items: [
        {
          id: 1,
          media: 'movie',
          title: 'Matrix',
          overview: '',
          posterPath: '/m.jpg',
          backdropPath: null,
          rating: 8.2,
          date: '1999-03-31',
          genreIds: [],
        },
      ],
    });
  });

  it('codifica o texto da busca', async () => {
    await loadKey(TEST_KEY);
    const term = 'o "rei" & a rainha?';
    service.list({ media: 'tv', query: term }).subscribe();

    const request = http.expectOne((req) => req.url.endsWith('/search/tv'));
    expect(request.request.params.get('query')).toBe(term);
    expect(new URL(request.request.urlWithParams).searchParams.get('query')).toBe(term);
    request.flush({ results: [] });
  });

  it('token v4 vai no cabeçalho Authorization e não na URL', async () => {
    await loadKey(V4_TOKEN);
    service.list({ media: 'movie' }).subscribe();

    const request = http.expectOne((req) => req.url.endsWith('/discover/movie'));
    expect(request.request.params.has('api_key')).toBe(false);
    expect(request.request.headers.get('Authorization')).toBe(`Bearer ${V4_TOKEN}`);
    request.flush({ results: [] });
  });

  it('sem chave nenhuma requisição é feita', async () => {
    await expect(firstValueFrom(service.list({ media: 'movie' }))).rejects.toMatchObject({
      kind: 'no-key',
    });
    http.expectNone(() => true);
  });

  it('config.json ausente significa apenas "sem chave"', async () => {
    const config = TestBed.inject(ConfigService);
    const loading = config.load();
    http.expectOne('config.json').flush('', { status: 404, statusText: 'Not Found' });
    await loading;
    expect(config.hasKey()).toBe(false);
  });

  it('traduz erros HTTP e de rede em TmdbError', async () => {
    await loadKey(TEST_KEY);
    const cases: [number, string][] = [
      [401, 'auth'],
      [404, 'not-found'],
      [429, 'rate-limit'],
      [500, 'http'],
    ];
    for (const [status, kind] of cases) {
      const result = firstValueFrom(service.list({ media: 'movie' }));
      http.expectOne(() => true).flush({}, { status, statusText: 'erro' });
      const error = await result.catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(TmdbError);
      expect(error).toMatchObject({ kind, status });
    }

    const offline = firstValueFrom(service.list({ media: 'movie' }));
    http.expectOne(() => true).error(new ProgressEvent('error'));
    await expect(offline).rejects.toMatchObject({ kind: 'network' });
  });

  it('não envia a chave para outros endereços', async () => {
    await loadKey(TEST_KEY);
    TestBed.inject(HttpClient).get('https://exemplo.com/api').subscribe();

    const request = http.expectOne('https://exemplo.com/api');
    expect(request.request.params.keys()).toEqual([]);
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({});
  });

  it('gêneros vêm da API e ficam em cache; falha não fica', async () => {
    await loadKey(TEST_KEY);
    const failed = firstValueFrom(service.genres('movie'));
    http
      .expectOne((req) => req.url.endsWith('/genre/movie/list'))
      .flush({}, { status: 500, statusText: 'erro' });
    await expect(failed).rejects.toMatchObject({ kind: 'http' });

    const first = firstValueFrom(service.genres('movie'));
    http
      .expectOne((req) => req.url.endsWith('/genre/movie/list'))
      .flush({ genres: [{ id: 28, name: 'Ação' }] });
    expect(await first).toEqual([{ id: 28, name: 'Ação' }]);

    expect(await firstValueFrom(service.genres('movie'))).toEqual([{ id: 28, name: 'Ação' }]);
    http.expectNone((req) => req.url.endsWith('/genre/movie/list'));
  });

  it('details pede elenco e vídeos numa requisição e recusa id inválido', async () => {
    await loadKey(TEST_KEY);
    const result = firstValueFrom(service.details('tv', 1399));

    const request = http.expectOne((req) => req.url === 'https://api.themoviedb.org/3/tv/1399');
    expect(request.request.params.get('append_to_response')).toBe('credits,videos');
    request.flush({
      id: 1399,
      name: 'Game of Thrones',
      videos: {
        results: [{ site: 'YouTube', type: 'Trailer', key: 'abc123XYZ_-', name: 'Trailer' }],
      },
    });
    expect((await result).trailer).toEqual({ key: 'abc123XYZ_-', name: 'Trailer' });

    await expect(firstValueFrom(service.details('movie', 0))).rejects.toMatchObject({
      kind: 'not-found',
    });
    http.expectNone(() => true);
  });
});
