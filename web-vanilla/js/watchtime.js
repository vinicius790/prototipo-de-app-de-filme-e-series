// Gerenciamento e métricas de tempo assistido (filmes e séries).
// Dados persistidos com envelope versionado em localStorage.

import { MEDIA_TYPES } from './api.js';

export const WATCHTIME_KEY = 'movie-app:tempo-assistido';
export const WATCHTIME_VERSION = 1;
export const MAX_WATCHED_ITEMS = 1000;
export const DEFAULT_SERIES_EPISODE_MINUTES = 45;

const asString = (value) => (typeof value === 'string' ? value : '');

/**
 * Valida se um objeto representa uma entrada válida de item assistido.
 */
export function isWatchedEntry(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    MEDIA_TYPES.includes(value.media) &&
    Number.isInteger(value.id) &&
    typeof value.title === 'string'
  );
}

/**
 * Normaliza um item para o formato gravado de tempo assistido.
 */
export function toWatchedItem(value, now = new Date()) {
  if (!isWatchedEntry(value)) {
    return null;
  }
  const runtime = Number.isInteger(value.runtime) && value.runtime > 0 ? value.runtime : 0;
  const seasons = Number.isInteger(value.seasons) && value.seasons > 0 ? value.seasons : 0;
  const episodes = Number.isInteger(value.episodes) && value.episodes > 0 ? value.episodes : 0;

  // Se for série e não tiver runtime total informado, calcula com base nos episódios ou temporadas
  let computedMinutes = runtime;
  if (value.media === 'tv') {
    if (computedMinutes === 0) {
      if (episodes > 0) {
        computedMinutes = episodes * DEFAULT_SERIES_EPISODE_MINUTES;
      } else if (seasons > 0) {
        computedMinutes = seasons * 10 * DEFAULT_SERIES_EPISODE_MINUTES;
      } else {
        computedMinutes = DEFAULT_SERIES_EPISODE_MINUTES;
      }
    }
  }

  const genreIds = Array.isArray(value.genreIds) ? value.genreIds.filter(Number.isInteger) : [];

  return {
    media: value.media,
    id: value.id,
    title: value.title,
    runtime: computedMinutes,
    posterPath: asString(value.posterPath),
    genreIds,
    watchedAt: asString(value.watchedAt) || now.toISOString(),
  };
}

/**
 * Formata minutos em string legível por humanos em português (ex: "3 dias, 4 horas e 15 minutos").
 */
export function formatWatchDuration(totalMinutes) {
  const minutes = Math.max(0, Math.round(Number(totalMinutes) || 0));
  if (minutes === 0) {
    return '0 minutos';
  }

  const days = Math.floor(minutes / (24 * 60));
  const remainingHoursMinutes = minutes % (24 * 60);
  const hours = Math.floor(remainingHoursMinutes / 60);
  const mins = remainingHoursMinutes % 60;

  const parts = [];
  if (days > 0) {
    parts.push(days === 1 ? '1 dia' : `${days} dias`);
  }
  if (hours > 0) {
    parts.push(hours === 1 ? '1 hora' : `${hours} horas`);
  }
  if (mins > 0 || parts.length === 0) {
    parts.push(mins === 1 ? '1 minuto' : `${mins} minutos`);
  }

  if (parts.length === 1) {
    return parts[0];
  }
  return `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}`;
}

/**
 * Calcula métricas consolidadas sobre os itens assistidos.
 */
