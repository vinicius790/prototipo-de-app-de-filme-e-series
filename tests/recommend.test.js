import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_GENRE_LOOKUPS,
  MAX_REASONS,
  calculateAffinityScore,
  excludeKnown,
  explain,
  genreProfile,
  mapLimit,
  missingGenres,
} from '../web-vanilla/js/recommend.js';

const entry = (id, title, genreIds, media = 'movie') => ({ id, media, title, genreIds });
const review = (id, title, genreIds, rating, media = 'movie') => ({ ...entry(id, title, genreIds, media), rating });

test('sem favoritos nem avaliações não há perfil', () => {
  assert.deepEqual(genreProfile([], []), []);
});

test('favoritos pontuam os gêneros e explicam de onde veio a pontuação', () => {
  const profile = genreProfile(
    [entry(1, 'Matrix', [28, 878]), entry(2, 'John Wick', [28]), entry(3, 'Dark', [18], 'tv')],
    [],
  );
  assert.deepEqual(profile, [
    { media: 'movie', genreId: 28, score: 2, because: ['Matrix', 'John Wick'] },
    { media: 'tv', genreId: 18, score: 1, because: ['Dark'] },
    { media: 'movie', genreId: 878, score: 1, because: ['Matrix'] },
  ]);
});

test('avaliações altas somam, medianas não mexem e baixas subtraem', () => {
  const profile = genreProfile(
    [entry(1, 'Favorito de terror', [27])],
    [
      review(2, 'Cinco estrelas', [35], 5),
      review(3, 'Quatro estrelas', [35], 4),
      review(4, 'Três estrelas', [99], 3),
      review(5, 'Uma estrela', [27], 1),
    ],
  );
  // Comédia: 2 + 1. Terror: 1 (favorito) - 2 (nota 1) = negativo, some. Documentário: 0, some.
  assert.deepEqual(profile, [
    { media: 'movie', genreId: 35, score: 3, because: ['Cinco estrelas', 'Quatro estrelas'] },
  ]);
});

test('título favoritado e bem avaliado conta uma vez na explicação, com peso somado', () => {
  const profile = genreProfile([entry(1, 'Matrix', [28]), entry(2, 'Outro', [28])], [review(1, 'Matrix', [28], 5)]);
  assert.deepEqual(profile, [{ media: 'movie', genreId: 28, score: 4, because: ['Matrix', 'Outro'] }]);
});

test('título mal avaliado não aparece como motivo, mesmo num gênero que segue positivo', () => {
  const profile = genreProfile(
    [entry(1, 'Bom', [28]), entry(2, 'Também bom', [28])],
    [review(3, 'Ruim', [28], 2)],
  );
  assert.deepEqual(profile[0].because, ['Bom', 'Também bom']);
  assert.equal(profile[0].score, 1);
});

test('o mesmo id de gênero em filme e em série são perfis separados', () => {
  const profile = genreProfile([entry(1, 'Filme', [18]), entry(1, 'Série', [18], 'tv')], []);
  assert.deepEqual(
    profile.map((genre) => `${genre.media}:${genre.genreId}`),
    ['movie:18', 'tv:18'],
  );
});

test('a explicação cita no máximo alguns títulos e ignora entradas antigas sem gêneros', () => {
  const favorites = Array.from({ length: 10 }, (_, index) => entry(index + 1, `Filme ${index + 1}`, [28]));
  favorites.push({ id: 99, media: 'movie', title: 'Sem gêneros' });
  const [genre] = genreProfile(favorites, []);
  assert.equal(genre.score, 10);
  assert.equal(genre.because.length, MAX_REASONS);
});

test('excludeKnown tira favoritos e avaliados e respeita o limite', () => {
  const items = [entry(1, 'a', []), entry(2, 'b', []), entry(3, 'c', []), entry(1, 'série de mesmo id', [], 'tv')];
  assert.deepEqual(
    excludeKnown(items, [entry(1, 'a', [])], [review(3, 'c', [], 5)]).map((item) => item.title),
    ['b', 'série de mesmo id'],
  );
  assert.equal(excludeKnown(items, [], [], 2).length, 2);
});

