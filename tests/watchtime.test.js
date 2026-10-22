import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_SERIES_EPISODE_MINUTES,
  MAX_WATCHED_ITEMS,
  calculateWatchStats,
  createWatchTimeStore,
  formatWatchDuration,
  isWatchedEntry,
  toWatchedItem,
} from '../web-vanilla/js/watchtime.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, val) => map.set(key, String(val)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
  };
}

const movieItem = (id, title = 'Filme A', runtime = 120, genreIds = [28, 12]) => ({
  media: 'movie',
  id,
  title,
  runtime,
  posterPath: '/poster.jpg',
  genreIds,
});

const tvItem = (id, title = 'Série B', episodes = 10, genreIds = [18]) => ({
  media: 'tv',
  id,
  title,
  episodes,
  runtime: 0,
  posterPath: '/tv.jpg',
  genreIds,
});

test('isWatchedEntry valida o tipo e campos obrigatórios', () => {
  assert.equal(isWatchedEntry(null), false);
  assert.equal(isWatchedEntry('texto'), false);
  assert.equal(isWatchedEntry({}), false);
  assert.equal(isWatchedEntry({ media: 'book', id: 1, title: 'Livro' }), false);
  assert.equal(isWatchedEntry({ media: 'movie', id: '1', title: 'Filme' }), false);
  assert.equal(isWatchedEntry({ media: 'movie', id: 1 }), false);
  assert.equal(isWatchedEntry({ media: 'movie', id: 1, title: 'Matrix' }), true);
  assert.equal(isWatchedEntry({ media: 'tv', id: 2, title: 'Dark' }), true);
});

test('toWatchedItem normaliza filmes e calcula duração estimada para séries', () => {
  const now = new Date('2026-10-16T12:00:00Z');
  const movie = toWatchedItem(movieItem(1, 'Matrix', 136), now);
  assert.equal(movie.media, 'movie');
  assert.equal(movie.id, 1);
  assert.equal(movie.title, 'Matrix');
  assert.equal(movie.runtime, 136);
  assert.equal(movie.watchedAt, now.toISOString());
  assert.deepEqual(movie.genreIds, [28, 12]);

  // Série com episódios conhecidos: episódios * DEFAULT_SERIES_EPISODE_MINUTES
  const tvWithEpisodes = toWatchedItem(tvItem(2, 'Dark', 26), now);
  assert.equal(tvWithEpisodes.runtime, 26 * DEFAULT_SERIES_EPISODE_MINUTES);

  // Série sem episódios mas com temporadas: temporadas * 10 * 45
  const tvWithSeasons = toWatchedItem({ media: 'tv', id: 3, title: 'Série C', seasons: 2 }, now);
  assert.equal(tvWithSeasons.runtime, 2 * 10 * DEFAULT_SERIES_EPISODE_MINUTES);

  // Série sem temporadas nem episódios: assume 1 episódio
  const tvDefault = toWatchedItem({ media: 'tv', id: 4, title: 'Série D' }, now);
  assert.equal(tvDefault.runtime, DEFAULT_SERIES_EPISODE_MINUTES);

  // Dados inválidos retornam null
  assert.equal(toWatchedItem(null), null);
  assert.equal(toWatchedItem({ media: 'unknown', id: 9 }), null);
});

test('formatWatchDuration formata minutos em dias, horas e minutos legíveis', () => {
  assert.equal(formatWatchDuration(0), '0 minutos');
  assert.equal(formatWatchDuration(1), '1 minuto');
  assert.equal(formatWatchDuration(45), '45 minutos');
  assert.equal(formatWatchDuration(60), '1 hora');
  assert.equal(formatWatchDuration(75), '1 hora e 15 minutos');
  assert.equal(formatWatchDuration(1440), '1 dia');
  assert.equal(formatWatchDuration(1500), '1 dia e 1 hora');
  assert.equal(formatWatchDuration(1530), '1 dia, 1 hora e 30 minutos');
  assert.equal(formatWatchDuration(2940), '2 dias e 1 hora');
});

