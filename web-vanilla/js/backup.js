// Exportação e importação de backup completo (favoritos, listas e avaliações) em formato JSON.
// Valida o esquema contra dados malformados ou hostis antes de gravar no storage.

import { cleanListName, MAX_LISTS, MAX_LIST_ITEMS, toList } from './lists.js';
import { isEntry, toFavorite, toReview, isValidRating } from './store.js';
import { toWatchedItem } from './watchtime.js';

export const BACKUP_VERSION = 1;
export const BACKUP_APP = 'movie-app';
export const MAX_BACKUP_FAVORITES = 500;
export const MAX_BACKUP_REVIEWS = 500;
export const MAX_BACKUP_WATCHED = 1000;

const asString = (value) => (typeof value === 'string' ? value : '');

/**
 * Cria o objeto de backup completo com número de versão e timestamp.
 */
export function createBackupPayload({ favorites = [], reviews = [], lists = [], watchtime = [] }, now = new Date()) {
  return {
    version: BACKUP_VERSION,
    app: BACKUP_APP,
    exportedAt: now.toISOString(),
    favorites: favorites.slice(0, MAX_BACKUP_FAVORITES).map(toFavorite),
    reviews: reviews.slice(0, MAX_BACKUP_REVIEWS).map(toReview),
    lists: lists.slice(0, MAX_LISTS).map((list) => ({
      id: list.id,
      name: cleanListName(list.name),
      createdAt: list.createdAt || now.toISOString(),
      updatedAt: list.updatedAt || now.toISOString(),
      items: list.items.slice(0, MAX_LIST_ITEMS).map(toFavorite),
    })),
    watchtime: watchtime
      .slice(0, MAX_BACKUP_WATCHED)
      .map((item) => toWatchedItem(item))
      .filter(Boolean),
  };
}

/**
 * Valida rigorosamente a estrutura e os tipos de um arquivo de backup em JSON.
 * @param {string|object} raw texto JSON ou objeto já parseado
 * @returns {{valid: boolean, error?: string, data?: {version: number, exportedAt: string, favorites: object[], reviews: object[], lists: object[], watchtime: object[]}}}
 */
export function validateBackup(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { valid: false, error: 'Arquivo JSON inválido ou corrompido.' };
    }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, error: 'O conteúdo precisa ser um objeto JSON válido.' };
  }

  if (!Number.isInteger(parsed.version) || parsed.version < 1) {
    return { valid: false, error: 'Versão de backup inválida ou ausente.' };
  }

  if (parsed.version > BACKUP_VERSION) {
    return { valid: false, error: `Versão de backup (${parsed.version}) não suportada por este aplicativo.` };
  }

  const rawFavs = parsed.favorites;
  const rawRevs = parsed.reviews;
  const rawLists = parsed.lists;
  const rawWatched = parsed.watchtime;

  if (!Array.isArray(rawFavs) && !Array.isArray(rawRevs) && !Array.isArray(rawLists) && !Array.isArray(rawWatched)) {
    return { valid: false, error: 'O backup não contém nenhuma lista, favorito ou avaliação.' };
  }

  // Sanitização de favoritos
  const favorites = [];
  const seenFavs = new Set();
  for (const item of Array.isArray(rawFavs) ? rawFavs : []) {
    if (isEntry(item)) {
      const key = `${item.media}:${item.id}`;
      if (!seenFavs.has(key)) {
        seenFavs.add(key);
        favorites.push(toFavorite(item));
      }
    }
  }

  // Sanitização de avaliações
  const reviews = [];
  const seenRevs = new Set();
  for (const item of Array.isArray(rawRevs) ? rawRevs : []) {
    if (isEntry(item) && isValidRating(item.rating)) {
      const key = `${item.media}:${item.id}`;
      if (!seenRevs.has(key)) {
        seenRevs.add(key);
        reviews.push(toReview(item));
      }
    }
  }

  // Sanitização de listas
  const lists = [];
  const seenLists = new Set();
  const fallbackDate = asString(parsed.exportedAt) || new Date().toISOString();
  for (const item of Array.isArray(rawLists) ? rawLists : []) {
    const validList = toList(item, fallbackDate);
    if (validList !== null && !seenLists.has(validList.id)) {
      seenLists.add(validList.id);
      lists.push(validList);
    }
  }

  // Sanitização de tempo assistido
  const watchtime = [];
  const seenWatched = new Set();
  for (const item of Array.isArray(rawWatched) ? rawWatched : []) {
    const validWatched = toWatchedItem(item);
    if (validWatched !== null) {
      const key = `${validWatched.media}:${validWatched.id}`;
      if (!seenWatched.has(key)) {
        seenWatched.add(key);
        watchtime.push(validWatched);
      }
    }
  }

  return {
    valid: true,
    data: {
      version: parsed.version,
      exportedAt: asString(parsed.exportedAt) || fallbackDate,
      favorites: favorites.slice(0, MAX_BACKUP_FAVORITES),
      reviews: reviews.slice(0, MAX_BACKUP_REVIEWS),
      lists: lists.slice(0, MAX_LISTS),
      watchtime: watchtime.slice(0, MAX_BACKUP_WATCHED),
    },
  };
}

/**
 * Dispara o download no navegador do arquivo de backup em JSON.
 */
export function downloadBackupFile(payload, filename = `movie-app-backup-${new Date().toISOString().slice(0, 10)}.json`) {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Lê o arquivo fornecido pelo usuário via <input type="file"> e valida o esquema.
 * @param {File} file
 * @returns {Promise<{valid: boolean, error?: string, data?: object}>}
 */
export async function readBackupFile(file) {
  if (!file) {
    return { valid: false, error: 'Nenhum arquivo selecionado.' };
  }
  if (file.size > 2 * 1024 * 1024) {
    return { valid: false, error: 'O arquivo é grande demais (limite de 2 MB).' };
  }
  try {
    const text = await file.text();
    return validateBackup(text);
  } catch {
    return { valid: false, error: 'Não foi possível ler o arquivo selecionado.' };
  }
}
