import type { Favorite } from './library.service';
import {
  MAX_LISTS,
  MAX_LIST_ITEMS,
  MAX_LIST_NAME,
  addItem,
  createList,
  decodeShare,
  encodeShare,
  migrateLists,
  moveItem,
  removeItem,
  renameList,
  serializeLists,
} from './lists.util';

const NOW = '2026-05-06T07:08:09.000Z';

const title = (id: number, media: 'movie' | 'tv' = 'movie', name = `Título ${id}`): Favorite => ({
  id,
  media,
  title: name,
  posterPath: null,
  rating: 0,
  date: '',
  genreIds: [],
});

/** O link não leva gêneros: o título importado fica com gênero "ainda não se sabe" (sem o campo). */
function bare(item: Favorite): Favorite {
  const copy = { ...item };
  delete copy.genreIds;
  return copy;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url de um JSON qualquer (formato sem compressão), para montar links inválidos. */
function encodeRaw(payload: unknown): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

async function deflate(text: string): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  const reader = source.pipeThrough(new CompressionStream('deflate-raw')).getReader();
  const chunks: number[] = [];
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    chunks.push(...next.value);
  }
  return Uint8Array.from(chunks);
}

/** Formato comprimido: `z` + deflate-raw em base64url. */
async function encodeZip(payload: unknown): Promise<string> {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return `z${toBase64Url(await deflate(text))}`;
}

describe('listas personalizadas: operações', () => {
  it('cria, renomeia e valida o nome', () => {
    const lists = createList([], '  Para   o fim de semana ', [], NOW, 'a');
    expect(lists).toEqual([
      { id: 'a', name: 'Para o fim de semana', items: [], createdAt: NOW, updatedAt: NOW },
    ]);
    expect(renameList(lists, 'a', 'Clássicos', 'depois')[0]).toMatchObject({
      name: 'Clássicos',
      updatedAt: 'depois',
    });
    expect(renameList(lists, 'outra', 'x', NOW)).toBe(lists);

    for (const name of ['', '   ', null, 7]) {
      expect(() => createList([], name, [], NOW, 'b')).toThrow(RangeError);
    }
    expect(() => renameList(lists, 'a', ' ', NOW)).toThrow(RangeError);
    expect(createList([], 'n'.repeat(500), [], NOW, 'c')[0].name).toHaveLength(MAX_LIST_NAME);
  });

  it('respeita o limite de listas e de títulos por lista', () => {
    let lists = createList([], 'Primeira', [], NOW, 'id-0');
    for (let index = 1; index < MAX_LISTS; index += 1) {
      lists = createList(lists, `Lista ${index}`, [], NOW, `id-${index}`);
    }
    expect(() => createList(lists, 'Uma a mais', [], NOW, 'extra')).toThrow(RangeError);

    const many = Array.from({ length: MAX_LIST_ITEMS + 5 }, (_, index) => title(index + 1));
    const full = createList([], 'Cheia', many, NOW, 'cheia');
    expect(full[0].items).toHaveLength(MAX_LIST_ITEMS);
    expect(addItem(full, 'cheia', title(99999), NOW)).toBe(full);
  });

  it('adiciona sem duplicar e remove; filme e série com o mesmo id são distintos', () => {
    let lists = createList([], 'Mistura', [], NOW, 'm');
    lists = addItem(lists, 'm', { ...title(603), overview: 'não é guardado' }, NOW);
    expect(addItem(lists, 'm', title(603), NOW)).toBe(lists);
    lists = addItem(lists, 'm', title(603, 'tv'), NOW);
    expect(addItem(lists, 'm', { id: 'x', media: 'movie', title: 'inválido' }, NOW)).toBe(lists);
    expect(lists[0].items).toEqual([title(603), title(603, 'tv')]);

    lists = removeItem(lists, 'm', 'movie', 603, NOW);
    expect(lists[0].items).toEqual([title(603, 'tv')]);
    expect(removeItem(lists, 'm', 'movie', 603, NOW)).toBe(lists);
  });

  it('reordena e ignora posições inválidas', () => {
    let lists = createList([], 'Ordem', [title(1), title(2), title(3)], NOW, 'o');
    const order = () => lists[0].items.map((item) => item.id);

    lists = moveItem(lists, 'o', 0, 2, NOW);
    expect(order()).toEqual([2, 3, 1]);
    lists = moveItem(lists, 'o', 2, 1, NOW);
    expect(order()).toEqual([2, 1, 3]);

    for (const [from, to] of [
      [0, 0],
      [-1, 1],
      [0, 3],
      [1.5, 0],
    ]) {
      expect(moveItem(lists, 'o', from, to, NOW)).toBe(lists);
    }
    expect(moveItem(lists, 'não-existe', 0, 1, NOW)).toBe(lists);
  });
});

