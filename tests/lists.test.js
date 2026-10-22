import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

import {
  LISTS_KEY,
  LISTS_VERSION,
  MAX_LISTS,
  MAX_LIST_ITEMS,
  MAX_LIST_NAME,
  createListStore,
  decodeShare,
  encodeShare,
  migrateLists,
} from '../web-vanilla/js/lists.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (name) => data.get(name) ?? null,
    setItem: (name, value) => data.set(name, String(value)),
    removeItem: (name) => data.delete(name),
  };
}

const NOW = new Date('2026-05-06T07:08:09Z');
const STAMP = NOW.toISOString();

/** Loja com relógio e ids previsíveis. */
function newStore(storage = memoryStorage()) {
  let count = 0;
  return createListStore(storage, { now: () => NOW, newId: () => `lista-${(count += 1)}` });
}

const title = (id, media = 'movie', name = `Título ${id}`) => ({
  id,
  media,
  title: name,
  posterPath: null,
  rating: 0,
  date: '',
  genreIds: [],
});

/** O link não leva gêneros: o título importado fica com gênero "ainda não se sabe" (sem o campo). */
const bare = ({ genreIds, ...rest }) => rest;

/** Formato sem compressão (o da versão 1.1). */
const encodeRaw = (payload) => Buffer.from(JSON.stringify(payload)).toString('base64url');
/** Formato comprimido: `z` + deflate-raw em base64url. */
const encodeZip = (payload) =>
  `z${deflateRawSync(Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload))).toString('base64url')}`;
/** Lê o JSON de um código em qualquer dos dois formatos (para inspecionar o que vai no link). */
const readCode = (code) =>
  JSON.parse(
    code.startsWith('z')
      ? inflateRawSync(Buffer.from(code.slice(1), 'base64url')).toString('utf8')
      : Buffer.from(code, 'base64url').toString('utf8'),
  );

test('cria, renomeia e exclui listas', () => {
  const store = newStore();
  const list = store.create('  Para   ver  no fim de semana ');

  assert.deepEqual(list, {
    id: 'lista-1',
    name: 'Para ver no fim de semana',
    items: [],
    createdAt: STAMP,
    updatedAt: STAMP,
  });
  assert.equal(store.rename('lista-1', 'Clássicos').name, 'Clássicos');
  assert.equal(store.get('lista-1').name, 'Clássicos');
  assert.equal(store.rename('não-existe', 'x'), null);

  store.create('Outra');
  store.remove('lista-1');
  assert.deepEqual(
    store.lists().map((entry) => entry.name),
    ['Outra'],
  );
  assert.equal(store.get('lista-1'), null);
});

test('nome vazio é recusado e nome longo é cortado', () => {
  const store = newStore();
  for (const name of ['', '   ', null, undefined, 7]) {
    assert.throws(() => store.create(name), RangeError);
  }
  const list = store.create('a'.repeat(500));
  assert.equal(list.name.length, MAX_LIST_NAME);
  assert.throws(() => store.rename(list.id, '  '), RangeError);
  assert.equal(store.get(list.id).name.length, MAX_LIST_NAME, 'o nome anterior é mantido');
});

test('há um limite de listas', () => {
  const store = newStore();
  for (let index = 0; index < MAX_LISTS; index += 1) {
    store.create(`Lista ${index}`);
  }
  assert.throws(() => store.create('Uma a mais'), RangeError);
  assert.equal(store.lists().length, MAX_LISTS);
});

test('adiciona e remove títulos sem duplicar; filme e série com o mesmo id são distintos', () => {
  const store = newStore();
  const { id } = store.create('Mistura');

  assert.equal(store.addItem(id, { ...title(603), overview: 'não deve ser guardado' }), true);
  assert.equal(store.addItem(id, title(603)), false, 'repetido');
  assert.equal(store.addItem(id, title(603, 'tv')), true);
  assert.equal(store.addItem('não-existe', title(1)), false);
  assert.equal(store.addItem(id, { id: 'x', media: 'movie', title: 'inválido' }), false);

  assert.deepEqual(store.get(id).items, [title(603), title(603, 'tv')]);
  assert.equal(store.hasItem(id, 'movie', 603), true);

  store.removeItem(id, 'movie', 603);
  assert.deepEqual(store.get(id).items, [title(603, 'tv')]);
  assert.equal(store.hasItem(id, 'movie', 603), false);
  assert.equal(store.hasItem('não-existe', 'tv', 603), false);
});

test('uma lista cheia não aceita mais títulos', () => {
  const store = newStore();
  const { id } = store.create(
    'Cheia',
    Array.from({ length: MAX_LIST_ITEMS + 5 }, (_, index) => title(index + 1)),
  );
  assert.equal(store.get(id).items.length, MAX_LIST_ITEMS);
  assert.equal(store.addItem(id, title(99999)), false);
});

