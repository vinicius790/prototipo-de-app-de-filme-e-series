import { TestBed } from '@angular/core/testing';

import { memoryStorage } from '../testing';
import { Favorite, KeyValueStorage, STORAGE } from './library.service';
import { ListsService } from './lists.service';
import { LISTS_KEY } from './lists.util';

const matrix: Favorite = {
  id: 603,
  media: 'movie',
  title: 'Matrix',
  posterPath: '/m.jpg',
  rating: 8.2,
  date: '1999-03-31',
  genreIds: [28],
};
const dark: Favorite = { ...matrix, media: 'tv', title: 'Dark', genreIds: [18] };

function createLists(storage: KeyValueStorage = memoryStorage()): ListsService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: STORAGE, useValue: storage }] });
  return TestBed.inject(ListsService);
}

describe('ListsService', () => {
  it('cria, renomeia, reordena e exclui, persistindo com número de versão', () => {
    const storage = memoryStorage();
    const lists = createLists(storage);
    const { id } = lists.create('Clássicos', [matrix]);

    expect(lists.addItem(id, dark)).toBe(true);
    expect(lists.addItem(id, dark)).toBe(false);
    expect(lists.hasItem(id, 'tv', 603)).toBe(true);
    expect(lists.moveItem(id, 1, 0)).toBe(true);
    expect(lists.rename(id, 'Favoritos da vida')).toBe(true);
    expect(() => lists.rename(id, '  ')).toThrow(RangeError);

    const saved = JSON.parse(storage.getItem(LISTS_KEY) ?? 'null');
    expect(saved.version).toBe(1);
    expect(saved.lists[0].name).toBe('Favoritos da vida');

    const again = createLists(storage);
    expect(again.get(id)?.items.map((item) => item.title)).toEqual(['Dark', 'Matrix']);

    again.remove(id);
    expect(again.lists()).toEqual([]);
    expect(createLists(storage).lists()).toEqual([]);
  });

  it('migra o formato antigo e o regrava no atual', () => {
    const storage = memoryStorage({
      [LISTS_KEY]: JSON.stringify([{ id: 'v0', name: 'Antiga', items: [matrix] }]),
    });
    const lists = createLists(storage);

    expect(lists.get('v0')?.items).toEqual([matrix]);
    expect(JSON.parse(storage.getItem(LISTS_KEY) ?? 'null').version).toBe(1);
  });

  it('dado corrompido vira lista vazia e o storage cheio não derruba o serviço', () => {
    expect(createLists(memoryStorage({ [LISTS_KEY]: '{não é json' })).lists()).toEqual([]);

    const lists = createLists({
      getItem: () => null,
      setItem: () => {
        throw new DOMException('cota', 'QuotaExceededError');
      },
    });
    const { id } = lists.create('Só nesta sessão');
    expect(lists.addItem(id, matrix)).toBe(true);
    expect(lists.get(id)?.items).toHaveLength(1);
  });
});
