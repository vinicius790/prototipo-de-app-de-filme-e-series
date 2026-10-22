// Estado do usuário (favoritos, avaliações e chave da API) persistido em localStorage.
// O storage é injetado para que os testes usem um substituto em memória.

import { MEDIA_TYPES } from './api.js';

const FAVORITES_KEY = 'movie-app:favoritos';
const REVIEWS_KEY = 'movie-app:avaliacoes';
const API_KEY_KEY = 'movie-app:chave-tmdb';
/** Marca de que os favoritos e avaliações já estão no formato de gêneros da 1.3 (ver createStore). */
export const GENRES_FORMAT_KEY = 'movie-app:generos-v2';

export const MAX_REVIEW_LENGTH = 1000;

export function isEntry(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    MEDIA_TYPES.includes(value.media) &&
    Number.isInteger(value.id) &&
    typeof value.title === 'string'
  );
}

// Dados gravados por outra versão do app, ou editados à mão, não podem derrubar a página.
function readList(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key));
    return Array.isArray(value) ? value.filter(isEntry) : [];
  } catch {
    return [];
  }
}

function write(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch {
    // Cota cheia ou storage bloqueado: o estado segue valendo só nesta sessão.
  }
}

const sameTitle = (media, id) => (entry) => entry.media === media && entry.id === id;

const asString = (value) => (typeof value === 'string' ? value : '');

// Gêneros: campo ausente = ainda não se sabe (o app busca nos detalhes do TMDB); `[]` = conferido
// no TMDB, sem gênero (não é buscado de novo); com ids = conhecido.
const toGenreIds = (value) => (Array.isArray(value) ? value.filter(Number.isInteger) : undefined);
const genresField = (value) => {
  const ids = toGenreIds(value);
  return ids ? { genreIds: ids } : {};
};

/** Até a 1.2, "gênero desconhecido" era gravado como `[]`: na migração esses viram "não se sabe". */
function forgetEmptyGenres(entry) {
  if (entry.genreIds?.length !== 0) {
    return entry;
  }
  const { genreIds, ...rest } = entry;
  return rest;
}

// Campos fora do tipo esperado (nota em texto, nota 7 de 5...) quebrariam a renderização.
/** Resumo de um título, no formato guardado em favoritos e nas listas personalizadas. */
export function toFavorite({ id, media, title, posterPath, rating, date, genreIds }) {
  return {
    id,
    media,
    title,
    posterPath: typeof posterPath === 'string' ? posterPath : null,
    rating: Number.isFinite(rating) ? rating : 0,
    date: asString(date),
    ...genresField(genreIds),
  };
}

export function isValidRating(rating) {
  return Number.isInteger(rating) && rating >= 1 && rating <= 5;
}

export function toReview({ id, media, title, rating, text, updatedAt, genreIds }) {
  return {
    id,
    media,
    title,
    rating,
    text: asString(text),
    updatedAt: asString(updatedAt),
    ...genresField(genreIds),
  };
}

