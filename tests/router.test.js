import assert from 'node:assert/strict';
import test from 'node:test';

import { customListHref, detailsHref, listHref, parseRoute, shareHref, watchtimeHref } from '../web-vanilla/js/router.js';

test('hash vazio ou "#/" abre a página inicial', () => {
  for (const hash of ['', '#', '#/']) {
    assert.deepEqual(parseRoute(hash), { view: 'home' });
  }
});

test('listagens leem filtros da URL com valores padrão', () => {
  assert.deepEqual(parseRoute('#/filmes'), {
    view: 'list',
    media: 'movie',
    list: 'popular',
    genre: '',
    query: '',
    page: 1,
  });
  assert.deepEqual(parseRoute('#/series?lista=top&genero=18&q=%20dark%20&pagina=3'), {
    view: 'list',
    media: 'tv',
    list: 'top',
    genre: '18',
    query: 'dark',
    page: 3,
  });
});

test('filtros inválidos na URL caem no padrão', () => {
  const route = parseRoute('#/filmes?lista=qualquer&genero=action&pagina=-2');
  assert.equal(route.list, 'popular');
  assert.equal(route.genre, '');
  assert.equal(route.page, 1);
  assert.equal(parseRoute('#/filmes?pagina=99999').page, 500);
});

test('detalhes exigem id numérico', () => {
  assert.deepEqual(parseRoute('#/filme/603'), { view: 'details', media: 'movie', id: 603 });
  assert.deepEqual(parseRoute('#/serie/1399'), { view: 'details', media: 'tv', id: 1399 });
  assert.deepEqual(parseRoute('#/filme/abc'), { view: 'not-found' });
  assert.deepEqual(parseRoute('#/filme/603/extra'), { view: 'not-found' });
});

test('favoritos, chave e rotas desconhecidas', () => {
  assert.deepEqual(parseRoute('#/favoritos'), { view: 'favorites' });
  assert.deepEqual(parseRoute('#/chave'), { view: 'key' });
  assert.deepEqual(parseRoute('#/atores'), { view: 'not-found' });
  assert.deepEqual(parseRoute('#conteudo'), { view: 'not-found' });
  // Nomes herdados de Object.prototype não podem ser confundidos com rotas.
  assert.deepEqual(parseRoute('#/constructor'), { view: 'not-found' });
  assert.deepEqual(parseRoute('#/toString/1'), { view: 'not-found' });
});

test('listHref omite valores padrão e codifica a busca', () => {
  assert.equal(listHref({ media: 'movie' }), '#/filmes');
  assert.equal(listHref({ media: 'tv', list: 'now', page: 1 }), '#/series?lista=now');
  assert.equal(
    listHref({ media: 'movie', list: 'top', genre: '28', page: 2 }),
    '#/filmes?lista=top&genero=28&pagina=2',
  );
  assert.equal(listHref({ media: 'movie', query: 'o "rei" & eu' }), '#/filmes?q=o+%22rei%22+%26+eu');
});

test('listHref e parseRoute são inversos', () => {
  const state = { media: 'tv', list: 'now', genre: '10765', query: 'além & aquém', page: 7 };
  assert.deepEqual(parseRoute(listHref(state)), { view: 'list', ...state });
});

test('detailsHref aponta para a rota de detalhes do tipo certo', () => {
  assert.equal(detailsHref('movie', 603), '#/filme/603');
  assert.equal(detailsHref('tv', 1399), '#/serie/1399');
  assert.deepEqual(parseRoute(detailsHref('tv', 1399)), { view: 'details', media: 'tv', id: 1399 });
});

test('rotas das listas personalizadas e das recomendações', () => {
  assert.deepEqual(parseRoute('#/listas'), { view: 'lists' });
  assert.deepEqual(parseRoute('#/recomendacoes'), { view: 'recommendations' });
  assert.deepEqual(parseRoute('#/lista/abc-123_x'), { view: 'custom-list', id: 'abc-123_x' });
  assert.equal(parseRoute(customListHref('mf1x2-ab12cd')).id, 'mf1x2-ab12cd');

  for (const hash of ['#/lista', '#/lista/', '#/lista/tem espaço', '#/lista/a/b', `#/lista/${'x'.repeat(41)}`, '#/listas/1']) {
    assert.equal(parseRoute(hash).view, 'not-found', hash);
  }
});

test('link de importação carrega o código sem interpretá-lo', () => {
  assert.deepEqual(parseRoute(shareHref('eyJ2IjoxfQ')), { view: 'list-import', code: 'eyJ2IjoxfQ' });
  assert.deepEqual(parseRoute('#/lista/importar'), { view: 'list-import', code: '' });
  // "importar" é sempre a tela de importação, nunca o id de uma lista.
  assert.equal(parseRoute('#/lista/importar?d=<script>').code, '<script>');
});

test('rota de tempo assistido e métricas', () => {
  assert.deepEqual(parseRoute('#/tempo-assistido'), { view: 'watchtime' });
  assert.deepEqual(parseRoute('#/metricas'), { view: 'watchtime' });
  assert.equal(watchtimeHref(), '#/tempo-assistido');
});
