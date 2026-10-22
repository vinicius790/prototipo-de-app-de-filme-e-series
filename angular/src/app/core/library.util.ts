// Validação e normalização dos resumos de título guardados no navegador (favoritos, avaliações
// e listas personalizadas). Sem Angular aqui, para que possam ser testadas isoladamente.

import type { Favorite } from './library.service';
import type { MediaType } from './tmdb.models';

export type Entry = { id: number; media: MediaType; title: string };

export function isEntry(value: unknown): value is Entry {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    (entry['media'] === 'movie' || entry['media'] === 'tv') &&
    Number.isInteger(entry['id']) &&
    typeof entry['title'] === 'string'
  );
}

export const sameTitle = (media: MediaType, id: number) => (entry: Entry) =>
  entry.media === media && entry.id === id;

export const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Ids de gênero do TMDB; entradas antigas, gravadas antes das recomendações, não têm o campo. */
export function toGenreIds(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((id): id is number => Number.isInteger(id)) : [];
}

/**
 * Gêneros guardados no navegador: campo ausente = ainda não se sabe (o app busca nos detalhes do
 * TMDB); `[]` = conferido no TMDB, sem gênero (não é buscado de novo); com ids = conhecido.
 */
export function genresField(value: unknown): { genreIds?: number[] } {
  return Array.isArray(value) ? { genreIds: toGenreIds(value) } : {};
}

/** Até a 1.2, "gênero desconhecido" era gravado como `[]`: na migração esses viram "não se sabe". */
export function forgetEmptyGenres<T extends { genreIds?: number[] }>(entry: T): T {
  if (entry.genreIds?.length !== 0) {
    return entry;
  }
  const copy = { ...entry };
  delete copy.genreIds;
  return copy;
}

// Campos fora do tipo esperado (nota em texto, nota 7 de 5...) quebrariam a renderização.
/** Resumo de um título, no formato guardado em favoritos e nas listas personalizadas. */
export function toFavorite(entry: Entry): Favorite {
  const { posterPath, rating, date, genreIds } = entry as Partial<Record<keyof Favorite, unknown>>;
  return {
    id: entry.id,
    media: entry.media,
    title: entry.title,
    posterPath: typeof posterPath === 'string' ? posterPath : null,
    rating: typeof rating === 'number' && Number.isFinite(rating) ? rating : 0,
    date: asString(date),
    ...genresField(genreIds),
  };
}
