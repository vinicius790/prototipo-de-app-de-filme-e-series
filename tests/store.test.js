import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GENRES_FORMAT_KEY,
  MAX_REVIEW_LENGTH,
  clearApiKey,
  createStore,
  loadApiKey,
  saveApiKey,
} from '../web-vanilla/js/store.js';

/** Substituto em memória para o localStorage. */
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (name) => data.get(name) ?? null,
    setItem: (name, value) => data.set(name, String(value)),
    removeItem: (name) => data.delete(name),
  };
}

const matrix = {
  id: 603,
  media: 'movie',
  title: 'Matrix',
  posterPath: '/m.jpg',
  rating: 8.2,
  date: '1999-03-31',
  genreIds: [28, 878],
};
const dark = { id: 603, media: 'tv', title: 'Dark', posterPath: null, rating: 8.4, date: '2017-12-01', genreIds: [] };

test('toggleFavorite adiciona, remove e informa o novo estado', () => {
  const store = createStore(memoryStorage());

  assert.equal(store.isFavorite('movie', 603), false);
  assert.equal(store.toggleFavorite(matrix), true);
  assert.equal(store.isFavorite('movie', 603), true);
  assert.deepEqual(store.favorites(), [matrix]);

  assert.equal(store.toggleFavorite(matrix), false);
  assert.deepEqual(store.favorites(), []);
});

test('filme e série com o mesmo id são favoritos independentes', () => {
  const store = createStore(memoryStorage());
  store.toggleFavorite(matrix);
  store.toggleFavorite(dark);

  assert.equal(store.favorites().length, 2);
  store.toggleFavorite(matrix);
  assert.deepEqual(store.favorites(), [dark]);
});

test('favorito guarda só o resumo do título, não o objeto inteiro', () => {
  const store = createStore(memoryStorage());
  store.toggleFavorite({ ...matrix, overview: 'texto longo', cast: [1, 2, 3] });
  assert.deepEqual(store.favorites(), [matrix]);
});

test('favoritos e avaliações sobrevivem a uma nova sessão', () => {
  const storage = memoryStorage();
  const first = createStore(storage);
  first.toggleFavorite(matrix);
  first.saveReview({ media: 'tv', id: 603, title: 'Dark', rating: 5, text: 'Ótima' });

  const second = createStore(storage);
  assert.deepEqual(second.favorites(), [matrix]);
  assert.equal(second.review('tv', 603).rating, 5);
});

test('dados corrompidos no storage são descartados em vez de quebrar o app', () => {
  for (const value of ['{não é json', '"texto"', '{"id":1}', 'null']) {
    const store = createStore(
      memoryStorage({ 'movie-app:favoritos': value, 'movie-app:avaliacoes': value }),
    );
    assert.deepEqual(store.favorites(), []);
    assert.deepEqual(store.reviews(), []);
  }
});

test('entradas inválidas dentro da lista são filtradas', () => {
  const stored = JSON.stringify([
    matrix,
    null,
    7,
    { id: 'x', media: 'movie', title: 'a' },
    { id: 1, media: 'person', title: 'b' },
  ]);
  const store = createStore(memoryStorage({ 'movie-app:favoritos': stored }));
  assert.deepEqual(store.favorites(), [matrix]);
});

test('storage cheio ou bloqueado não derruba o app', () => {
  const store = createStore({
    getItem: () => null,
    setItem: () => {
      throw new DOMException('cota', 'QuotaExceededError');
    },
  });
  assert.equal(store.toggleFavorite(matrix), true);
  assert.equal(store.isFavorite('movie', 603), true);
});

test('saveReview valida a nota', () => {
  const store = createStore(memoryStorage());
  for (const rating of [0, 6, 2.5, Number.NaN, '4', undefined]) {
    assert.throws(() => store.saveReview({ media: 'movie', id: 1, title: 'x', rating }), RangeError);
  }
  assert.deepEqual(store.reviews(), []);
});

test('saveReview guarda uma avaliação por título e substitui a anterior', () => {
  const store = createStore(memoryStorage());
  const now = new Date('2026-01-02T03:04:05Z');

  store.saveReview({ media: 'movie', id: 603, title: 'Matrix', rating: 3, text: 'bom' }, now);
  const review = store.saveReview(
    { media: 'movie', id: 603, title: 'Matrix', rating: 5, text: '  excelente  ' },
    now,
  );

  assert.deepEqual(review, {
    id: 603,
    media: 'movie',
    title: 'Matrix',
    rating: 5,
    text: 'excelente',
    updatedAt: '2026-01-02T03:04:05.000Z',
  });
  assert.deepEqual(store.reviews(), [review]);
  assert.equal(store.review('tv', 603), null);
});

test('favoritos e avaliações antigos, sem gêneros, continuam válidos e ficam como "não se sabe"', () => {
  const old = { id: 1, media: 'movie', title: 'Antigo', posterPath: null, rating: 7, date: '' };
  const store = createStore(
    memoryStorage({
      'movie-app:favoritos': JSON.stringify([old, { ...old, id: 2, genreIds: [28, 'x', 1.5] }]),
      'movie-app:avaliacoes': JSON.stringify([{ id: 1, media: 'movie', title: 'Antigo', rating: 4 }]),
    }),
  );
  assert.deepEqual(
    store.favorites().map((favorite) => favorite.genreIds),
    [undefined, [28]],
  );
  assert.equal('genreIds' in store.reviews()[0], false);
  assert.deepEqual(
    store.saveReview({ media: 'tv', id: 9, title: 'Nova', rating: 5, genreIds: [18] }).genreIds,
    [18],
  );
});

