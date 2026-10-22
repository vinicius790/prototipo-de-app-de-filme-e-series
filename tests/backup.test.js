import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BACKUP_APP,
  BACKUP_VERSION,
  createBackupPayload,
  validateBackup,
} from '../web-vanilla/js/backup.js';
import { createListStore } from '../web-vanilla/js/lists.js';
import { createStore } from '../web-vanilla/js/store.js';
import { createWatchTimeStore } from '../web-vanilla/js/watchtime.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, val) => map.set(key, String(val)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
  };
}

const fav = (id, title = 'Filme', media = 'movie', genreIds = [28]) => ({
  id,
  media,
  title,
  rating: 8.5,
  date: '2024-01-01',
  posterPath: '/poster.jpg',
  genreIds,
});

const rev = (id, rating = 5, text = 'Muito bom!', media = 'movie', genreIds = [28]) => ({
  id,
  media,
  title: 'Filme',
  rating,
  text,
  updatedAt: '2024-01-01T00:00:00.000Z',
  genreIds,
});

test('createBackupPayload monta o envelope padronizado com versão, data e dados', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  const payload = createBackupPayload(
    {
      favorites: [fav(1, 'Matrix')],
      reviews: [rev(1, 5, 'Excelente')],
      lists: [{ id: 'lista-1', name: 'Minha Lista', items: [fav(1, 'Matrix')] }],
    },
    now,
  );

  assert.equal(payload.version, BACKUP_VERSION);
  assert.equal(payload.app, BACKUP_APP);
  assert.equal(payload.exportedAt, now.toISOString());
  assert.equal(payload.favorites.length, 1);
  assert.equal(payload.reviews.length, 1);
  assert.equal(payload.lists.length, 1);
  assert.equal(payload.favorites[0].title, 'Matrix');
  assert.equal(payload.lists[0].name, 'Minha Lista');
});

test('validateBackup aceita JSON válido e normaliza os dados', () => {
  const json = JSON.stringify({
    version: 1,
    exportedAt: '2026-10-15T12:00:00Z',
    favorites: [fav(10, 'Interestelar')],
    reviews: [rev(10, 4, 'Ótimo')],
    lists: [{ id: 'sci-fi', name: 'Ficção', items: [fav(10, 'Interestelar')] }],
  });

  const result = validateBackup(json);
  assert.equal(result.valid, true);
  assert.equal(result.data.favorites[0].title, 'Interestelar');
  assert.equal(result.data.reviews[0].rating, 4);
  assert.equal(result.data.lists[0].items.length, 1);
});

test('validateBackup recusa JSON malformado ou não-objeto', () => {
  assert.equal(validateBackup('não é json').valid, false);
  assert.equal(validateBackup('{ "incompleto": ').valid, false);
  assert.equal(validateBackup(null).valid, false);
  assert.equal(validateBackup([]).valid, false);
  assert.equal(validateBackup('texto puro').valid, false);
});

test('validateBackup recusa versão ausente, inválida ou futura', () => {
  assert.equal(validateBackup({}).valid, false);
  assert.equal(validateBackup({ version: '1' }).valid, false);
  assert.equal(validateBackup({ version: 0 }).valid, false);
  assert.equal(validateBackup({ version: 999 }).valid, false);
});

test('validateBackup recusa backup sem nenhuma coleção', () => {
  assert.equal(validateBackup({ version: 1 }).valid, false);
});

test('validateBackup filtra itens corrompidos, ids inválidos e notas fora de 1 a 5', () => {
  const result = validateBackup({
    version: 1,
    favorites: [
      fav(1, 'Válido'),
      { id: 'não-numérico', media: 'movie', title: 'Inválido' },
      { id: 2, media: 'invalida', title: 'Inválido' },
      null,
    ],
    reviews: [
      rev(1, 5, 'Bom'),
      { id: 2, media: 'movie', title: 'Nota zero', rating: 0 },
      { id: 3, media: 'movie', title: 'Nota 6', rating: 6 },
    ],
    lists: [
      { id: 'l1', name: 'Válida', items: [fav(1)] },
      { id: 'id inválido com espaços', name: 'Ruim', items: [] },
      { id: 'l2', name: '   ', items: [] },
    ],
  });

  assert.equal(result.valid, true);
  assert.equal(result.data.favorites.length, 1);
  assert.equal(result.data.favorites[0].id, 1);
  assert.equal(result.data.reviews.length, 1);
  assert.equal(result.data.reviews[0].id, 1);
  assert.equal(result.data.lists.length, 1);
  assert.equal(result.data.lists[0].id, 'l1');
});

test('integração: exportar e restaurar no store e listStore preserva dados existentes e mescla', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  const listStore = createListStore(storage);

  store.toggleFavorite(fav(1, 'Filme 1'));
  listStore.create('Lista A', [fav(1, 'Filme 1')]);

  const backup = createBackupPayload({
    favorites: [fav(2, 'Filme 2')],
    reviews: [rev(2, 5, 'Comentário')],
    lists: [{ id: 'lista-b', name: 'Lista B', items: [fav(2, 'Filme 2')] }],
  });

  const validated = validateBackup(backup);
  assert.equal(validated.valid, true);

  store.importFavorites(validated.data.favorites);
  store.importReviews(validated.data.reviews);
  listStore.importLists(validated.data.lists);

  // Favorito 1 (existente) e 2 (importado) estão presentes
  assert.equal(store.favorites().length, 2);
  assert.ok(store.isFavorite('movie', 1));
  assert.ok(store.isFavorite('movie', 2));
  assert.equal(store.review('movie', 2).text, 'Comentário');

  // Ambas as listas existem
  assert.equal(listStore.lists().length, 2);
  assert.ok(listStore.lists().some((l) => l.name === 'Lista A'));
  assert.ok(listStore.lists().some((l) => l.name === 'Lista B'));
});

test('backup com tempo assistido exporta e restaura no watchtimeStore', () => {
  const storage = memoryStorage();
  const watchStore = createWatchTimeStore(storage);

  const watched = [
    { media: 'movie', id: 100, title: 'Inception', runtime: 148, genreIds: [28, 878] },
    { media: 'tv', id: 200, title: 'Breaking Bad', episodes: 62, genreIds: [18] },
  ];

  const payload = createBackupPayload({ watchtime: watched });
  assert.equal(payload.watchtime.length, 2);
  assert.equal(payload.watchtime[0].title, 'Inception');

  const validated = validateBackup(payload);
  assert.equal(validated.valid, true);
  assert.equal(validated.data.watchtime.length, 2);

  watchStore.importItems(validated.data.watchtime);
  assert.equal(watchStore.items().length, 2);
  assert.equal(watchStore.isWatched('movie', 100), true);
  assert.equal(watchStore.isWatched('tv', 200), true);
  assert.equal(watchStore.stats().totalCount, 2);
});
