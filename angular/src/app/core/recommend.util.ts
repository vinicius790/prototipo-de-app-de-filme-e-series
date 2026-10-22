// Recomendações por gêneros favoritos, calculadas só com o que está no navegador
// (favoritos e avaliações). Funções puras: quem busca os títulos no TMDB é a tela.

import type { MediaType } from './tmdb.models';

export const MAX_RECOMMENDED_GENRES = 3;
export const MAX_REASONS = 3;
export const MAX_RECOMMENDED_ITEMS = 12;
/** Quantos títulos antigos, sem gêneros, são completados por visita à tela (e quantos de uma vez). */
export const MAX_GENRE_LOOKUPS = 40;
export const GENRE_LOOKUP_CONCURRENCY = 4;

interface Liked {
  id: number;
  media: MediaType;
  title: string;
  /** Ausente em entradas gravadas antes de o app registrar gêneros. */
  genreIds?: number[];
}

export interface GenreScore {
  media: MediaType;
  genreId: number;
  score: number;
  /** Títulos que explicam a recomendação ("porque você gostou de…"). */
  because: string[];
}

/** Favorito soma 1. Avaliação: 5 estrelas somam 2, 4 somam 1, 3 não mexe, 2 e 1 subtraem. */
const FAVORITE_WEIGHT = 1;
const reviewWeight = (rating: number) => rating - 3;

/**
 * Pontua cada gênero (por tipo de mídia, porque filme e série têm tabelas de gênero diferentes)
 * e guarda de quais títulos a pontuação veio. Devolve do gênero mais forte ao mais fraco.
 */
export function genreProfile(
  favorites: readonly Liked[],
  reviews: readonly (Liked & { rating: number })[],
): GenreScore[] {
  const genres = new Map<
    string,
    {
      media: MediaType;
      genreId: number;
      score: number;
      titles: Map<string, { title: string; weight: number }>;
    }
  >();
  const add = (entry: Liked, weight: number) => {
    for (const genreId of entry.genreIds ?? []) {
      const key = `${entry.media}:${genreId}`;
      const genre = genres.get(key) ?? {
        media: entry.media,
        genreId,
        score: 0,
        titles: new Map<string, { title: string; weight: number }>(),
      };
      genre.score += weight;
      const titleKey = `${entry.media}:${entry.id}`;
      const title = genre.titles.get(titleKey) ?? { title: entry.title, weight: 0 };
      title.weight += weight;
      genre.titles.set(titleKey, title);
      genres.set(key, genre);
    }
  };
  favorites.forEach((favorite) => add(favorite, FAVORITE_WEIGHT));
  reviews.forEach((review) => add(review, reviewWeight(review.rating)));

  return [...genres.values()]
    .filter((genre) => genre.score > 0)
    .sort((a, b) => b.score - a.score || a.genreId - b.genreId || a.media.localeCompare(b.media))
    .map(({ media, genreId, score, titles }) => ({
      media,
      genreId,
      score,
      because: [...titles.values()]
        .filter((title) => title.weight > 0)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, MAX_REASONS)
        .map((title) => title.title),
    }));
}

/** Tira o que a pessoa já favoritou ou avaliou e limita a quantidade. */
export function excludeKnown<T extends { id: number; media: MediaType }>(
  items: readonly T[],
  favorites: readonly { id: number; media: MediaType }[],
  reviews: readonly { id: number; media: MediaType }[],
  max = MAX_RECOMMENDED_ITEMS,
): T[] {
  const known = new Set([...favorites, ...reviews].map((entry) => `${entry.media}:${entry.id}`));
  return items.filter((item) => !known.has(`${item.media}:${item.id}`)).slice(0, max);
}

/**
 * Títulos cujo gênero ainda não se sabe (sem o campo `genreIds`: gravados antes da versão 1.1),
 * sem repetição (favorito e avaliação do mesmo título contam uma vez), para buscar os detalhes.
 * `genreIds: []` quer dizer "conferido, sem gênero" e não entra. Avaliações de 3 estrelas ficam
 * de fora: não mexem na pontuação.
 */
export function missingGenres(
  favorites: readonly Liked[],
  reviews: readonly (Liked & { rating: number })[],
  max = MAX_GENRE_LOOKUPS,
): { media: MediaType; id: number }[] {
  const seen = new Set<string>();
  const missing: { media: MediaType; id: number }[] = [];
  for (const entry of [...favorites, ...reviews.filter((review) => review.rating !== 3)]) {
    const key = `${entry.media}:${entry.id}`;
    if (!Array.isArray(entry.genreIds) && !seen.has(key)) {
      seen.add(key);
      missing.push({ media: entry.media, id: entry.id });
    }
  }
  return missing.slice(0, max);
}

/** "Porque você gostou de Matrix, Dark e Duna." */
export function explain(titles: readonly string[]): string {
  if (titles.length === 0) {
    return '';
  }
  const list =
    titles.length === 1
      ? titles[0]
      : `${titles.slice(0, -1).join(', ')} e ${titles[titles.length - 1]}`;
  return `Porque você gostou de ${list}.`;
}
