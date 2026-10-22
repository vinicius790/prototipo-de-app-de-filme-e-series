// Recomendações por gêneros favoritos, calculadas só com o que está no navegador
// (favoritos e avaliações). Funções puras: quem busca os títulos no TMDB é o app.js.

export const MAX_RECOMMENDED_GENRES = 3;
export const MAX_REASONS = 3;
export const MAX_RECOMMENDED_ITEMS = 12;
/** Quantos títulos antigos, sem gêneros, são completados por visita à tela (e quantos de uma vez). */
export const MAX_GENRE_LOOKUPS = 40;
export const GENRE_LOOKUP_CONCURRENCY = 4;

/** Favorito soma 1. Avaliação: 5 estrelas somam 2, 4 somam 1, 3 não mexe, 2 e 1 subtraem. */
const FAVORITE_WEIGHT = 1;
const reviewWeight = (rating) => rating - 3;

/**
 * Pontua cada gênero (por tipo de mídia, porque filme e série têm tabelas de gênero diferentes)
 * e guarda de quais títulos a pontuação veio, para explicar a recomendação.
 * @returns {{media: string, genreId: number, score: number, because: string[]}[]} do mais forte ao mais fraco
 */
export function genreProfile(favorites, reviews) {
  const genres = new Map();
  const add = (entry, weight) => {
    for (const genreId of entry.genreIds ?? []) {
      const key = `${entry.media}:${genreId}`;
      const genre = genres.get(key) ?? { media: entry.media, genreId, score: 0, titles: new Map() };
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
export function excludeKnown(items, favorites, reviews, max = MAX_RECOMMENDED_ITEMS) {
  const known = new Set([...favorites, ...reviews].map((entry) => `${entry.media}:${entry.id}`));
  return items.filter((item) => !known.has(`${item.media}:${item.id}`)).slice(0, max);
}

/**
 * Títulos cujo gênero ainda não se sabe (sem o campo `genreIds`: gravados antes da versão 1.1),
 * sem repetição (favorito e avaliação do mesmo título contam uma vez), para buscar os detalhes.
 * `genreIds: []` quer dizer "conferido, sem gênero" e não entra. Avaliações de 3 estrelas ficam
 * de fora: não mexem na pontuação.
 */
export function missingGenres(favorites, reviews, max = MAX_GENRE_LOOKUPS) {
  const seen = new Set();
  const missing = [];
  for (const entry of [...favorites, ...reviews.filter((review) => review.rating !== 3)]) {
    const key = `${entry.media}:${entry.id}`;
    if (!Array.isArray(entry.genreIds) && !seen.has(key)) {
      seen.add(key);
      missing.push({ media: entry.media, id: entry.id });
    }
  }
  return missing.slice(0, max);
}

/**
 * Roda `task` para cada item com no máximo `limit` execuções ao mesmo tempo.
 * Devolve os resultados na ordem dos itens, no formato de `Promise.allSettled`.
 */
export async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { status: 'fulfilled', value: await task(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
}

/** "Porque você gostou de Matrix, Dark e Duna." */
export function explain(titles) {
  if (titles.length === 0) {
    return '';
  }
  const list = titles.length === 1 ? titles[0] : `${titles.slice(0, -1).join(', ')} e ${titles.at(-1)}`;
  return `Porque você gostou de ${list}.`;
}

/**
 * Calcula a frequência dos gêneros mais frequentes favoritados pelo usuário.
 * @param {object[]} favorites lista de favoritos
 * @param {'movie'|'tv'|null} [media] filtrar por tipo de mídia específico ou null para todos
 * @returns {{media: string, genreId: number, count: number, frequency: number}[]}
 */
export function frequentFavoritedGenres(favorites = [], media = null) {
  const filtered = media ? favorites.filter((f) => f.media === media) : favorites;
  const total = filtered.length;
  if (total === 0) {
    return [];
  }
  const counts = new Map();
  for (const item of filtered) {
    for (const genreId of item.genreIds ?? []) {
      const key = `${item.media}:${genreId}`;
      const current = counts.get(key) ?? { media: item.media, genreId, count: 0 };
      current.count += 1;
      counts.set(key, current);
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.genreId - b.genreId)
    .map((item) => ({
      ...item,
      frequency: Number((item.count / total).toFixed(2)),
    }));
}

/**
 * Perfil de recomendações inteligente, enriquecido com estatísticas de frequência de favoritos.
 */
export function intelligentSuggestionsProfile(favorites, reviews, { maxGenres = MAX_RECOMMENDED_GENRES } = {}) {
  const profile = genreProfile(favorites, reviews);
  const freq = frequentFavoritedGenres(favorites);
  const freqMap = new Map(freq.map((f) => [`${f.media}:${f.genreId}`, f]));

  return profile.slice(0, maxGenres).map((genre) => {
    const f = freqMap.get(`${genre.media}:${genre.genreId}`);
    return {
      ...genre,
      frequency: f ? f.frequency : 0,
      favoriteCount: f ? f.count : 0,
    };
  });
}

/**
 * Calcula a porcentagem estimada de afinidade (0% a 100%) de um título com o usuário.
 * Considera os gêneros do item e os pesos acumulados por favoritos e notas (1 a 5 estrelas).
 * @param {{media: string, genreIds?: number[]}} item
 * @param {object[]} favorites
 * @param {object[]} reviews
 * @returns {{score: number, label: string, topGenreId: number|null}|null}
 */
export function calculateAffinityScore(item, favorites = [], reviews = []) {
  if (!item || !Array.isArray(item.genreIds) || item.genreIds.length === 0) {
    return null;
  }
  const profile = genreProfile(favorites, reviews).filter((g) => g.media === item.media);
  if (profile.length === 0) {
    return null;
  }

  const maxProfileScore = Math.max(...profile.map((g) => g.score), 1);
  const itemGenreSet = new Set(item.genreIds);
  let matchedScore = 0;
  let topMatchedScore = 0;
  let topGenreId = null;

  for (const genre of profile) {
    if (itemGenreSet.has(genre.genreId)) {
      matchedScore += genre.score;
      if (genre.score > topMatchedScore) {
        topMatchedScore = genre.score;
        topGenreId = genre.genreId;
      }
    }
  }

  if (matchedScore <= 0) {
    return null;
  }

  // Normalização suavizada com limite superior em 99%
  const normalized = Math.min(99, Math.max(50, Math.round(55 + (topMatchedScore / maxProfileScore) * 44)));

  return {
    score: normalized,
    label: `${normalized}% de afinidade`,
    topGenreId,
  };
}