test('moveItem reordena e ignora posições inválidas', () => {
  const store = newStore();
  const { id } = store.create('Ordem', [title(1), title(2), title(3)]);
  const order = () => store.get(id).items.map((item) => item.id);

  assert.equal(store.moveItem(id, 0, 2), true);
  assert.deepEqual(order(), [2, 3, 1]);
  assert.equal(store.moveItem(id, 2, 1), true);
  assert.deepEqual(order(), [2, 1, 3]);

  for (const [from, to] of [
    [0, 0],
    [-1, 1],
    [0, 3],
    [1.5, 0],
    ['0', 1],
  ]) {
    assert.equal(store.moveItem(id, from, to), false);
  }
  assert.equal(store.moveItem('não-existe', 0, 1), false);
  assert.deepEqual(order(), [2, 1, 3]);
});

test('as cópias devolvidas não alteram o estado guardado', () => {
  const store = newStore();
  const { id } = store.create('Protegida', [title(1)]);
  store.lists()[0].items.push(title(2));
  store.get(id).items.length = 0;
  assert.equal(store.get(id).items.length, 1);
});

test('grava com número de versão e sobrevive a uma nova sessão', () => {
  const storage = memoryStorage();
  const first = newStore(storage);
  const { id } = first.create('Persistente');
  first.addItem(id, title(603));

  const saved = JSON.parse(storage.getItem(LISTS_KEY));
  assert.equal(saved.version, LISTS_VERSION);
  assert.equal(saved.lists.length, 1);

  const second = newStore(storage);
  assert.deepEqual(second.get(id).items, [title(603)]);
});

test('migra o formato sem versão (só o array) e regrava no formato atual', () => {
  const v0 = JSON.stringify([
    { id: 'antiga', name: 'Do formato antigo', items: [{ id: 603, media: 'movie', title: 'Matrix' }] },
  ]);
  const storage = memoryStorage({ [LISTS_KEY]: v0 });
  const store = newStore(storage);

  assert.deepEqual(store.lists(), [
    {
      id: 'antiga',
      name: 'Do formato antigo',
      items: [bare(title(603, 'movie', 'Matrix'))],
      createdAt: STAMP,
      updatedAt: STAMP,
    },
  ]);
  assert.equal(JSON.parse(storage.getItem(LISTS_KEY)).version, LISTS_VERSION, 'já foi regravado');
});

test('migrateLists descarta lixo, listas inválidas, ids repetidos e títulos repetidos', () => {
  for (const raw of [null, '', '{não é json', '"texto"', '7', '{"version":1}', '{"version":"1","lists":[]}', '{"lists":[]}']) {
    assert.deepEqual(migrateLists(raw, NOW), []);
  }
  const lists = migrateLists(
    JSON.stringify({
      version: 1,
      lists: [
        { id: 'a', name: 'Boa', items: [title(1), title(1), null, { id: 2, media: 'person', title: 'x' }], createdAt: 'c', updatedAt: 'u' },
        { id: 'a', name: 'Id repetido', items: [] },
        { id: 'tem espaço', name: 'Id inválido', items: [] },
        { id: 'b', name: '   ', items: [] },
        { id: 'c', name: 'Sem itens' },
        null,
        'texto',
      ],
    }),
    NOW,
  );
  assert.deepEqual(lists, [{ id: 'a', name: 'Boa', items: [title(1)], createdAt: 'c', updatedAt: 'u' }]);
});

test('uma versão futura do formato ainda é lida no que for compatível', () => {
  const raw = JSON.stringify({ version: 2, lists: [{ id: 'a', name: 'Futuro', items: [], novo: true }] });
  assert.equal(migrateLists(raw, NOW)[0].name, 'Futuro');
});

test('storage cheio ou bloqueado não derruba as listas', () => {
  const store = createListStore({
    getItem: () => {
      throw new DOMException('bloqueado', 'SecurityError');
    },
    setItem: () => {
      throw new DOMException('cota', 'QuotaExceededError');
    },
  });
  const { id } = store.create('Só nesta sessão');
  assert.equal(store.addItem(id, title(1)), true);
  assert.equal(store.get(id).items.length, 1);
});

test('compartilhamento: ida e volta preserva nome, ordem e acentos', async () => {
  const list = {
    id: 'interno',
    name: 'Ação & “clássicos” 日本',
    items: [title(603, 'movie', 'Matrix'), title(1399, 'tv', 'A Guerra dos Tronos — ação')],
    createdAt: STAMP,
    updatedAt: STAMP,
  };
  const code = await encodeShare(list);

  assert.match(code, /^[\w-]+$/, 'cabe num hash de URL sem escapar nada');
  assert.deepEqual(await decodeShare(code), { name: list.name, items: list.items.map(bare) });
});

test('compartilhamento não leva dados pessoais nem internos', async () => {
  const code = await encodeShare({
    id: 'id-interno',
    name: 'Lista',
    items: [{ ...title(603, 'movie', 'Matrix'), posterPath: '/segredo.jpg', rating: 9.9, date: '1999-03-31', genreIds: [28] }],
    createdAt: STAMP,
    updatedAt: STAMP,
  });

  assert.deepEqual(readCode(code), { v: 1, n: 'Lista', i: [[0, 603, 'Matrix']] });
});