test('explain monta a frase em português', () => {
  assert.equal(explain([]), '');
  assert.equal(explain(['Matrix']), 'Porque você gostou de Matrix.');
  assert.equal(explain(['Matrix', 'Dark']), 'Porque você gostou de Matrix e Dark.');
  assert.equal(explain(['Matrix', 'Dark', 'Duna']), 'Porque você gostou de Matrix, Dark e Duna.');
});

test('missingGenres lista uma vez cada título sem o campo de gêneros; [] já foi conferido', () => {
  const favorites = [
    { id: 1, media: 'movie', title: 'Antigo' },
    entry(2, 'Novo', [28]),
    entry(6, 'Conferido, sem gênero', []),
    { id: 3, media: 'tv', title: 'Sem campo' },
  ];
  const reviews = [
    { id: 1, media: 'movie', title: 'Antigo', rating: 5 },
    { id: 4, media: 'movie', title: 'Três estrelas não pesam', rating: 3 },
    { id: 5, media: 'movie', title: 'Ruim', rating: 1 },
    { id: 1, media: 'tv', title: 'Série', rating: 4 },
  ];
  assert.deepEqual(missingGenres(favorites, reviews), [
    { media: 'movie', id: 1 },
    { media: 'tv', id: 3 },
    { media: 'movie', id: 5 },
    { media: 'tv', id: 1 },
  ]);

  const many = Array.from({ length: MAX_GENRE_LOOKUPS + 10 }, (_, index) => ({ id: index + 1, media: 'movie', title: 'x' }));
  assert.equal(missingGenres(many, []).length, MAX_GENRE_LOOKUPS);
});

test('mapLimit respeita o limite de concorrência, mantém a ordem e não para numa falha', async () => {
  let running = 0;
  let peak = 0;
  const results = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (value) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 10 - value));
    running -= 1;
    if (value === 4) {
      throw new Error('falhou');
    }
    return value * 10;
  });
  assert.equal(peak, 3);
  assert.deepEqual(
    results.map((result) => (result.status === 'fulfilled' ? result.value : result.reason.message)),
    [10, 20, 30, 'falhou', 50, 60, 70],
  );
  assert.deepEqual(await mapLimit([], 4, async () => 1), []);
});

test('calculateAffinityScore pontua afinidade com base no perfil de gêneros e notas', () => {
  const favorites = [entry(1, 'Matrix', [28, 878])];
  const reviews = [review(2, 'Interestelar', [878, 12], 5)];

  // Filme com gênero coincidente (Ficção Científica 878)
  const itemMatch = { media: 'movie', id: 10, title: 'Duna', genreIds: [878, 12] };
  const affinity = calculateAffinityScore(itemMatch, favorites, reviews);
  assert.ok(affinity);
  assert.ok(affinity.score >= 50 && affinity.score <= 99);
  assert.equal(affinity.label, `${affinity.score}% de afinidade`);
  assert.equal(affinity.topGenreId, 878);

  // Sem histórico -> retorna null
  assert.equal(calculateAffinityScore(itemMatch, [], []), null);

  // Item sem gêneros -> retorna null
  assert.equal(calculateAffinityScore({ media: 'movie', id: 11, genreIds: [] }, favorites, reviews), null);

  // Gênero não presente no perfil do usuário -> retorna null
  const itemNoMatch = { media: 'movie', id: 12, genreIds: [10749] };
  assert.equal(calculateAffinityScore(itemNoMatch, favorites, reviews), null);

  // Mídia diferente (série com gênero que o usuário só curte em filme) -> retorna null
  const tvItem = { media: 'tv', id: 13, genreIds: [878] };
  assert.equal(calculateAffinityScore(tvItem, favorites, reviews), null);
});
