import assert from 'node:assert/strict';
import test from 'node:test';

import { installFakeDocument } from './fake-dom.js';

installFakeDocument();

const {
  customListView,
  detailsView,
  favoriteButton,
  importView,
  keyPanel,
  listsView,
  mediaCard,
  mediaRow,
  message,
  pagination,
  reviewList,
} = await import('../web-vanilla/js/render.js');

const HOSTILE = '<img src=x onerror="alert(1)"> & </article><script>alert(2)</script>';

const item = (overrides = {}) => ({
  id: 7,
  media: 'movie',
  title: 'Matrix',
  posterPath: '/poster.jpg',
  rating: 8.2,
  date: '1999-03-31',
  ...overrides,
});

const details = (overrides = {}) => ({
  ...item(),
  overview: 'Sinopse.',
  backdropPath: '/fundo.jpg',
  tagline: '',
  genres: ['Ação'],
  runtime: 136,
  seasons: 0,
  episodes: 0,
  status: 'Released',
  budget: 0,
  revenue: 0,
  homepage: null,
  cast: [],
  trailer: null,
  ...overrides,
});

const noop = () => false;
const detailHandlers = { favorite: false, review: null, onToggleFavorite: noop, onSaveReview: noop, onRemoveReview: noop };

test('título vindo da API entra como texto, nunca como marcação', () => {
  const card = mediaCard(item({ title: HOSTILE }), { onToggleFavorite: noop });

  assert.ok(card.textContent.includes(HOSTILE), 'o texto aparece exatamente como veio');
  assert.equal(card.findAll('script').length, 0);
  assert.equal(card.findAll('img').length, 1, 'só existe a imagem do pôster');
  assert.equal(card.findAll('img')[0].getAttribute('src'), 'https://image.tmdb.org/t/p/w342/poster.jpg');
});

test('cartão aponta para a rota de detalhes do tipo certo', () => {
  const movie = mediaCard(item(), { onToggleFavorite: noop });
  const series = mediaCard(item({ media: 'tv', id: 9 }), { onToggleFavorite: noop });

  assert.equal(movie.findAll('a')[0].getAttribute('href'), '#/filme/7');
  assert.equal(series.findAll('a')[0].getAttribute('href'), '#/serie/9');
  assert.ok(movie.textContent.includes('Filme · 1999'));
  assert.ok(series.textContent.includes('Série'));
});

test('caminho de imagem fora do padrão não vira <img>', () => {
  const card = mediaCard(item({ posterPath: '/x.jpg" onerror="alert(1)' }), { onToggleFavorite: noop });

  assert.equal(card.findAll('img').length, 0);
  assert.ok(card.textContent.includes('Sem imagem'));
});

test('botão de favorito reflete o novo estado em aria-pressed', () => {
  let favorite = false;
  const button = favoriteButton(item(), favorite, () => {
    favorite = !favorite;
    return favorite;
  });

  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(button.getAttribute('aria-label'), 'Favorito: Matrix');
  button.click();
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  button.click();
  assert.equal(button.getAttribute('aria-pressed'), 'false');
});

test('paginação marca a página atual e desativa os extremos', () => {
  const nav = pagination(1, 500, (page) => `#/filmes?pagina=${page}`);
  const links = nav.findAll('a');

  assert.deepEqual(
    links.map((link) => link.textContent),
    ['1', '2', '3', '500', 'Próxima ›'],
  );
  assert.equal(links[0].getAttribute('aria-current'), 'page');
  assert.equal(links[1].getAttribute('aria-current'), null);
  assert.equal(links[1].getAttribute('href'), '#/filmes?pagina=2');
  assert.equal(links.at(-1).getAttribute('href'), '#/filmes?pagina=2');
  assert.ok(nav.textContent.includes('‹ Anterior'), '"Anterior" aparece, mas sem link');

  const last = pagination(500, 500, (page) => `#${page}`);
  assert.equal(last.findAll('a').at(-1).textContent, '500', '"Próxima" não é link na última página');
});

test('lista com uma página só não mostra paginação', () => {
  assert.equal(pagination(1, 1, String), null);
  assert.equal(pagination(1, 0, String), null);
});

