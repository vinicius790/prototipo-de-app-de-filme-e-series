import assert from 'node:assert/strict';
import test from 'node:test';

import {
  debounce,
  formatDate,
  formatMoney,
  formatRating,
  formatRuntime,
  pageRange,
  ratingClass,
  translateStatus,
  yearOf,
} from '../web-vanilla/js/format.js';

test('ratingClass separa notas altas, médias e baixas', () => {
  assert.equal(ratingClass(8), 'nota--alta');
  assert.equal(ratingClass(9.3), 'nota--alta');
  assert.equal(ratingClass(7.99), 'nota--media');
  assert.equal(ratingClass(5), 'nota--media');
  assert.equal(ratingClass(4.9), 'nota--baixa');
  assert.equal(ratingClass(0), 'nota--baixa');
});

test('formatRating usa vírgula decimal e traço para "sem nota"', () => {
  assert.equal(formatRating(7.456), '7,5');
  assert.equal(formatRating(8), '8,0');
  assert.equal(formatRating(0), '–');
});

test('datas ISO viram dd/mm/aaaa; valores inválidos viram vazio', () => {
  assert.equal(formatDate('1999-03-31'), '31/03/1999');
  assert.equal(formatDate('2026-01-02T03:04:05.000Z'), '02/01/2026');
  assert.equal(formatDate(''), '');
  assert.equal(formatDate(undefined), '');
  assert.equal(formatDate('31/03/1999'), '');
  assert.equal(yearOf('1999-03-31'), '1999');
  assert.equal(yearOf(''), '');
});

test('formatRuntime mostra horas e minutos', () => {
  assert.equal(formatRuntime(136), '2h 16min');
  assert.equal(formatRuntime(125), '2h 05min');
  assert.equal(formatRuntime(45), '45min');
  assert.equal(formatRuntime(0), '');
  assert.equal(formatRuntime(undefined), '');
});

test('formatMoney formata dólares e esconde valores não informados', () => {
  assert.match(formatMoney(63000000), /^US\$\s63\.000\.000$/);
  assert.equal(formatMoney(0), '');
  assert.equal(formatMoney(undefined), '');
});

test('translateStatus traduz o que conhece e preserva o resto', () => {
  assert.equal(translateStatus('Released'), 'Lançado');
  assert.equal(translateStatus('Returning Series'), 'Em exibição');
  assert.equal(translateStatus('Novo Status'), 'Novo Status');
  assert.equal(translateStatus(undefined), '');
});

test('pageRange mostra primeira, última e a vizinhança da página atual', () => {
  assert.deepEqual(pageRange(1, 1), [1]);
  assert.deepEqual(pageRange(1, 5), [1, 2, 3, 'gap', 5]);
  assert.deepEqual(pageRange(3, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(pageRange(1, 500), [1, 2, 3, 'gap', 500]);
  assert.deepEqual(pageRange(250, 500), [1, 'gap', 248, 249, 250, 251, 252, 'gap', 500]);
  assert.deepEqual(pageRange(500, 500), [1, 'gap', 498, 499, 500]);
  assert.deepEqual(pageRange(4, 500), [1, 2, 3, 4, 5, 6, 'gap', 500]);
  assert.deepEqual(pageRange(1, 0), []);
});

test('debounce só chama uma vez, com o último valor, depois da pausa', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const search = debounce((term) => calls.push(term), 350);

  search('m');
  t.mock.timers.tick(200);
  search('ma');
  t.mock.timers.tick(200);
  search('matrix');
  t.mock.timers.tick(349);
  assert.deepEqual(calls, []);

  t.mock.timers.tick(1);
  assert.deepEqual(calls, ['matrix']);
});
