import {
  MAX_GENRE_LOOKUPS,
  MAX_REASONS,
  excludeKnown,
  explain,
  genreProfile,
  missingGenres,
} from './recommend.util';
import type { MediaType } from './tmdb.models';

const entry = (id: number, title: string, genreIds: number[], media: MediaType = 'movie') => ({
  id,
  media,
  title,
  genreIds,
});
const review = (id: number, title: string, genreIds: number[], rating: number) => ({
  ...entry(id, title, genreIds),
  rating,
});

describe('genreProfile', () => {
  it('sem favoritos nem avaliações não há perfil', () => {
    expect(genreProfile([], [])).toEqual([]);
  });

  it('favoritos pontuam os gêneros e registram de onde veio a pontuação', () => {
    expect(
      genreProfile(
        [entry(1, 'Matrix', [28, 878]), entry(2, 'John Wick', [28]), entry(3, 'Dark', [18], 'tv')],
        [],
      ),
    ).toEqual([
      { media: 'movie', genreId: 28, score: 2, because: ['Matrix', 'John Wick'] },
      { media: 'tv', genreId: 18, score: 1, because: ['Dark'] },
      { media: 'movie', genreId: 878, score: 1, because: ['Matrix'] },
    ]);
  });

  it('avaliações altas somam, medianas não mexem e baixas subtraem', () => {
    const profile = genreProfile(
      [entry(1, 'Favorito de terror', [27])],
      [
        review(2, 'Cinco estrelas', [35], 5),
        review(3, 'Quatro estrelas', [35], 4),
        review(4, 'Três estrelas', [99], 3),
        review(5, 'Uma estrela', [27], 1),
      ],
    );
    expect(profile).toEqual([
      { media: 'movie', genreId: 35, score: 3, because: ['Cinco estrelas', 'Quatro estrelas'] },
    ]);
  });

  it('título mal avaliado não vira motivo e entradas antigas sem gênero são ignoradas', () => {
    const favorites = [
      ...Array.from({ length: 6 }, (_, index) => entry(index + 1, `Filme ${index + 1}`, [28])),
      { id: 99, media: 'movie' as const, title: 'Sem gêneros' },
    ];
    const [genre] = genreProfile(favorites, [review(50, 'Ruim', [28], 1)]);
    expect(genre.score).toBe(4);
    expect(genre.because).toHaveLength(MAX_REASONS);
    expect(genre.because).not.toContain('Ruim');
  });
});

describe('excludeKnown e explain', () => {
  it('tira o que já foi favoritado ou avaliado e respeita o limite', () => {
    const items = [entry(1, 'a', []), entry(2, 'b', []), entry(1, 'série', [], 'tv')];
    expect(
      excludeKnown(items, [entry(1, 'a', [])], [review(2, 'b', [], 5)]).map((item) => item.title),
    ).toEqual(['série']);
    expect(excludeKnown(items, [], [], 2)).toHaveLength(2);
  });

  it('missingGenres lista uma vez cada título sem o campo de gêneros; [] já foi conferido', () => {
    const unknown = (id: number, title: string, media: MediaType = 'movie') => ({
      id,
      media,
      title,
    });
    const favorites = [
      unknown(1, 'Antigo'),
      entry(2, 'Novo', [28]),
      entry(6, 'Conferido, sem gênero', []),
      unknown(3, 'Série', 'tv'),
    ];
    const reviews = [
      { ...unknown(1, 'Antigo'), rating: 5 },
      { ...unknown(4, 'Três estrelas não pesam'), rating: 3 },
      { ...unknown(5, 'Ruim'), rating: 1 },
    ];
    expect(missingGenres(favorites, reviews)).toEqual([
      { media: 'movie', id: 1 },
      { media: 'tv', id: 3 },
      { media: 'movie', id: 5 },
    ]);
    const many = Array.from({ length: MAX_GENRE_LOOKUPS + 5 }, (_, index) =>
      unknown(index + 1, 'x'),
    );
    expect(missingGenres(many, [])).toHaveLength(MAX_GENRE_LOOKUPS);
  });

  it('monta a frase "porque você gostou de…"', () => {
    expect(explain([])).toBe('');
    expect(explain(['Matrix'])).toBe('Porque você gostou de Matrix.');
    expect(explain(['Matrix', 'Dark', 'Duna'])).toBe('Porque você gostou de Matrix, Dark e Duna.');
  });
});