test('detalhes mostram elenco, fatos e dados hostis apenas como texto', () => {
  const view = detailsView(
    details({
      title: HOSTILE,
      overview: HOSTILE,
      tagline: HOSTILE,
      genres: [HOSTILE],
      budget: 63000000,
      cast: [{ id: 1, name: HOSTILE, character: 'Neo', profilePath: null }],
    }),
    detailHandlers,
  );

  assert.equal(view.findAll('script').length, 0);
  assert.equal(view.findAll('h1')[0].textContent, HOSTILE);
  assert.ok(view.textContent.includes('Neo'));
  assert.ok(view.textContent.includes('2h 16min'));
  assert.ok(view.textContent.includes('Lançado'));
  assert.ok(view.textContent.includes('Orçamento'));
  assert.ok(!view.textContent.includes('Receita'), 'valores não informados ficam de fora');
  assert.ok(!view.textContent.includes('Temporadas'));
});

test('site oficial só vira link quando a URL já foi validada', () => {
  const without = detailsView(details({ homepage: null }), detailHandlers);
  assert.ok(!without.textContent.includes('Site oficial'));

  const withLink = detailsView(details({ homepage: 'https://exemplo.com/' }), detailHandlers);
  const link = withLink.findAll('a').find((anchor) => anchor.textContent.includes('Site oficial'));
  assert.equal(link.getAttribute('href'), 'https://exemplo.com/');
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
});

test('player do trailer só é criado depois do clique', () => {
  const view = detailsView(details({ trailer: { key: 'abc123XYZ_-', name: 'Trailer oficial' } }), detailHandlers);
  assert.equal(view.findAll('iframe').length, 0);

  view.findAll('button').find((button) => button.textContent.includes('Assistir ao trailer')).click();

  const [frame] = view.findAll('iframe');
  assert.equal(frame.getAttribute('src'), 'https://www.youtube-nocookie.com/embed/abc123XYZ_-?autoplay=1');
  assert.equal(frame.getAttribute('title'), 'Trailer: Trailer oficial');
});

test('formulário de avaliação vem preenchido com a avaliação salva', () => {
  const view = detailsView(details(), {
    ...detailHandlers,
    review: { rating: 4, text: 'Muito bom' },
  });
  const checked = view.findAll('input').filter((input) => input.getAttribute('checked') !== null);

  assert.deepEqual(
    checked.map((input) => input.getAttribute('value')),
    ['4'],
  );
  assert.equal(view.findAll('textarea')[0].textContent, 'Muito bom');
  assert.ok(view.textContent.includes('Atualizar avaliação'));
  assert.ok(view.textContent.includes('Remover avaliação'));

  const empty = detailsView(details(), detailHandlers);
  assert.ok(empty.textContent.includes('Salvar avaliação'));
  assert.ok(!empty.textContent.includes('Remover avaliação'));
});

test('lista de avaliações mostra nota, texto e permite remover', () => {
  const removed = [];
  const review = { id: 7, media: 'tv', title: 'Dark', rating: 4, text: HOSTILE, updatedAt: '2026-01-02T03:04:05.000Z' };
  const list = reviewList([review], { onRemove: (entry) => removed.push(entry) });

  assert.equal(list.findAll('script').length, 0);
  assert.equal(list.findAll('a')[0].getAttribute('href'), '#/serie/7');
  assert.ok(list.textContent.includes('★★★★☆'));
  assert.ok(list.textContent.includes('Nota 4 de 5'));
  assert.ok(list.textContent.includes('02/01/2026'));

  list.findAll('button')[0].click();
  assert.deepEqual(removed, [review]);
});

test('mensagem de erro usa role="alert"; estado vazio não', () => {
  assert.equal(message({ title: 'Erro', alert: true }).getAttribute('role'), 'alert');
  assert.equal(message({ title: 'Vazio' }).getAttribute('role'), null);
});

test('painel da chave: formulário só aparece quando a chave não vem do arquivo', () => {
  const none = keyPanel({ source: 'none', onSave: noop, onRemove: noop });
  assert.equal(none.findAll('form').length, 1);
  assert.equal(none.findAll('input')[0].getAttribute('type'), 'password');
  assert.ok(none.textContent.includes('Nenhuma chave configurada'));
  assert.ok(!none.textContent.includes('Remover chave salva'));

  const browser = keyPanel({ source: 'browser', onSave: noop, onRemove: noop });
  assert.ok(browser.textContent.includes('Remover chave salva'));

  const file = keyPanel({ source: 'file', onSave: noop, onRemove: noop });
  assert.equal(file.findAll('form').length, 0);

  const invalid = keyPanel({ source: 'none', error: 'Formato inválido.', onSave: noop, onRemove: noop });
  assert.ok(invalid.textContent.includes('Formato inválido.'));
});

