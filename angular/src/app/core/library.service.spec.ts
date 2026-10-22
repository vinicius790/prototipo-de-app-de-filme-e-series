import { TestBed } from '@angular/core/testing';

import { memoryStorage } from '../testing';
import {
  FAVORITES_KEY,
  GENRES_FORMAT_KEY,
  Favorite,
  KeyValueStorage,
  LibraryService,
  MAX_REVIEW_LENGTH,
  REVIEWS_KEY,
  STORAGE,
} from './library.service';

const matrix: Favorite = {
  id: 603,
  media: 'movie',
  title: 'Matrix',
  posterPath: '/m.jpg',
  rating: 8.2,
  date: '1999-03-31',
  genreIds: [28, 878],
};
const dark: Favorite = {
  id: 603,
  media: 'tv',
  title: 'Dark',
  posterPath: null,
  rating: 8.4,
  date: '2017-12-01',
  genreIds: [],
};

function createLibrary(storage: KeyValueStorage = memoryStorage()): LibraryService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: STORAGE, useValue: storage }] });
  return TestBed.inject(LibraryService);
}

describe('LibraryService', () => {
  it('alterna favoritos e trata filme e série com o mesmo id como títulos diferentes', () => {
    const library = createLibrary();

    expect(library.toggleFavorite(matrix)).toBe(true);
    expect(library.toggleFavorite(dark)).toBe(true);
    expect(library.isFavorite('movie', 603)).toBe(true);
    expect(library.favorites()).toEqual([matrix, dark]);

    expect(library.toggleFavorite(matrix)).toBe(false);
    expect(library.favorites()).toEqual([dark]);
  });

  it('persiste favoritos e avaliações entre sessões', () => {
    const storage = memoryStorage();
    const first = createLibrary(storage);
    first.toggleFavorite(matrix);
    first.saveReview(dark, 5, 'Ótima');

    const second = createLibrary(storage);
    expect(second.favorites()).toEqual([matrix]);
    expect(second.review('tv', 603)?.rating).toBe(5);
  });

  it('descarta dados corrompidos em vez de quebrar', () => {
    for (const value of ['{não é json', '"texto"', '{"id":1}', 'null']) {
      const library = createLibrary(
        memoryStorage({ [FAVORITES_KEY]: value, [REVIEWS_KEY]: value }),
      );
      expect(library.favorites()).toEqual([]);
      expect(library.reviews()).toEqual([]);
    }
    const mixed = JSON.stringify([matrix, null, 7, { id: 'x', media: 'movie', title: 'a' }]);
    expect(createLibrary(memoryStorage({ [FAVORITES_KEY]: mixed })).favorites()).toEqual([matrix]);
  });

  it('aceita favoritos e avaliações antigos, gravados sem gêneros', () => {
    const old = { id: 1, media: 'movie', title: 'Antigo', posterPath: null, rating: 7, date: '' };
    const library = createLibrary(
      memoryStorage({
        [FAVORITES_KEY]: JSON.stringify([old, { ...old, id: 2, genreIds: [28, 'x', 1.5] }]),
        [REVIEWS_KEY]: JSON.stringify([{ id: 1, media: 'movie', title: 'Antigo', rating: 4 }]),
      }),
    );
    expect(library.favorites().map((favorite) => favorite.genreIds)).toEqual([undefined, [28]]);
    expect('genreIds' in library.reviews()[0]).toBe(false);
  });

  it('migração única: o [] gravado até a 1.2 vira "não se sabe"; depois, [] é "conferido"', () => {
    const old = { id: 1, media: 'movie', title: 'Antigo', posterPath: null, rating: 7, date: '' };
    const storage = memoryStorage({
      [FAVORITES_KEY]: JSON.stringify([
        { ...old, genreIds: [] },
        { ...old, id: 2, genreIds: [28] },
      ]),
      [REVIEWS_KEY]: JSON.stringify([{ ...old, rating: 5, genreIds: [] }]),
    });
    const first = createLibrary(storage);
    expect(first.favorites().map((favorite) => favorite.genreIds)).toEqual([undefined, [28]]);
    expect(storage.getItem(GENRES_FORMAT_KEY)).toBe('1');
    expect('genreIds' in JSON.parse(storage.getItem(FAVORITES_KEY) ?? '[]')[0]).toBe(false);

    // O TMDB não tem gênero para o título: fica gravado [] e a próxima sessão não o esquece.
    expect(first.fillGenres('movie', 1, [])).toBe(true);
    TestBed.resetTestingModule();
    const second = createLibrary(storage);
    expect(second.favorites()[0].genreIds).toEqual([]);
    expect(second.reviews()[0].genreIds).toEqual([]);
  });

  it('fillGenres completa favorito e avaliação antigos do mesmo título e regrava', () => {
    const old = { id: 1, media: 'movie', title: 'Antigo', posterPath: null, rating: 7, date: '' };
    const storage = memoryStorage({
      [FAVORITES_KEY]: JSON.stringify([old, { ...old, media: 'tv' }, matrix]),
      [REVIEWS_KEY]: JSON.stringify([{ id: 1, media: 'movie', title: 'Antigo', rating: 5 }]),
    });
    const library = createLibrary(storage);

    expect(library.fillGenres('movie', 1, [18, 80])).toBe(true);
    expect(library.favorites().map((favorite) => favorite.genreIds)).toEqual([
      [18, 80],
      undefined,
      matrix.genreIds,
    ]);
    expect(library.reviews()[0].genreIds).toEqual([18, 80]);
    expect(JSON.parse(storage.getItem(REVIEWS_KEY) ?? '[]')[0].genreIds).toEqual([18, 80]);

    expect(library.fillGenres('movie', matrix.id, [1])).toBe(false);
    expect(library.fillGenres('movie', 1, [99])).toBe(false);
    expect(library.fillGenres('tv', 1, [])).toBe(true); // conferido, sem gênero
    expect(library.favorites()[1].genreIds).toEqual([]);
    expect(library.fillGenres('tv', 1, [5])).toBe(false);
  });

  it('favorito guarda só o resumo do título, não os detalhes inteiros', () => {
    const library = createLibrary();
    library.toggleFavorite({ ...matrix, overview: 'texto longo', cast: [1, 2] } as typeof matrix);
    expect(library.favorites()).toEqual([matrix]);
  });

  it('continua funcionando com o storage cheio', () => {
    const library = createLibrary({
      getItem: () => null,
      setItem: () => {
        throw new DOMException('cota', 'QuotaExceededError');
      },
    });
    expect(library.toggleFavorite(matrix)).toBe(true);
    expect(library.isFavorite('movie', 603)).toBe(true);
  });

  it('valida a nota e guarda uma avaliação por título', () => {
    const library = createLibrary();
    for (const rating of [0, 6, 2.5, Number.NaN]) {
      expect(() => library.saveReview(matrix, rating)).toThrow(RangeError);
    }

    const now = new Date('2026-01-02T03:04:05Z');
    library.saveReview(matrix, 3, 'bom', now);
    const review = library.saveReview(matrix, 5, '  excelente  ', now);
    expect(review).toEqual({
      id: 603,
      media: 'movie',
      title: 'Matrix',
      rating: 5,
      text: 'excelente',
      updatedAt: '2026-01-02T03:04:05.000Z',
      genreIds: [28, 878],
    });
    expect(library.reviews()).toEqual([review]);
    expect(library.saveReview(dark, 4, 'a'.repeat(5000)).text).toHaveLength(MAX_REVIEW_LENGTH);

    library.removeReview('movie', 603);
    expect(library.reviews().map((item) => item.title)).toEqual(['Dark']);
  });
});
