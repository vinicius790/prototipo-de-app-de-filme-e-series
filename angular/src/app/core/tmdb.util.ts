// Regras puras da integração com o TMDB: montagem de requisição, normalização e formatação.
// Sem Angular aqui, para que possam ser testadas isoladamente.

import { toGenreIds } from './library.util';
import {
  LIST_TYPES,
  ListQuery,
  ListType,
  MediaDetails,
  MediaSummary,
  MediaType,
  Page,
  TmdbRawDetails,
  TmdbRawItem,
  TmdbRawPage,
  TmdbRawVideo,
  Trailer,
} from './tmdb.models';

export const TMDB_API = 'https://api.themoviedb.org/3';
export const IMAGE_BASE = 'https://image.tmdb.org/t/p';

/** O TMDB só entrega até a página 500, mesmo quando `total_pages` é maior. */
export const MAX_PAGE = 500;

export function clampPage(value: unknown): number {
  const page = Number.parseInt(String(value), 10);
  if (!Number.isFinite(page) || page < 1) {
    return 1;
  }
  return Math.min(page, MAX_PAGE);
}

export function parseList(value: unknown): ListType {
  return LIST_TYPES.includes(value as ListType) ? (value as ListType) : 'popular';
}

/** Gênero só vale como id numérico; qualquer outra coisa vira "todos". */
export function parseGenre(value: unknown): string {
  return typeof value === 'string' && /^\d+$/.test(value) ? value : '';
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

// Equivalências documentadas pelo TMDB entre as listas prontas e o endpoint /discover,
// usado aqui para que qualquer lista possa ser combinada com o filtro de gênero.
function discoverParams(media: MediaType, list: ListType, today: Date): Record<string, string> {
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

/**
 * Decide o endpoint e os parâmetros de uma listagem.
 * Com texto de busca usa /search (que não aceita gênero nem ordenação); sem texto usa /discover.
 */
export function buildListRequest(
  { media, list = 'popular', genre = '', query = '', page = 1 }: ListQuery,
  today = new Date(),
): { path: string; params: Record<string, string> } {
  const base = { page: String(clampPage(page)), include_adult: 'false' };
  const term = query.trim();
  if (term) {
    return { path: `/search/${media}`, params: { ...base, query: term } };
  }
  const params: Record<string, string> = { ...base, ...discoverParams(media, list, today) };
  if (parseGenre(genre)) {
    params['with_genres'] = genre;
  }
  return { path: `/discover/${media}`, params };
}

/** Só monta URL de imagem para caminhos no formato que o TMDB devolve (`/abc123.jpg`). */
export function imageUrl(path: string | null | undefined, size = 'w342'): string | null {
  if (typeof path !== 'string' || !/^\/[\w.-]+$/.test(path)) {
    return null;
  }
  return `${IMAGE_BASE}/${size}${path}`;
}

/** Devolve a URL apenas se for http(s); bloqueia `javascript:`, `data:` e afins. */
export function safeUrl(value: unknown): string | null {
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
export function pickTrailer(videos: TmdbRawVideo[] = []): Trailer | null {
  const score = (video: TmdbRawVideo) =>
    (video.type === 'Trailer' ? 4 : 0) +
    (video.iso_639_1 === 'pt' ? 2 : 0) +
    (video.official ? 1 : 0);
  const candidates = videos.filter(
    (video) =>
      video.site === 'YouTube' &&
      (video.type === 'Trailer' || video.type === 'Teaser') &&
      /^[\w-]{6,20}$/.test(video.key ?? ''),
  );
  if (candidates.length === 0) {
    return null;
  }
  const best = candidates.reduce((current, video) =>
    score(video) > score(current) ? video : current,
  );
  return { key: best.key ?? '', name: best.name || 'Trailer' };
}

export function normalizeItem(raw: TmdbRawItem, media: MediaType): MediaSummary {
  return {
    id: raw.id,
    media,
    title: raw.title || raw.name || 'Sem título',
    overview: raw.overview ?? '',
    posterPath: raw.poster_path ?? null,
    backdropPath: raw.backdrop_path ?? null,
    rating: typeof raw.vote_average === 'number' ? raw.vote_average : 0,
    date: raw.release_date || raw.first_air_date || '',
    genreIds: toGenreIds(raw.genre_ids),
  };
}

export function normalizePage(raw: TmdbRawPage, media: MediaType): Page<MediaSummary> {
  return {
    page: clampPage(raw.page),
    totalPages: clampPage(raw.total_pages),
    totalResults: Number(raw.total_results) || 0,
    items: (raw.results ?? []).map((item) => normalizeItem(item, media)),
  };
}

export function normalizeDetails(raw: TmdbRawDetails, media: MediaType): MediaDetails {
  const isMovie = media === 'movie';
  return {
    ...normalizeItem(raw, media),
    tagline: raw.tagline ?? '',
    genres: (raw.genres ?? []).map((genre) => genre.name).filter(Boolean),
    // Os detalhes trazem `genres` (id + nome) no lugar de `genre_ids`.
    genreIds: toGenreIds((raw.genres ?? []).map((genre) => genre.id)),
    runtime: (isMovie ? raw.runtime : raw.episode_run_time?.[0]) ?? 0,
    seasons: isMovie ? 0 : (raw.number_of_seasons ?? 0),
    episodes: isMovie ? 0 : (raw.number_of_episodes ?? 0),
    status: raw.status ?? '',
    budget: isMovie ? (raw.budget ?? 0) : 0,
    revenue: isMovie ? (raw.revenue ?? 0) : 0,
    homepage: safeUrl(raw.homepage),
    cast: (raw.credits?.cast ?? []).slice(0, 12).map((person) => ({
      id: person.id,
      name: person.name ?? '',
      character: person.character ?? '',
      profilePath: person.profile_path ?? null,
    })),
    trailer: pickTrailer(raw.videos?.results),
  };
}

/** Faixa de cor da nota: verde a partir de 8, laranja a partir de 5, vermelho abaixo disso. */
export function ratingClass(rating: number): string {
  if (rating >= 8) {
    return 'nota--alta';
  }
  if (rating >= 5) {
    return 'nota--media';
  }
  return 'nota--baixa';
}

export function formatRating(rating: number): string {
  return rating > 0 ? rating.toFixed(1).replace('.', ',') : '–';
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

export function formatDate(iso: string): string {
  const match = ISO_DATE.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

export function yearOf(iso: string): string {
  return ISO_DATE.exec(iso)?.[1] ?? '';
}

export function formatRuntime(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return '';
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${String(rest).padStart(2, '0')}min` : `${rest}min`;
}

const DOLLARS = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** O TMDB informa orçamento e receita em dólares; zero significa "não informado". */
export function formatMoney(amount: number): string {
  return Number.isFinite(amount) && amount > 0 ? DOLLARS.format(amount) : '';
}

const STATUS: Record<string, string> = {
  Released: 'Lançado',
  'Post Production': 'Pós-produção',
  'In Production': 'Em produção',
  Planned: 'Planejado',
  Rumored: 'Rumor',
  Canceled: 'Cancelado',
  'Returning Series': 'Em exibição',
  Ended: 'Finalizada',
  Pilot: 'Piloto',
};

export function translateStatus(status: string): string {
  return STATUS[status] ?? status;
}

/**
 * Páginas a mostrar na paginação: primeira, última e uma janela em volta da atual.
 * Buracos entre elas viram a marca `'gap'`.
 */
export function pageRange(current: number, total: number, radius = 2): (number | 'gap')[] {
  if (total < 1) {
    return [];
  }
  const pages = new Set([1, total]);
  for (let page = current - radius; page <= current + radius; page += 1) {
    if (page >= 1 && page <= total) {
      pages.add(page);
    }
  }
  const range: (number | 'gap')[] = [];
  let previous = 0;
  for (const page of [...pages].sort((a, b) => a - b)) {
    if (previous > 0 && page - previous > 1) {
      range.push('gap');
    }
    range.push(page);
    previous = page;
  }
  return range;
}