test('lista longa vira um link comprimido bem mais curto, e de volta igual', async () => {
  const items = Array.from({ length: MAX_LIST_ITEMS }, (_, index) =>
    title(index + 1, index % 2 ? 'tv' : 'movie', `Título de exemplo número ${index + 1}`),
  );
  const list = { name: 'Maratona completa', items };
  const code = await encodeShare(list);
  const plain = encodeRaw({ v: 1, n: list.name, i: items.map((item) => [item.media === 'tv' ? 1 : 0, item.id, item.title]) });

  assert.ok(code.startsWith('z'), 'usa o formato comprimido');
  assert.ok(code.length < plain.length / 3, `${code.length} contra ${plain.length} sem compressão`);
  assert.deepEqual(await decodeShare(code), { name: list.name, items: items.map(bare) });
});

test('lista curta em que a compressão não ajuda continua no formato sem compressão', async () => {
  const code = await encodeShare({ name: 'A', items: [] });
  assert.equal(code, encodeRaw({ v: 1, n: 'A', i: [] }));
});

test('links do formato 1.1 (sem compressão) continuam válidos', async () => {
  const shared = await decodeShare(encodeRaw({ v: 1, n: 'Antiga', i: [[0, 603, 'Matrix'], [1, 1399, 'Dark']] }));
  assert.deepEqual(shared, {
    name: 'Antiga',
    items: [bare(title(603, 'movie', 'Matrix')), bare(title(1399, 'tv', 'Dark'))],
  });
});

test('decodeShare recusa qualquer coisa fora do formato, comprimida ou não', async () => {
  const valid = { v: 1, n: 'Lista', i: [[0, 603, 'Matrix']] };
  assert.notEqual(await decodeShare(encodeRaw(valid)), null);
  assert.notEqual(await decodeShare(encodeZip(valid)), null);

  const invalid = [
    { ...valid, v: 2 },
    { ...valid, n: '   ' },
    { ...valid, n: 7 },
    { ...valid, i: 'x' },
    { ...valid, i: [[2, 603, 'Matrix']] },
    { ...valid, i: [[0, -1, 'Matrix']] },
    { ...valid, i: [[0, 1.5, 'Matrix']] },
    { ...valid, i: [[0, '603', 'Matrix']] },
    { ...valid, i: [[0, 603, '']] },
    { ...valid, i: [[0, 603, { toString: 1 }]] },
    { ...valid, i: [[0, 603]] },
    { ...valid, i: [[0, 603, 'Matrix', 'extra']] },
    { ...valid, i: [{ id: 603 }] },
    { ...valid, i: Array.from({ length: MAX_LIST_ITEMS + 1 }, (_, index) => [0, index + 1, 'x']) },
    null,
    [],
    'texto',
  ];
  for (const payload of invalid) {
    assert.equal(await decodeShare(encodeRaw(payload)), null, JSON.stringify(payload).slice(0, 80));
    assert.equal(await decodeShare(encodeZip(payload)), null, `comprimido: ${JSON.stringify(payload).slice(0, 70)}`);
  }
  for (const code of [
    null,
    undefined,
    7,
    '',
    'não é base64!',
    '<script>',
    'AAAA',
    'z',
    'zAAAA',
    `z${Buffer.from('não é deflate').toString('base64url')}`,
    encodeZip(valid).slice(0, -6),
    Buffer.from([0xff, 0xfe]).toString('base64url'),
    `z${deflateRawSync(Buffer.from([0xff, 0xfe])).toString('base64url')}`,
  ]) {
    assert.equal(await decodeShare(code), null, String(code));
  }
});

test('código comprimido que se expande demais é recusado sem ler tudo', async () => {
  // Poucos KB de código, mais de 10 MB descomprimidos.
  const bomb = encodeZip(`{"v":1,"n":"x","i":[],"pad":"${' '.repeat(10 * 1024 * 1024)}"}`);
  assert.ok(bomb.length < 40000);
  assert.equal(await decodeShare(bomb), null);
});

test('decodeShare limpa o que aceita: nome e títulos cortados, repetidos unidos', async () => {
  const shared = await decodeShare(
    encodeRaw({
      v: 1,
      n: `  ${'n'.repeat(500)}  `,
      i: [
        [0, 1, 't'.repeat(900)],
        [0, 1, 'repetido'],
        [1, 1, '<img src=x onerror=alert(1)>'],
      ],
    }),
  );
  assert.equal(shared.name.length, MAX_LIST_NAME);
  assert.equal(shared.items.length, 2);
  assert.equal(shared.items[0].title.length, 200);
  // Texto hostil continua sendo só texto: quem renderiza usa nós de texto.
  assert.equal(shared.items[1].title, '<img src=x onerror=alert(1)>');
  assert.equal(shared.items[1].media, 'tv');
});

test('lista importada vira uma lista nova e independente', async () => {
  const store = newStore();
  const shared = await decodeShare(await encodeShare({ name: 'Recebida', items: [title(1), title(2, 'tv')] }));
  const list = store.create(shared.name, shared.items);

  assert.equal(list.id, 'lista-1');
  assert.deepEqual(
    list.items.map((item) => `${item.media}:${item.id}`),
    ['movie:1', 'tv:2'],
  );
});
