import { CircuitBreaker, CircuitBreakerOpenError, LruCache, retryWithBackoff } from './lru-cache.js';

export { CircuitBreaker, CircuitBreakerOpenError, LruCache, retryWithBackoff };

export const API_BASE = 'https://api.themoviedb.org/3';
export const IMAGE_BASE = 'https://image.tmdb.org/t/p';

/** O TMDB só entrega até a página 500, mesmo quando `total_pages` é maior. */
export const MAX_PAGE = 500;

export const MEDIA_TYPES = ['movie', 'tv'];
export const LIST_TYPES = ['popular', 'now', 'top'];

const ERROR_MESSAGES = {
  'no-key': 'Nenhuma chave da API do TMDB foi configurada.',
  auth: 'O TMDB recusou a chave da API. Confira se ela foi copiada corretamente.',
  'not-found': 'Este título não foi encontrado no TMDB.',
  'rate-limit': 'Muitas requisições em pouco tempo. Aguarde alguns segundos e tente de novo.',
  network: 'Não foi possível conectar ao TMDB. Verifique sua conexão com a internet.',
  http: 'O TMDB respondeu com um erro inesperado.',
};

export class TmdbError extends Error {
  /**
   * @param {'no-key'|'auth'|'not-found'|'rate-limit'|'network'|'http'} kind
   * @param {number} [status] código HTTP, quando houver
   */
  constructor(kind, status) {
    super(ERROR_MESSAGES[kind] ?? ERROR_MESSAGES.http);
    this.name = 'TmdbError';
    this.kind = kind;
    this.status = status;
  }
}

function kindForStatus(status) {
  if (status === 401 || status === 403) {
    return 'auth';
  }
  if (status === 404) {
    return 'not-found';
  }
  if (status === 429) {
    return 'rate-limit';
  }
  return 'http';
}

/** Tokens de leitura da API v4 são JWT e vão no cabeçalho; chaves v3 vão na query string. */
export function isBearerToken(apiKey) {
  return typeof apiKey === 'string' && apiKey.startsWith('eyJ');
}

/** Aceita o formato de uma chave v3 (32 hexadecimais) ou de um token v4 (JWT). */
export function isValidKeyFormat(apiKey) {
  return /^[a-f0-9]{32}$/i.test(apiKey) || /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(apiKey);
}

export function clampPage(value) {
  const page = Number.parseInt(value, 10);
  if (!Number.isFinite(page) || page < 1) {
    return 1;
  }
  return Math.min(page, MAX_PAGE);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

// Equivalências documentadas pelo TMDB entre as listas prontas e o endpoint /discover,
// usado aqui para que qualquer lista possa ser combinada com o filtro de gênero.
function discoverParams(media, list, today) {
  if (list === 'top') {
    return { sort_by: 'vote_average.desc', 'vote_count.gte': '200' };
  }
  if (list === 'now' && media === 'movie') {
    return {
      sort_by: 'popularity.desc',
      with_release_type: '2|3',
      'release_date.gte': isoDate(addDays(today, -42)),
      'release_date.lte': isoDate(today),
    };
  }
  if (list === 'now') {
    return {
      sort_by: 'popularity.desc',
      'air_date.gte': isoDate(today),
      'air_date.lte': isoDate(addDays(today, 7)),
    };
  }
  return { sort_by: 'popularity.desc' };
}

export const SORT_OPTIONS = ['popularidade', 'nota', 'recentes'];

/**
 * Decide o endpoint e os parâmetros de uma listagem.
 * Com texto de busca usa /search (que não aceita gênero nem ordenação); sem texto usa /discover.
 */
export function buildListRequest({
  media,
  list = 'popular',
  genre = '',
  query = '',
  page = 1,
  today = new Date(),
  sort = '',
  yearFrom = '',
  yearTo = '',
}) {
  if (!MEDIA_TYPES.includes(media)) {
    throw new TypeError(`Tipo de mídia inválido: ${media}`);
  }
  const params = { page: clampPage(page), include_adult: 'false' };
  const term = String(query).trim();
  if (term) {
    return { path: `/search/${media}`, params: { ...params, query: term } };
  }
  Object.assign(params, discoverParams(media, list, today));
  // O TMDB filtra por id numérico de gênero; nomes como "action" são descartados.
  if (/^\d+$/.test(String(genre))) {
    params.with_genres = String(genre);
  }
  if (sort === 'nota') {
    params.sort_by = 'vote_average.desc';
    params['vote_count.gte'] = '100';
  } else if (sort === 'recentes') {
    params.sort_by = media === 'tv' ? 'first_air_date.desc' : 'primary_release_date.desc';
    params[media === 'tv' ? 'first_air_date.lte' : 'release_date.lte'] = isoDate(today);
  } else if (sort === 'popularidade') {
    params.sort_by = 'popularity.desc';
  }
  if (/^\d{4}$/.test(String(yearFrom))) {
    params[media === 'tv' ? 'first_air_date.gte' : 'primary_release_date.gte'] = `${yearFrom}-01-01`;
  }
  if (/^\d{4}$/.test(String(yearTo))) {
    params[media === 'tv' ? 'first_air_date.lte' : 'primary_release_date.lte'] = `${yearTo}-12-31`;
  }
  return { path: `/discover/${media}`, params };
}

export function buildUrl(path, params = {}, { apiKey = '', language = 'pt-BR' } = {}) {
  const url = new URL(API_BASE + path);
  const all = { language, ...params };
  if (apiKey && !isBearerToken(apiKey)) {
    all.api_key = apiKey;
  }
  for (const [name, value] of Object.entries(all)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(name, String(value));
    }
  }
  return url.toString();
}