test('calculateWatchStats consolida tempo total, contagens e gêneros', () => {
  const items = [
    toWatchedItem(movieItem(1, 'Matrix', 136, [28, 878])),
    toWatchedItem(movieItem(2, 'O Poderoso Chefão', 175, [18, 80])),
    toWatchedItem(tvItem(3, 'Breaking Bad', 10, [18, 80])), // 10 * 45 = 450 min
  ];

  const stats = calculateWatchStats(items);
  assert.equal(stats.totalCount, 3);
  assert.equal(stats.movieCount, 2);
  assert.equal(stats.showCount, 1);
  assert.equal(stats.totalMinutes, 136 + 175 + 450); // 761 min
  assert.equal(stats.longestItem.title, 'Breaking Bad');
  assert.equal(stats.averageMinutesPerTitle, Math.round(761 / 3));

  // Distribuição por gênero
  const drama = stats.genreDistribution.find((g) => g.genreId === 18);
  assert.ok(drama);
  assert.equal(drama.count, 2);
  assert.equal(drama.minutes, 175 + 450);
});

test('calculateWatchStats tolera lista vazia ou nulos', () => {
  const emptyStats = calculateWatchStats([]);
  assert.equal(emptyStats.totalCount, 0);
  assert.equal(emptyStats.movieCount, 0);
  assert.equal(emptyStats.showCount, 0);
  assert.equal(emptyStats.totalMinutes, 0);
  assert.equal(emptyStats.formattedDuration, '0 minutos');
  assert.equal(emptyStats.longestItem, null);
  assert.deepEqual(emptyStats.genreDistribution, []);
});

test('createWatchTimeStore gerencia inclusão, exclusão e alternância com persistência', () => {
  const storage = memoryStorage();
  const store = createWatchTimeStore(storage);

  assert.equal(store.isWatched('movie', 1), false);
  assert.equal(store.items().length, 0);

  // Marca como assistido
  assert.equal(store.markWatched(movieItem(1, 'Matrix', 136)), true);
  assert.equal(store.isWatched('movie', 1), true);
  assert.equal(store.items().length, 1);
  assert.equal(store.items()[0].title, 'Matrix');

  // Alternância (toggle) remove o existente
  const toggledOff = store.toggleWatched(movieItem(1, 'Matrix', 136));
  assert.equal(toggledOff, false);
  assert.equal(store.isWatched('movie', 1), false);
  assert.equal(store.items().length, 0);

  // Alternância inclui novamente
  const toggledOn = store.toggleWatched(movieItem(1, 'Matrix', 136));
  assert.equal(toggledOn, true);
  assert.equal(store.isWatched('movie', 1), true);

  // Sobrevive a nova instância (persistência em storage)
  const store2 = createWatchTimeStore(storage);
  assert.equal(store2.isWatched('movie', 1), true);
  assert.equal(store2.items().length, 1);
});

test('createWatchTimeStore recupera de dados corrompidos ou envelope sem versão', () => {
  const corruptStorage = memoryStorage({
    'movie-app:tempo-assistido': '{ "invalid": json',
  });
  const store = createWatchTimeStore(corruptStorage);
  assert.deepEqual(store.items(), []);

  // Envelope formato legado (array puro)
  const legacyStorage = memoryStorage({
    'movie-app:tempo-assistido': JSON.stringify([
      { media: 'movie', id: 5, title: 'Interstellar', runtime: 169 },
    ]),
  });
  const legacyStore = createWatchTimeStore(legacyStorage);
  assert.equal(legacyStore.isWatched('movie', 5), true);
  assert.equal(legacyStore.items()[0].runtime, 169);
});

test('createWatchTimeStore importa itens mantendo unicidade', () => {
  const storage = memoryStorage();
  const store = createWatchTimeStore(storage);

  store.markWatched(movieItem(1, 'Filme 1'));
  store.importItems([
    movieItem(1, 'Filme 1 com outro dado'), // repetido: não duplica
    movieItem(2, 'Filme 2'),
    { invalid: 'item' },
  ]);

  assert.equal(store.items().length, 2);
  assert.equal(store.isWatched('movie', 2), true);
});

test('createWatchTimeStore respeita limite máximo de itens e tolera falha de storage', () => {
  const storage = memoryStorage();
  const store = createWatchTimeStore(storage);

  // Insere muitos itens
  const many = Array.from({ length: 50 }, (_, i) => movieItem(i + 1, `Filme ${i + 1}`));
  store.importItems(many);
  assert.equal(store.items().length, 50);

  // Simula storage bloqueado
  const failingStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {},
  };
  const safeStore = createWatchTimeStore(failingStorage);
  // Não lança exceção
  assert.doesNotThrow(() => safeStore.markWatched(movieItem(1, 'Teste')));
});
