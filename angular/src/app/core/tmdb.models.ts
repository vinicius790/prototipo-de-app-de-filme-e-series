// Tipos usados pelo app (normalizados) e pelas respostas cruas da API do TMDB.

export type MediaType = 'movie' | 'tv';
export type ListType = 'popular' | 'now' | 'top';

export const LIST_TYPES: readonly ListType[] = ['popular', 'now', 'top'];

/** Resumo de um filme ou série, já sem as diferenças de nome de campo entre os dois. */
export interface MediaSummary {
  id: number;
  media: MediaType;
  title: string;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  rating: number;
  date: string;
  /** Ids de gênero do TMDB: alimentam as recomendações. */
  genreIds: number[];
}

export interface CastMember {
  id: number;
  name: string;
  character: string;
  profilePath: string | null;
}

export interface Trailer {
  key: string;
  name: string;
}

export interface MediaDetails extends MediaSummary {
  tagline: string;
  genres: string[];
  runtime: number;
  seasons: number;
  episodes: number;
  status: string;
  budget: number;
  revenue: number;
  homepage: string | null;
  cast: CastMember[];
  trailer: Trailer | null;
}

export interface Genre {
  id: number;
  name: string;
}

export interface Page<T> {
  page: number;
  totalPages: number;
  totalResults: number;
  items: T[];
}

export interface ListQuery {
  media: MediaType;
  list?: ListType;
  genre?: string;
  query?: string;
  page?: number;
}

export interface TmdbRawItem {
  id: number;
  title?: string;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
  /** Presente nas listagens; os detalhes trazem `genres` no lugar. */
  genre_ids?: number[];
}

export interface TmdbRawPage {
  page?: number;
  total_pages?: number;
  total_results?: number;
  results?: TmdbRawItem[];
}

export interface TmdbRawVideo {
  site?: string;
  type?: string;
  key?: string;
  name?: string;
  official?: boolean;
  iso_639_1?: string;
}

export interface TmdbRawCast {
  id: number;
  name?: string;
  character?: string;
  profile_path?: string | null;
}

export interface TmdbRawDetails extends TmdbRawItem {
  tagline?: string;
  genres?: Genre[];
  runtime?: number;
  episode_run_time?: number[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  status?: string;
  budget?: number;
  revenue?: number;
  homepage?: string;
  credits?: { cast?: TmdbRawCast[] };
  videos?: { results?: TmdbRawVideo[] };
}