test('migração única: o [] gravado até a 1.2 vira "não se sabe"; depois, [] é "conferido"', () => {
  const old = { id: 1, media: 'movie', title: 'Antigo', posterPath: null, rating: 7, date: '', genreIds: [] };
  const storage = memoryStorage({
    'movie-app:favoritos': JSON.stringify([old, { ...old, id: 2, genreIds: [28] }]),
    'movie-app:avaliacoes': JSON.stringify([{ id: 1, media: 'movie', title: 'Antigo', rating: 5, genreIds: [] }]),
  });
  const first = createStore(storage);
  assert.deepEqual(
    first.favorites().map((favorite) => favorite.genreIds),
    [undefined, [28]],
  );
  assert.equal(storage.getItem(GENRES_FORMAT_KEY), '1');
  assert.equal('genreIds' in JSON.parse(storage.getItem('movie-app:favoritos'))[0], false, 'regravado');
  assert.equal('genreIds' in JSON.parse(storage.getItem('movie-app:avaliacoes'))[0], false);

  // O TMDB não tem gênero para o título: fica gravado [] e uma nova sessão não o esquece.
  assert.equal(first.fillGenres('movie', 1, []), true);
  const second = createStore(storage);
  assert.deepEqual(second.favorites()[0].genreIds, []);
  assert.deepEqual(second.reviews()[0].genreIds, []);
});

test('fillGenres grava os gêneros de quem ainda não tem o campo, em favorito e avaliação', () => {
  const unknown = { id: 1, media: 'movie', title: 'Antigo', posterPath: null, rating: 7, date: '' };
  const storage = memoryStorage({
    [GENRES_FORMAT_KEY]: '1',
    'movie-app:favoritos': JSON.stringify([
      unknown,
      { ...unknown, media: 'tv' },
      { ...matrix },
      { ...unknown, id: 5, genreIds: [] },
    ]),
    'movie-app:avaliacoes': JSON.stringify([{ id: 1, media: 'movie', title: 'Antigo', rating: 5 }]),
  });
  const store = createStore(storage);

  assert.equal(store.fillGenres('movie', 1, [18, 'x', 80]), true);
  assert.deepEqual(store.favorites()[0].genreIds, [18, 80]);
  assert.equal('genreIds' in store.favorites()[1], false, 'a série de mesmo id não muda');
  assert.deepEqual(store.reviews()[0].genreIds, [18, 80]);
  assert.deepEqual(createStore(storage).reviews()[0].genreIds, [18, 80], 'gravado no storage');

  assert.equal(store.fillGenres('movie', 603, [1]), false, 'quem já tem gênero não é sobrescrito');
  assert.deepEqual(store.favorites()[2].genreIds, [28, 878]);
  assert.equal(store.fillGenres('movie', 5, [1]), false, '[] = já conferido');
  assert.equal(store.fillGenres('movie', 1, [99]), false, 'já completado');
  assert.equal(store.fillGenres('movie', 42, [1]), false, 'título desconhecido');
});

test('comentário é limitado ao tamanho máximo', () => {
  const store = createStore(memoryStorage());
  const review = store.saveReview({ media: 'movie', id: 1, title: 'x', rating: 4, text: 'a'.repeat(5000) });
  assert.equal(review.text.length, MAX_REVIEW_LENGTH);
});

test('removeReview apaga só a avaliação pedida', () => {
  const store = createStore(memoryStorage());
  store.saveReview({ media: 'movie', id: 603, title: 'Matrix', rating: 4 });
  store.saveReview({ media: 'tv', id: 603, title: 'Dark', rating: 5 });

  store.removeReview('movie', 603);
  assert.deepEqual(
    store.reviews().map((review) => review.title),
    ['Dark'],
  );
});

test('loadApiKey prefere config.js, depois o navegador', async () => {
  const storage = memoryStorage();
  const missingFile = () => Promise.reject(new Error('404'));

  assert.deepEqual(await loadApiKey(storage, missingFile), { apiKey: '', source: 'none' });

  saveApiKey(storage, 'chave-do-navegador');
  assert.deepEqual(await loadApiKey(storage, missingFile), {
    apiKey: 'chave-do-navegador',
    source: 'browser',
  });

  const fromFile = async () => ({ default: { apiKey: '  chave-do-arquivo  ' } });
  assert.deepEqual(await loadApiKey(storage, fromFile), { apiKey: 'chave-do-arquivo', source: 'file' });

  // config.js copiado do modelo, ainda em branco, não esconde a chave salva pela tela.
  const blankFile = async () => ({ default: { apiKey: '' } });
  assert.equal((await loadApiKey(storage, blankFile)).source, 'browser');

  clearApiKey(storage);
  assert.deepEqual(await loadApiKey(storage, missingFile), { apiKey: '', source: 'none' });
});