describe('listas personalizadas: versão e migração', () => {
  it('grava com número de versão e lê de volta', () => {
    const lists = createList([], 'Persistente', [title(603)], NOW, 'p');
    const raw = serializeLists(lists);
    expect(JSON.parse(raw).version).toBe(1);
    expect(migrateLists(raw)).toEqual(lists);
  });

  it('migra o formato sem versão (só o array), preenchendo as datas', () => {
    const v0 = JSON.stringify([
      { id: 'antiga', name: 'Antiga', items: [{ id: 603, media: 'movie', title: 'Matrix' }] },
    ]);
    expect(migrateLists(v0, new Date(NOW))).toEqual([
      {
        id: 'antiga',
        name: 'Antiga',
        items: [bare(title(603, 'movie', 'Matrix'))],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
  });

  it('descarta lixo, listas inválidas, ids repetidos e títulos repetidos', () => {
    for (const raw of [null, '', '{não é json', '"texto"', '{"version":1}', '{"lists":[]}']) {
      expect(migrateLists(raw)).toEqual([]);
    }
    const raw = JSON.stringify({
      version: 1,
      lists: [
        {
          id: 'a',
          name: 'Boa',
          items: [title(1), title(1), null, { id: 2, media: 'person', title: 'x' }],
          createdAt: 'c',
          updatedAt: 'u',
        },
        { id: 'a', name: 'Id repetido', items: [] },
        { id: 'tem espaço', name: 'Id inválido', items: [] },
        { id: 'b', name: '  ', items: [] },
        { id: 'c', name: 'Sem itens' },
        null,
      ],
    });
    expect(migrateLists(raw)).toEqual([
      { id: 'a', name: 'Boa', items: [title(1)], createdAt: 'c', updatedAt: 'u' },
    ]);
  });

  it('lê o mesmo formato gravado pela versão web-vanilla', () => {
    const vanilla =
      '{"version":1,"lists":[{"id":"mf1-ab","name":"Da outra versão","items":' +
      '[{"id":1399,"media":"tv","title":"Dark","posterPath":null,"rating":0,"date":"",' +
      '"genreIds":[18]}],"createdAt":"c","updatedAt":"u"}]}';
    expect(migrateLists(vanilla)[0].items[0]).toEqual({
      ...title(1399, 'tv', 'Dark'),
      genreIds: [18],
    });
  });
});

describe('listas personalizadas: compartilhamento por link', () => {
  it('ida e volta preserva nome, ordem e acentos, e o código cabe na URL', async () => {
    const list = {
      name: 'Ação & “clássicos” 日本',
      items: [title(603, 'movie', 'Matrix'), title(1399, 'tv', 'A Guerra dos Tronos — ação')],
    };
    const code = await encodeShare(list);
    expect(code).toMatch(/^[\w-]+$/);
    expect(await decodeShare(code)).toEqual({ ...list, items: list.items.map(bare) });
  });

  it('o link usa o mesmo formato da versão web-vanilla e não leva dados pessoais', async () => {
    const code = await encodeShare({
      name: 'Lista',
      items: [
        { ...title(603, 'movie', 'Matrix'), posterPath: '/p.jpg', rating: 9, genreIds: [28] },
      ],
    });
    // Curta demais para a compressão compensar: sai no formato sem compressão.
    expect(code).toBe(encodeRaw({ v: 1, n: 'Lista', i: [[0, 603, 'Matrix']] }));
  });

  it('lista longa vira um link comprimido bem mais curto, e de volta igual', async () => {
    const items = Array.from({ length: MAX_LIST_ITEMS }, (_, index) =>
      title(index + 1, index % 2 ? 'tv' : 'movie', `Título de exemplo número ${index + 1}`),
    );
    const plain = encodeRaw({
      v: 1,
      n: 'Maratona',
      i: items.map((item) => [item.media === 'tv' ? 1 : 0, item.id, item.title]),
    });
    const code = await encodeShare({ name: 'Maratona', items });
    expect(code.startsWith('z')).toBe(true);
    expect(code.length).toBeLessThan(plain.length / 3);
    expect(await decodeShare(code)).toEqual({ name: 'Maratona', items: items.map(bare) });
  });

  it('lê o código comprimido gerado pela versão web-vanilla e o formato 1.1', async () => {
    const vanilla =
      'zq1YqU7Iy1FHKU7JScklUKEstKj68OF-hoLQoUUlHKVPJKjraQMfMwEBHKeTw2pLSnHyFlFSF1IrU3IKcfAVDpVidaEMdMwNDrNJGIGmQbiOs0sYw3cZYpU1guk2wSpvCdJtilTZTio2tBQA';
    const shared = await decodeShare(vanilla);
    expect(shared?.name).toBe('Da versão pura');
    expect(shared?.items.map((item) => `${item.media}:${item.id}:${item.title}`)).toEqual(
      Array.from(
        { length: 6 },
        (_, index) => `${index % 2 ? 'tv' : 'movie'}:${600 + index}:Título de exemplo ${index + 1}`,
      ),
    );
    expect(await decodeShare(encodeRaw({ v: 1, n: 'Antiga', i: [[1, 1399, 'Dark']] }))).toEqual({
      name: 'Antiga',
      items: [bare(title(1399, 'tv', 'Dark'))],
    });
  });

  it('recusa o link inteiro quando qualquer parte está fora do formato', async () => {
    const valid = { v: 1, n: 'Lista', i: [[0, 603, 'Matrix']] };
    expect(await decodeShare(encodeRaw(valid))).not.toBeNull();
    expect(await decodeShare(await encodeZip(valid))).not.toBeNull();

    const invalid: unknown[] = [
      { ...valid, v: 2 },
      { ...valid, n: '   ' },
      { ...valid, i: 'x' },
      { ...valid, i: [[2, 603, 'Matrix']] },
      { ...valid, i: [[0, -1, 'Matrix']] },
      { ...valid, i: [[0, '603', 'Matrix']] },
      { ...valid, i: [[0, 603, '']] },
      { ...valid, i: [[0, 603]] },
      {
        ...valid,
        i: Array.from({ length: MAX_LIST_ITEMS + 1 }, (_, index) => [0, index + 1, 'x']),
      },
      null,
      [],
    ];
    for (const payload of invalid) {
      expect(await decodeShare(encodeRaw(payload))).toBeNull();
      expect(await decodeShare(await encodeZip(payload))).toBeNull();
    }
    const truncated = (await encodeZip(valid)).slice(0, -6);
    for (const code of [undefined, 7, '', 'não é base64!', '<script>', 'AAAA', 'z', truncated]) {
      expect(await decodeShare(code)).toBeNull();
    }
  });

  it('recusa código comprimido que se expande demais', async () => {
    const bomb = await encodeZip(`{"v":1,"n":"x","i":[],"p":"${' '.repeat(10 * 1024 * 1024)}"}`);
    expect(bomb.length).toBeLessThan(40000);
    expect(await decodeShare(bomb)).toBeNull();
  });

  it('corta nome e títulos longos, une repetidos e mantém texto hostil como texto', async () => {
    const shared = await decodeShare(
      encodeRaw({
        v: 1,
        n: 'n'.repeat(500),
        i: [
          [0, 1, 't'.repeat(900)],
          [0, 1, 'repetido'],
          [1, 1, '<img src=x onerror=alert(1)>'],
        ],
      }),
    );
    expect(shared?.name).toHaveLength(MAX_LIST_NAME);
    expect(shared?.items).toHaveLength(2);
    expect(shared?.items[0].title).toHaveLength(200);
    expect(shared?.items[1]).toMatchObject({ media: 'tv', title: '<img src=x onerror=alert(1)>' });
  });
});