export function calculateWatchStats(items = []) {
  const validItems = items.filter(Boolean);
  const totalCount = validItems.length;

  let totalMinutes = 0;
  let movieCount = 0;
  let showCount = 0;
  let longestItem = null;

  const genreMap = new Map();

  for (const item of validItems) {
    const mins = Number(item.runtime) || 0;
    totalMinutes += mins;

    if (item.media === 'movie') {
      movieCount += 1;
    } else if (item.media === 'tv') {
      showCount += 1;
    }

    if (!longestItem || mins > (longestItem.runtime || 0)) {
      longestItem = item;
    }

    for (const genreId of item.genreIds ?? []) {
      const current = genreMap.get(genreId) ?? { genreId, count: 0, minutes: 0 };
      current.count += 1;
      current.minutes += mins;
      genreMap.set(genreId, current);
    }
  }

  const genreDistribution = [...genreMap.values()]
    .map((g) => ({
      ...g,
      percentage: totalMinutes > 0 ? Math.round((g.minutes / totalMinutes) * 100) : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes || b.count - a.count);

  const averageMinutesPerTitle = totalCount > 0 ? Math.round(totalMinutes / totalCount) : 0;

  return {
    totalCount,
    movieCount,
    showCount,
    totalMinutes,
    formattedDuration: formatWatchDuration(totalMinutes),
    averageMinutesPerTitle,
    formattedAverage: formatWatchDuration(averageMinutesPerTitle),
    longestItem,
    genreDistribution,
  };
}

/**
 * Lê do storage os itens assistidos, tolerando envelopes antigos ou dados corrompidos.
 */
function readStorageItems(storage, key = WATCHTIME_KEY) {
  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    let list = [];
    if (Array.isArray(parsed)) {
      list = parsed;
    } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
      list = parsed.items;
    }
    const seen = new Set();
    const result = [];
    for (const entry of list) {
      const normalized = toWatchedItem(entry);
      if (normalized) {
        const itemKey = `${normalized.media}:${normalized.id}`;
        if (!seen.has(itemKey)) {
          seen.add(itemKey);
          result.push(normalized);
        }
      }
    }
    return result;
  } catch {
    return [];
  }
}

/**
 * Grava no storage em envelope com versionamento.
 */
function writeStorageItems(storage, items, key = WATCHTIME_KEY) {
  try {
    const envelope = {
      version: WATCHTIME_VERSION,
      updatedAt: new Date().toISOString(),
      items: items.slice(0, MAX_WATCHED_ITEMS),
    };
    storage.setItem(key, JSON.stringify(envelope));
  } catch {
    // Quota ou bloqueio de storage não derruba a sessão
  }
}

/**
 * Cria a store de tempo assistido acoplada ao storage fornecido.
 */
export function createWatchTimeStore(storage) {
  let cache = readStorageItems(storage);

  const persist = () => writeStorageItems(storage, cache);

  return {
    items() {
      return [...cache].sort((a, b) => new Date(b.watchedAt) - new Date(a.watchedAt));
    },

    isWatched(media, id) {
      return cache.some((item) => item.media === media && item.id === id);
    },

    markWatched(rawItem) {
      const normalized = toWatchedItem(rawItem);
      if (!normalized) {
        return false;
      }
      const index = cache.findIndex((item) => item.media === normalized.media && item.id === normalized.id);
      if (index >= 0) {
        cache[index] = { ...cache[index], ...normalized, watchedAt: new Date().toISOString() };
      } else {
        cache.unshift(normalized);
        if (cache.length > MAX_WATCHED_ITEMS) {
          cache = cache.slice(0, MAX_WATCHED_ITEMS);
        }
      }
      persist();
      return true;
    },

    unmarkWatched(media, id) {
      const originalLength = cache.length;
      cache = cache.filter((item) => !(item.media === media && item.id === id));
      if (cache.length !== originalLength) {
        persist();
        return true;
      }
      return false;
    },

    toggleWatched(rawItem) {
      if (this.isWatched(rawItem.media, rawItem.id)) {
        this.unmarkWatched(rawItem.media, rawItem.id);
        return false;
      }
      return this.markWatched(rawItem);
    },

    stats() {
      return calculateWatchStats(cache);
    },

    importItems(items) {
      if (!Array.isArray(items)) {
        return;
      }
      const seen = new Set(cache.map((i) => `${i.media}:${i.id}`));
      for (const item of items) {
        const normalized = toWatchedItem(item);
        if (normalized && !seen.has(`${normalized.media}:${normalized.id}`)) {
          seen.add(`${normalized.media}:${normalized.id}`);
          cache.push(normalized);
        }
      }
      if (cache.length > MAX_WATCHED_ITEMS) {
        cache = cache.slice(0, MAX_WATCHED_ITEMS);
      }
      persist();
    },

    clear() {
      cache = [];
      persist();
    },
  };
}