/** Só monta URL de imagem para caminhos no formato que o TMDB devolve (`/abc123.jpg`). */
export function imageUrl(path, size = 'w342') {
  if (typeof path !== 'string' || !/^\/[\w.-]+$/.test(path)) {
    return null;
  }
  return `${IMAGE_BASE}/${size}${path}`;
}

/** Devolve a URL apenas se for http(s); bloqueia `javascript:`, `data:` e afins. */
export function safeUrl(value) {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Escolhe o melhor trailer do YouTube: trailer antes de teaser, em português e oficial primeiro. */
export function pickTrailer(videos = []) {
  const score = (video) =>
    (video.type === 'Trailer' ? 4 : 0) + (video.iso_639_1 === 'pt' ? 2 : 0) + (video.official ? 1 : 0);
  const candidates = videos.filter(
    (video) =>
      video?.site === 'YouTube' &&
      (video.type === 'Trailer' || video.type === 'Teaser') &&
      /^[\w-]{6,20}$/.test(video.key ?? ''),
  );
  if (candidates.length === 0) {
    return null;
  }
  const best = candidates.reduce((current, video) => (score(video) > score(current) ? video : current));
  return { key: best.key, name: typeof best.name === 'string' && best.name ? best.name : 'Trailer' };
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

const integers = (value) => (Array.isArray(value) ? value.filter(Number.isInteger) : []);

export function normalizeItem(raw, media) {
  return {
    id: raw.id,
    media,
    title: text(raw.title) || text(raw.name) || 'Sem título',
    overview: text(raw.overview),
    posterPath: raw.poster_path ?? null,
    backdropPath: raw.backdrop_path ?? null,
    rating: typeof raw.vote_average === 'number' ? raw.vote_average : 0,
    date: text(raw.release_date) || text(raw.first_air_date),
    // Ids de gênero: alimentam as recomendações. As listagens trazem `genre_ids`.
    genreIds: integers(raw.genre_ids),
  };
}

export function normalizeDetails(raw, media) {
  const cast = Array.isArray(raw.credits?.cast) ? raw.credits.cast : [];
  return {
    ...normalizeItem(raw, media),
    tagline: text(raw.tagline),
    genres: (raw.genres ?? []).map((genre) => text(genre.name)).filter(Boolean),
    // Os detalhes trazem `genres` (id + nome) no lugar de `genre_ids`.
    genreIds: integers((raw.genres ?? []).map((genre) => genre?.id)),
    runtime: media === 'movie' ? raw.runtime ?? 0 : raw.episode_run_time?.[0] ?? 0,
    seasons: media === 'tv' ? raw.number_of_seasons ?? 0 : 0,
    episodes: media === 'tv' ? raw.number_of_episodes ?? 0 : 0,
    status: text(raw.status),
    budget: media === 'movie' ? raw.budget ?? 0 : 0,
    revenue: media === 'movie' ? raw.revenue ?? 0 : 0,
    homepage: safeUrl(raw.homepage),
    cast: cast.slice(0, 12).map((person) => ({
      id: person.id,
      name: text(person.name),
      character: text(person.character),
      profilePath: person.profile_path ?? null,
    })),
    trailer: pickTrailer(raw.videos?.results),
  };
}

/**
 * @param {object} options
 * @param {string} options.apiKey chave v3 ou token de leitura v4
 * @param {string} [options.language]
 * @param {typeof fetch} [options.fetch] permite injetar um fetch simulado nos testes
 * @param {() => Date} [options.now]
 */
export function createClient({
  apiKey = '',
  language = 'pt-BR',
  fetch: fetchFn = (...args) => globalThis.fetch(...args),
  now = () => new Date(),
  cache = null,
  circuitBreaker = null,
  retryOptions = {},
} = {}) {
  const genreCache = new Map();
  const lruCache = cache ?? new LruCache();
  const cb = circuitBreaker ?? new CircuitBreaker();

  async function request(path, params, signal) {
    if (!apiKey) {
      throw new TmdbError('no-key');
    }
    const headers = { Accept: 'application/json' };
    if (isBearerToken(apiKey)) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    return cb.execute(async () => {
      return retryWithBackoff(
        async () => {
          let response;
          try {
            response = await fetchFn(buildUrl(path, params, { apiKey, language }), { headers, signal });
          } catch (error) {
            if (error?.name === 'AbortError') {
              throw error;
            }
            throw new TmdbError('network');
          }
          if (!response.ok) {
            throw new TmdbError(kindForStatus(response.status), response.status);
          }
          return response.json();
        },
        {
          maxRetries: retryOptions.maxRetries ?? 2,
          initialDelayMs: retryOptions.initialDelayMs ?? 20,
          backoffFactor: retryOptions.backoffFactor ?? 2,
          maxDelayMs: retryOptions.maxDelayMs ?? 200,
          sleep: retryOptions.sleep,
          shouldRetry:
            retryOptions.shouldRetry ??
            ((err) => err?.kind === 'network' || err?.kind === 'rate-limit'),
        },
      );
    });
  }

  return {
    hasKey: Boolean(apiKey),
    cache: lruCache,
    circuitBreaker: cb,

    /** Lista paginada de filmes ou séries (populares, em cartaz, mais bem avaliados ou busca). */
    async list(options, signal) {
      const { path, params } = buildListRequest({ today: now(), ...options });
      const cacheKey = `list:${options.media}:${JSON.stringify({
        path,
        params,
        sort: options.sort,
        yearFrom: options.yearFrom,
        yearTo: options.yearTo,
        language,
      })}`;

      const cached = lruCache.get(cacheKey);
      if (cached) {
        return {
          ...cached,
          items: cached.items.map((item) => ({ ...item, genreIds: [...(item.genreIds || [])] })),
        };
      }

      const data = await request(path, params, signal);
      const results = Array.isArray(data.results) ? data.results : [];
      let items = results.map((raw) => normalizeItem(raw, options.media));
      if (options.yearFrom && /^\d{4}$/.test(String(options.yearFrom))) {
        const yFrom = Number(options.yearFrom);
        items = items.filter((item) => {
          const y = Number(item.date?.slice(0, 4));
          return Number.isFinite(y) && y >= yFrom;
        });
      }
      if (options.yearTo && /^\d{4}$/.test(String(options.yearTo))) {
        const yTo = Number(options.yearTo);
        items = items.filter((item) => {
          const y = Number(item.date?.slice(0, 4));
          return Number.isFinite(y) && y <= yTo;
        });
      }
      if (options.sort === 'nota') {
        items.sort((a, b) => b.rating - a.rating);
      } else if (options.sort === 'recentes') {
        items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      }
      const response = {
        page: clampPage(data.page),
        totalPages: clampPage(data.total_pages),
        totalResults: Number(data.total_results) || 0,
        items,
      };

      lruCache.set(cacheKey, response);
      return {
        ...response,
        items: response.items.map((item) => ({ ...item, genreIds: [...(item.genreIds || [])] })),
      };
    },

    /**
     * Gêneros reais do TMDB (id + nome), buscados uma vez por tipo de mídia.
     * Não aceita sinal de cancelamento: a mesma resposta é compartilhada entre as telas.
     */
    genres(media) {
      if (!genreCache.has(media)) {
        const pending = request(`/genre/${media}/list`, {})
          .then((data) => (Array.isArray(data.genres) ? data.genres : []))
          .catch((error) => {
            genreCache.delete(media);
            throw error;
          });
        genreCache.set(media, pending);
      }
      return genreCache.get(media);
    },

    /** Detalhes com elenco e vídeos numa única requisição. */
    async details(media, id, signal) {
      if (!MEDIA_TYPES.includes(media) || !Number.isInteger(id) || id < 1) {
        throw new TmdbError('not-found', 404);
      }
      const cacheKey = `details:${media}:${id}:${language}`;
      const cached = lruCache.get(cacheKey);
      if (cached) {
        return {
          ...cached,
          genreIds: [...(cached.genreIds || [])],
          genres: [...(cached.genres || [])],
          cast: (cached.cast || []).map((c) => ({ ...c })),
        };
      }
      const data = await request(
        `/${media}/${id}`,
        { append_to_response: 'credits,videos', include_video_language: 'pt,en' },
        signal,
      );
      const result = normalizeDetails(data, media);
      lruCache.set(cacheKey, result);
      return {
        ...result,
        genreIds: [...(result.genreIds || [])],
        genres: [...(result.genres || [])],
        cast: (result.cast || []).map((c) => ({ ...c })),
      };
    },
  };
}