export function createStore(storage) {
  let favorites = readList(storage, FAVORITES_KEY).map(toFavorite);
  let reviews = readList(storage, REVIEWS_KEY)
    .filter((review) => isValidRating(review.rating))
    .map(toReview);

  const saveFavorites = () => write(storage, FAVORITES_KEY, JSON.stringify(favorites));
  const saveReviews = () => write(storage, REVIEWS_KEY, JSON.stringify(reviews));

  // Migração única dos gêneros (a versão Angular, na mesma origem, faz a mesma coisa).
  let legacyGenres = true;
  try {
    legacyGenres = storage.getItem(GENRES_FORMAT_KEY) === null;
  } catch {
    // storage bloqueado: trata como formato antigo
  }
  if (legacyGenres) {
    favorites = favorites.map(forgetEmptyGenres);
    reviews = reviews.map(forgetEmptyGenres);
    if (favorites.length > 0) {
      saveFavorites();
    }
    if (reviews.length > 0) {
      saveReviews();
    }
    write(storage, GENRES_FORMAT_KEY, '1');
  }

  return {
    favorites() {
      return [...favorites];
    },

    isFavorite(media, id) {
      return favorites.some(sameTitle(media, id));
    },

    /** Alterna o favorito e devolve `true` quando o título passou a ser favorito. */
    toggleFavorite(item) {
      const wasFavorite = favorites.some(sameTitle(item.media, item.id));
      if (wasFavorite) {
        favorites = favorites.filter((entry) => !sameTitle(item.media, item.id)(entry));
      } else {
        favorites = [...favorites, toFavorite(item)];
      }
      saveFavorites();
      return !wasFavorite;
    },

    reviews() {
      return [...reviews];
    },

    review(media, id) {
      return reviews.find(sameTitle(media, id)) ?? null;
    },

    /** Uma avaliação por título: salvar de novo substitui a anterior. */
    saveReview({ media, id, title, rating, text = '', genreIds }, now = new Date()) {
      if (!isValidRating(rating)) {
        throw new RangeError('A nota precisa ser um número inteiro de 1 a 5.');
      }
      const review = {
        id,
        media,
        title,
        rating,
        text: String(text).trim().slice(0, MAX_REVIEW_LENGTH),
        updatedAt: now.toISOString(),
        ...genresField(genreIds),
      };
      reviews = [...reviews.filter((entry) => !sameTitle(media, id)(entry)), review];
      saveReviews();
      return review;
    },

    removeReview(media, id) {
      reviews = reviews.filter((entry) => !sameTitle(media, id)(entry));
      saveReviews();
    },

    /**
     * Grava os gêneros de um título cujo gênero ainda não se sabe (favorito e/ou avaliação).
     * Lista vazia também é gravada: marca o título como conferido, para não ser buscado de novo.
     * Não mexe em entradas que já têm o campo. Devolve se algo mudou.
     */
    fillGenres(media, id, genreIds) {
      const ids = toGenreIds(genreIds) ?? [];
      const needs = (entry) => sameTitle(media, id)(entry) && entry.genreIds === undefined;
      if (![...favorites, ...reviews].some(needs)) {
        return false;
      }
      const fill = (entry) => (needs(entry) ? { ...entry, genreIds: ids } : entry);
      favorites = favorites.map(fill);
      reviews = reviews.map(fill);
      saveFavorites();
      saveReviews();
      return true;
    },

    /**
     * Importa favoritos em lote (por exemplo, a partir de um arquivo de backup JSON).
     * @param {object[]} importedItems
     * @param {{overwrite?: boolean}} [options]
     */
    importFavorites(importedItems, { overwrite = false } = {}) {
      const clean = importedItems.filter(isEntry).map(toFavorite);
      if (overwrite) {
        favorites = clean;
      } else {
        const seen = new Set(favorites.map((f) => `${f.media}:${f.id}`));
        for (const item of clean) {
          const key = `${item.media}:${item.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            favorites.push(item);
          }
        }
      }
      saveFavorites();
      return [...favorites];
    },

    /**
     * Importa avaliações em lote (por exemplo, a partir de um arquivo de backup JSON).
     * @param {object[]} importedReviews
     * @param {{overwrite?: boolean}} [options]
     */
    importReviews(importedReviews, { overwrite = false } = {}) {
      const clean = importedReviews.filter((r) => isEntry(r) && isValidRating(r.rating)).map(toReview);
      if (overwrite) {
        reviews = clean;
      } else {
        const byKey = new Map(reviews.map((r) => [`${r.media}:${r.id}`, r]));
        for (const item of clean) {
          byKey.set(`${item.media}:${item.id}`, item);
        }
        reviews = [...byKey.values()];
      }
      saveReviews();
      return [...reviews];
    },
  };
}

/**
 * Procura a chave primeiro em `config.js` (arquivo opcional, fora do git) e depois no navegador.
 * @param {Storage} storage
 * @param {() => Promise<{default?: {apiKey?: string}}>} importConfig
 */
export async function loadApiKey(storage, importConfig) {
  try {
    const key = (await importConfig()).default?.apiKey;
    if (typeof key === 'string' && key.trim()) {
      return { apiKey: key.trim(), source: 'file' };
    }
  } catch {
    // config.js não existe: é o caso normal de quem informa a chave pela tela.
  }
  let stored = null;
  try {
    stored = storage.getItem(API_KEY_KEY);
  } catch {
    // storage bloqueado
  }
  return stored ? { apiKey: stored, source: 'browser' } : { apiKey: '', source: 'none' };
}

export function saveApiKey(storage, apiKey) {
  write(storage, API_KEY_KEY, apiKey);
}

export function clearApiKey(storage) {
  try {
    storage.removeItem(API_KEY_KEY);
  } catch {
    // storage bloqueado: não há o que remover
  }
}