test('favoritos e avaliações gravados com valores fora do padrão não derrubam a tela', async () => {
  const { createStore } = await import('../web-vanilla/js/store.js');
  const saved = {
    'movie-app:favoritos': JSON.stringify([{ id: 2, media: 'movie', title: 'B', rating: '9', posterPath: 5, date: 7 }]),
    'movie-app:avaliacoes': JSON.stringify([
      { id: 1, media: 'movie', title: 'Nota 7', rating: 7, text: '', updatedAt: '' },
      { id: 3, media: 'tv', title: 'Ok', rating: 4, text: 42, updatedAt: null },
    ]),
  };
  const store = createStore({ getItem: (name) => saved[name] ?? null, setItem() {}, removeItem() {} });

  const card = mediaCard(store.favorites()[0], { onToggleFavorite: noop });
  assert.ok(card.textContent.includes('–'), 'nota inválida aparece como "sem nota"');
  const list = reviewList(store.reviews(), { onRemove: noop });
  assert.deepEqual(
    list.findAll('a').map((link) => link.textContent),
    ['Ok'],
    'avaliação com nota fora de 1 a 5 é descartada',
  );
});

// ---- Listas personalizadas, importação e recomendações ----

const customList = (overrides = {}) => ({
  id: 'l1',
  name: 'Clássicos',
  items: [item({ id: 1, title: 'Primeiro' }), item({ id: 2, title: 'Segundo' }), item({ id: 3, title: 'Terceiro' })],
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

const listHandlers = (overrides = {}) => ({
  shareUrl: 'http://localhost/#/lista/importar?d=abc',
  isFavorite: noop,
  onToggleFavorite: noop,
  onRename: noop,
  onDelete: noop,
  onCopyLink: noop,
  onMove: noop,
  onRemoveItem: noop,
  ...overrides,
});

const byLabel = (root, label) => root.findAll('button').find((button) => button.getAttribute('aria-label') === label);
const submit = (form) => form.listeners.get('submit')({ preventDefault() {} });

test('índice de listas mostra nome como texto, contagem e link de cada lista', () => {
  const view = listsView([customList({ name: HOSTILE }), customList({ id: 'l2', name: 'Uma só', items: [item()] })], {
    onCreate: noop,
  });
  const links = view.findAll('a');

  assert.equal(view.findAll('h1')[0].textContent, 'Minhas listas');
  assert.equal(links[0].getAttribute('href'), '#/lista/l1');
  assert.equal(links[0].textContent, HOSTILE);
  assert.equal(view.findAll('script').length + view.findAll('img').length, 0);
  assert.ok(view.textContent.includes('3 títulos'));
  assert.ok(view.textContent.includes('1 título'));
});

test('índice vazio explica como começar e o formulário entrega o nome digitado', () => {
  let created = null;
  const view = listsView([], { onCreate: (name) => (created = name), error: 'A lista precisa de um nome.' });

  assert.ok(view.textContent.includes('Nenhuma lista ainda'));
  assert.equal(view.findAll('p').find((p) => p.getAttribute('role') === 'alert').textContent, 'A lista precisa de um nome.');
  const input = view.findAll('input')[0];
  assert.equal(view.findAll('label')[0].getAttribute('for'), input.getAttribute('id'));
  assert.equal(input.getAttribute('aria-describedby'), 'nome-lista-erro');

  input.value = 'Para o feriado';
  submit(view.findAll('form')[0]);
  assert.equal(created, 'Para o feriado');
});

test('tela da lista: botões de mover têm rótulo, respeitam as pontas e informam as posições', () => {
  const moves = [];
  const removed = [];
  const view = customListView(
    customList(),
    listHandlers({ onMove: (from, to) => moves.push([from, to]), onRemoveItem: (entry) => removed.push(entry.id) }),
  );

  assert.equal(view.findAll('ol').length, 1, 'lista ordenada: a ordem tem significado');
  assert.equal(byLabel(view, 'Mover Primeiro para cima').getAttribute('disabled'), '');
  assert.equal(byLabel(view, 'Mover Terceiro para baixo').getAttribute('disabled'), '');
  assert.equal(byLabel(view, 'Mover Segundo para cima').getAttribute('disabled'), null);

  byLabel(view, 'Mover Segundo para cima').click();
  byLabel(view, 'Mover Segundo para baixo').click();
  byLabel(view, 'Remover Terceiro da lista').click();
  assert.deepEqual(moves, [
    [1, 0],
    [1, 2],
  ]);
  assert.deepEqual(removed, [3]);
});

test('tela da lista: renomear, link de compartilhamento e exclusão', () => {
  const calls = [];
  const view = customListView(
    customList({ name: HOSTILE }),
    listHandlers({ onRename: (name) => calls.push(['rename', name]), onDelete: () => calls.push(['delete']) }),
  );
  const [rename, link] = view.findAll('input');

  assert.equal(view.findAll('h1')[0].textContent, HOSTILE);
  assert.equal(rename.getAttribute('value'), HOSTILE);
  assert.equal(link.getAttribute('value'), 'http://localhost/#/lista/importar?d=abc');
  assert.equal(link.getAttribute('readonly'), '');

  rename.value = 'Novo nome';
  submit(view.findAll('form')[0]);
  view.findAll('button').find((button) => button.textContent === 'Excluir lista').click();
  assert.deepEqual(calls, [['rename', 'Novo nome'], ['delete']]);
});

test('lista vazia mostra orientação em vez da grade', () => {
  const view = customListView(customList({ items: [] }), listHandlers());
  assert.equal(view.findAll('ol').length, 0);
  assert.ok(view.textContent.includes('Lista vazia'));
  assert.ok(view.textContent.includes('0 títulos'));
});

test('importação: link inválido avisa; link válido lista os títulos como texto', () => {
  const invalid = importView(null, { onImport: noop });
  assert.ok(invalid.textContent.includes('Link de lista inválido'));
  assert.equal(invalid.findAll('button').length, 0);

  let imported = 0;
  const view = importView(
    { name: 'Recebida', items: [item({ title: HOSTILE }), item({ id: 9, media: 'tv', title: 'Dark' })] },
    { onImport: () => (imported += 1) },
  );
  assert.ok(view.textContent.includes('“Recebida” · 2 títulos'));
  assert.ok(view.textContent.includes(HOSTILE));
  assert.equal(view.findAll('script').length + view.findAll('img').length, 0);
  assert.deepEqual(
    view.findAll('a').map((link) => link.getAttribute('href')),
    ['#/filme/7', '#/serie/9'],
  );
  view.findAll('button')[0].click();
  assert.equal(imported, 1);
});

test('detalhes: bloco de listas marca onde o título está e avisa as mudanças', () => {
  const calls = [];
  const lists = [customList(), customList({ id: 'l2', name: 'Outra' })];
  const view = detailsView(details(), {
    ...detailHandlers,
    lists,
    isInList: (list) => list.id === 'l2',
    onToggleList: (list, checked) => calls.push([list.id, checked]),
    onCreateList: (name) => calls.push(['nova', name]),
  });
  const boxes = view.findAll('input').filter((input) => input.getAttribute('type') === 'checkbox');

  assert.deepEqual(
    boxes.map((box) => box.getAttribute('checked')),
    [null, ''],
  );
  boxes[0].listeners.get('change')({ target: { checked: true } });
  const newList = view.findAll('input').find((input) => input.getAttribute('id') === 'nova-lista');
  newList.value = 'Maratona';
  submit(view.findAll('form').find((form) => form.findAll('input').includes(newList)));
  assert.deepEqual(calls, [
    ['l1', true],
    ['nova', 'Maratona'],
  ]);
});

test('detalhes sem os manipuladores de lista não mostram o bloco (compatibilidade)', () => {
  const view = detailsView(details(), detailHandlers);
  assert.equal(view.textContent.includes('Minhas listas'), false);
});

test('faixa de recomendação mostra o motivo logo abaixo do título', () => {
  const row = mediaRow({
    id: 'recomendacao-0',
    title: 'Ação · Filmes',
    subtitle: 'Porque você gostou de Matrix.',
    moreHref: '#/filmes?genero=28',
    content: 'conteúdo',
  });
  assert.equal(row.getAttribute('aria-labelledby'), 'recomendacao-0');
  assert.ok(row.textContent.includes('Porque você gostou de Matrix.'));
  assert.equal(mediaRow({ id: 'x', title: 't', moreHref: '#/', content: 'c' }).findAll('p').length, 0);
});
