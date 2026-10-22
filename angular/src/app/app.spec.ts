import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { App } from './app';
import { routes } from './app.routes';
import { FAVORITES_KEY, LibraryService, REVIEWS_KEY } from './core/library.service';
import { ListsService } from './core/lists.service';
import { LISTS_KEY, MAX_LIST_ITEMS, encodeShare } from './core/lists.util';
import { SEARCH_DELAY } from './features/browse';
import { TEST_KEY, loadKey, memoryStorage, provideTesting } from './testing';

const HOSTILE = '<img src=x onerror="alert(1)"> & <script>alert(2)</script>';

describe('telas (rotas reais, HTTP simulado)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...provideTesting(), provideRouter(routes, withComponentInputBinding())],
    });
    http = TestBed.inject(HttpTestingController);
  });

  /** Responde gêneros e listagem da tela de filmes/séries e espera a tela estabilizar. */
  async function flushList(harness: RouterTestingHarness, results: object[], totalPages = 500) {
    TestBed.tick();
    http
      .expectOne((req) => req.url.includes('/genre/'))
      .flush({ genres: [{ id: 28, name: 'Ação' }] });
    const list = http.expectOne(
      (req) => req.url.includes('/discover/') || req.url.includes('/search/'),
    );
    list.flush({
      page: Number(list.request.params.get('page')),
      total_pages: totalPages,
      total_results: 9000,
      results,
    });
    await harness.fixture.whenStable();
    return list.request;
  }

  it('sem chave, as telas que usam a API levam para a ajuda da chave', async () => {
    const harness = await RouterTestingHarness.create('/filmes');

    expect(TestBed.inject(Router).url).toBe('/chave');
    expect(harness.routeNativeElement?.textContent).toContain('Nenhuma chave configurada');
    http.expectNone((req) => req.url.includes('themoviedb'));
  });

  it('favoritos abrem mesmo sem chave', async () => {
    const harness = await RouterTestingHarness.create('/favoritos');

    expect(TestBed.inject(Router).url).toBe('/favoritos');
    expect(harness.routeNativeElement?.textContent).toContain('Nenhum favorito ainda');
  });

  it('listagem lê os filtros da URL, mostra os cartões e trata o título como texto', async () => {
    await loadKey(TEST_KEY);
    const harness = await RouterTestingHarness.create('/filmes?lista=top&genero=28&pagina=2');
    const request = await flushList(harness, [
      { id: 1, title: HOSTILE, release_date: '1999-03-31', vote_average: 8.2 },
      { id: 2, title: 'Outro filme', vote_average: 4 },
    ]);
    const page = harness.routeNativeElement as HTMLElement;

    expect(request.params.get('with_genres')).toBe('28');
    expect(request.params.get('sort_by')).toBe('vote_average.desc');
    expect(request.params.get('page')).toBe('2');

    expect(page.querySelector('h1')?.textContent).toBe('Filmes');
    expect(page.querySelectorAll('.card')).toHaveLength(2);
    expect(page.querySelector('.card__title')?.textContent).toBe(HOSTILE);
    expect(page.querySelectorAll('script, .card img')).toHaveLength(0);
    expect(page.querySelector('.card__link')?.getAttribute('href')).toBe('/filmes/1');
    expect(page.querySelector('.pagination [aria-current="page"]')?.textContent).toBe('2');
    expect(page.querySelector<HTMLSelectElement>('#filtro-genero')?.value).toBe('28');
    expect(page.querySelector<HTMLSelectElement>('#filtro-lista')?.value).toBe('top');
  });

  it('favoritar pelo cartão atualiza o botão e a biblioteca', async () => {
    await loadKey(TEST_KEY);
    const harness = await RouterTestingHarness.create('/series');
    await flushList(harness, [
      { id: 9, name: 'Dark', first_air_date: '2017-12-01', vote_average: 8.4, genre_ids: [18] },
    ]);
    const button = harness.routeNativeElement?.querySelector<HTMLButtonElement>('.fav');

    expect(button?.getAttribute('aria-pressed')).toBe('false');
    button?.click();
    await harness.fixture.whenStable();

    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(TestBed.inject(LibraryService).favorites()).toEqual([
      {
        id: 9,
        media: 'tv',
        title: 'Dark',
        posterPath: null,
        rating: 8.4,
        date: '2017-12-01',
        genreIds: [18],
      },
    ]);
  });

  it('mostra estado vazio e, em caso de erro, permite tentar de novo', async () => {
    await loadKey(TEST_KEY);
    const harness = await RouterTestingHarness.create('/filmes?q=nada');
    await flushList(harness, [], 1);
    const page = harness.routeNativeElement as HTMLElement;
    expect(page.textContent).toContain('Não encontramos nada para “nada”');
    expect(page.querySelector<HTMLSelectElement>('#filtro-genero')?.disabled).toBe(true);

    await harness.navigateByUrl('/filmes?pagina=3');
    TestBed.tick();
    http
      .expectOne((req) => req.url.includes('/discover/'))
      .flush({}, { status: 500, statusText: 'erro' });
    await harness.fixture.whenStable();
    expect(page.querySelector('[role="alert"]')?.textContent).toContain(
      'O TMDB respondeu com um erro inesperado.',
    );

    page.querySelector<HTMLButtonElement>('[role="alert"] button')?.click();
    TestBed.tick();
    const retry = http.expectOne((req) => req.url.includes('/discover/'));
    expect(retry.request.params.get('page')).toBe('3');
    retry.flush({ page: 3, total_pages: 5, results: [{ id: 1, title: 'Voltou' }] });
    await harness.fixture.whenStable();
    expect(page.querySelector('.card__title')?.textContent).toBe('Voltou');
  });

  it('detalhes mostram dados, elenco e salvam a avaliação', async () => {
    await loadKey(TEST_KEY);
    const harness = await RouterTestingHarness.create('/filmes/603');
    TestBed.tick();
    http
      .expectOne((req) => req.url.endsWith('/movie/603'))
      .flush({
        id: 603,
        title: 'Matrix',
        overview: HOSTILE,
        runtime: 136,
        status: 'Released',
        release_date: '1999-03-31',
        vote_average: 8.2,
        genres: [{ id: 28, name: 'Ação' }],
        homepage: 'javascript:alert(1)',
        credits: { cast: [{ id: 1, name: 'Keanu Reeves', character: 'Neo' }] },
        videos: {
          results: [{ site: 'YouTube', type: 'Trailer', key: 'abc123XYZ_-', name: 'Trailer' }],
        },
      });
    await harness.fixture.whenStable();
    const page = harness.routeNativeElement as HTMLElement;

    expect(page.querySelector('h1')?.textContent).toBe('Matrix');
    expect(page.textContent).toContain(HOSTILE);
    expect(page.querySelectorAll('script')).toHaveLength(0);
    expect(page.textContent).toContain('2h 16min');
    expect(page.textContent).toContain('Lançado');
    expect(page.textContent).toContain('Keanu Reeves');
    expect(page.textContent).not.toContain('Site oficial');
    expect(page.querySelector('iframe')).toBeNull();

    page.querySelector<HTMLInputElement>('input[name="nota"][value="4"]')?.click();
    const comment = page.querySelector('textarea') as HTMLTextAreaElement;
    comment.value = 'Muito bom';
    comment.dispatchEvent(new Event('input'));
    page.querySelector('.review-form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await harness.fixture.whenStable();

    expect(TestBed.inject(LibraryService).review('movie', 603)).toMatchObject({
      title: 'Matrix',
      rating: 4,
      text: 'Muito bom',
    });
    expect(page.textContent).toContain('Atualizar avaliação');
  });

  it('buscar de novo o mesmo título depois de limpar a busca volta a filtrar', async () => {
    await loadKey(TEST_KEY);
    const harness = await RouterTestingHarness.create('/filmes');
    await flushList(harness, [{ id: 1, title: 'Popular' }]);
    const router = TestBed.inject(Router);
    const type = async (text: string) => {
      const input = harness.routeNativeElement?.querySelector<HTMLInputElement>(
        '#busca',
      ) as HTMLInputElement;
      input.value = text;
      input.dispatchEvent(new Event('input'));
      await new Promise((resolve) => setTimeout(resolve, SEARCH_DELAY + 50));
      await harness.fixture.whenStable();
    };

    await type('matrix');
    expect(router.url).toBe('/filmes?q=matrix');
    http.expectOne((req) => req.url.includes('/search/')).flush({ results: [] });

    // "Limpar filtros" ou o botão voltar trocam a URL por fora do campo.
    await harness.navigateByUrl('/filmes');
    http.expectOne((req) => req.url.includes('/discover/')).flush({ results: [] });
    await harness.fixture.whenStable();

    await type('matrix');
    expect(router.url).toBe('/filmes?q=matrix');
  });

  it('favoritos e avaliações gravados com valores fora do padrão não derrubam a tela', async () => {
    const storage = memoryStorage({
      [FAVORITES_KEY]: JSON.stringify([
        { id: 2, media: 'movie', title: 'B', rating: '9', posterPath: 5, date: 7 },
      ]),
      [REVIEWS_KEY]: JSON.stringify([
        { id: 1, media: 'movie', title: 'Nota 7', rating: 7, text: '', updatedAt: '' },
        { id: 3, media: 'tv', title: 'Ok', rating: 4, text: 42, updatedAt: null },
      ]),
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [...provideTesting(storage), provideRouter(routes, withComponentInputBinding())],
    });
    const harness = await RouterTestingHarness.create('/favoritos');
    const page = harness.routeNativeElement as HTMLElement;

    expect(page.querySelector('.card__title')?.textContent).toBe('B');
    expect(page.querySelector('.nota')?.textContent).toContain('–');
    expect([...page.querySelectorAll('.review__head a')].map((link) => link.textContent)).toEqual([
      'Ok',
    ]);
  });

  it('listas: criar, abrir, renomear, reordenar e remover, sem chave do TMDB', async () => {
    const harness = await RouterTestingHarness.create('/listas');
    const router = TestBed.inject(Router);
    const lists = TestBed.inject(ListsService);
    const page = () => harness.routeNativeElement as HTMLElement;
    expect(page().textContent).toContain('Nenhuma lista ainda');

    const name = page().querySelector<HTMLInputElement>('#nome-lista') as HTMLInputElement;
    page()
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    await harness.fixture.whenStable();
    expect(page().querySelector('[role="alert"]')?.textContent).toBe('A lista precisa de um nome.');

    name.value = 'Clássicos';
    page()
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    await harness.fixture.whenStable();
    const [list] = lists.lists();
    expect(router.url).toBe(`/listas/${list.id}`);
    expect(page().querySelector('h1')?.textContent).toBe('Clássicos');

    for (const [id, title] of [
      [1, 'Primeiro'],
      [2, 'Segundo'],
    ] as const) {
      lists.addItem(list.id, {
        id,
        media: 'movie',
        title,
        posterPath: null,
        rating: 0,
        date: '',
        genreIds: [],
      });
    }
    await harness.fixture.whenStable();
    const titles = () =>
      [...page().querySelectorAll('ol .card__title')].map((el) => el.textContent);
    expect(titles()).toEqual(['Primeiro', 'Segundo']);
    const up = page().querySelector<HTMLButtonElement>('[aria-label="Mover Primeiro para cima"]');
    expect(up?.disabled).toBe(true);

    page().querySelector<HTMLButtonElement>('[aria-label="Mover Segundo para cima"]')?.click();
    await harness.fixture.whenStable();
    expect(titles()).toEqual(['Segundo', 'Primeiro']);
    expect(page().textContent).toContain('Segundo agora é o 1º de 2.');
    // "Mover Segundo para cima" ficou desativado no topo: o foco vai para o título, não se perde.
    expect(document.activeElement?.tagName).toBe('H1');

    (document.activeElement as HTMLElement | null)?.blur();
    page().querySelector<HTMLButtonElement>('[aria-label="Remover Primeiro da lista"]')?.click();
    await harness.fixture.whenStable();
    expect(titles()).toEqual(['Segundo']);
    expect(document.activeElement?.tagName).toBe('H1');

    const rename = page().querySelector<HTMLInputElement>('#renomear-lista') as HTMLInputElement;
    rename.value = 'Favoritos da vida';
    rename.form?.dispatchEvent(new Event('submit', { cancelable: true }));
    await harness.fixture.whenStable();
    expect(page().querySelector('h1')?.textContent).toBe('Favoritos da vida');

    const link = page().querySelector<HTMLInputElement>('#link-lista')?.value ?? '';
    expect(link).toContain(`#/listas/importar?d=${await encodeShare(lists.lists()[0])}`);
  });

  it('link compartilhado: mostra a lista recebida e salva uma cópia; link alterado é recusado', async () => {
    const code = await encodeShare({
      name: 'Recebida',
      items: [
        {
          id: 603,
          media: 'movie',
          title: HOSTILE,
          posterPath: null,
          rating: 0,
          date: '',
          genreIds: [],
        },
        { id: 9, media: 'tv', title: 'Dark', posterPath: null, rating: 0, date: '', genreIds: [] },
      ],
    });
    const harness = await RouterTestingHarness.create(`/listas/importar?d=${code}`);
    await harness.fixture.whenStable();
    const page = harness.routeNativeElement as HTMLElement;

    expect(page.textContent).toContain('“Recebida” · 2 títulos');
    expect(page.textContent).toContain(HOSTILE);
    expect(page.querySelectorAll('script, img')).toHaveLength(0);
    page.querySelector<HTMLButtonElement>('.button--primary')?.click();
    await harness.fixture.whenStable();

    const [saved] = TestBed.inject(ListsService).lists();
    expect(saved.name).toBe('Recebida');
    expect(TestBed.inject(Router).url).toBe(`/listas/${saved.id}`);

    await harness.navigateByUrl(`/listas/importar?d=${code.slice(0, -4)}xx`);
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.textContent).toContain('Link de lista inválido');
  });

  it('lista inexistente avisa em vez de quebrar', async () => {
    const harness = await RouterTestingHarness.create('/listas/nao-existe');
    expect(harness.routeNativeElement?.textContent).toContain('Lista não encontrada');
  });

  it('detalhes: marcar uma lista e criar outra com o título aberto', async () => {
    await loadKey(TEST_KEY);
    TestBed.inject(ListsService).create('Para ver');
    const harness = await RouterTestingHarness.create('/filmes/603');
    TestBed.tick();
    http
      .expectOne((req) => req.url.endsWith('/movie/603'))
      .flush({ id: 603, title: 'Matrix', genres: [{ id: 28, name: 'Ação' }] });
    await harness.fixture.whenStable();
    const page = harness.routeNativeElement as HTMLElement;
    const lists = TestBed.inject(ListsService);

    const box = page.querySelector<HTMLInputElement>('.checks input') as HTMLInputElement;
    expect(box.checked).toBe(false);
    box.click();
    await harness.fixture.whenStable();
    expect(lists.lists()[0].items).toEqual([
      {
        id: 603,
        media: 'movie',
        title: 'Matrix',
        posterPath: null,
        rating: 0,
        date: '',
        genreIds: [28],
      },
    ]);
    expect(page.textContent).toContain('Matrix adicionado a Para ver.');

    const name = page.querySelector<HTMLInputElement>('#nova-lista') as HTMLInputElement;
    name.value = 'Maratona';
    name.form?.dispatchEvent(new Event('submit', { cancelable: true }));
    await harness.fixture.whenStable();
    expect(lists.lists().map((list) => [list.name, list.items.length])).toEqual([
      ['Para ver', 1],
      ['Maratona', 1],
    ]);
    expect(page.querySelectorAll('.checks input')).toHaveLength(2);
  });

  it('detalhes: marcar uma lista cheia não deixa a caixa marcada', async () => {
    await loadKey(TEST_KEY);
    const lists = TestBed.inject(ListsService);
    lists.create(
      'Cheia',
      Array.from({ length: MAX_LIST_ITEMS }, (_, index) => ({
        id: index + 1,
        media: 'tv' as const,
        title: `Série ${index + 1}`,
        posterPath: null,
        rating: 0,
        date: '',
        genreIds: [],
      })),
    );
    const harness = await RouterTestingHarness.create('/filmes/603');
    TestBed.tick();
    http.expectOne((req) => req.url.endsWith('/movie/603')).flush({ id: 603, title: 'Matrix' });
    await harness.fixture.whenStable();
    const page = harness.routeNativeElement as HTMLElement;

    const box = page.querySelector<HTMLInputElement>('.checks input') as HTMLInputElement;
    box.click();
    await harness.fixture.whenStable();
    expect(box.checked).toBe(false);
    expect(page.textContent).toContain('Cheia está cheia.');
    expect(lists.lists()[0].items).toHaveLength(MAX_LIST_ITEMS);
  });

  it('listas gravadas pela outra versão (mesma origem) aparecem aqui', async () => {
    const storage = memoryStorage({
      [LISTS_KEY]: JSON.stringify({
        version: 1,
        lists: [{ id: 'v1', name: 'Da versão pura', items: [] }],
      }),
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [...provideTesting(storage), provideRouter(routes, withComponentInputBinding())],
    });
    const harness = await RouterTestingHarness.create('/listas');
    expect(harness.routeNativeElement?.querySelector('.lists__item a')?.textContent).toBe(
      'Da versão pura',
    );
  });

  it('recomendações sem favoritos explicam como começar, sem chamar a API', async () => {
    await loadKey(TEST_KEY);
    const harness = await RouterTestingHarness.create('/recomendacoes');
    expect(harness.routeNativeElement?.textContent).toContain('Ainda não há recomendações');
    http.expectNone((req) => req.url.includes('themoviedb'));
  });

  it('recomendações buscam os gêneros favoritos e explicam o motivo', async () => {
    await loadKey(TEST_KEY);
    const library = TestBed.inject(LibraryService);
    library.toggleFavorite({
      id: 603,
      media: 'movie',
      title: 'Matrix',
      posterPath: null,
      rating: 8,
      date: '',
      genreIds: [28, 878],
    });
    library.saveReview({ id: 7, media: 'movie', title: 'Duna', genreIds: [878] }, 5);
    const harness = await RouterTestingHarness.create('/recomendacoes');
    TestBed.tick();
    http
      .match((req) => req.url.includes('/genre/movie/list'))
      .forEach((request) =>
        request.flush({
          genres: [
            { id: 28, name: 'Ação' },
            { id: 878, name: 'Ficção científica' },
          ],
        }),
      );
    for (const request of http.match((req) => req.url.includes('/discover/movie'))) {
      const genre = request.request.params.get('with_genres');
      request.flush({
        results: [
          { id: 603, title: 'Matrix' },
          { id: Number(genre), title: `Novo do gênero ${genre}` },
        ],
      });
    }
    await harness.fixture.whenStable();
    const page = harness.routeNativeElement as HTMLElement;

    expect([...page.querySelectorAll('.row h2')].map((el) => el.textContent)).toEqual([
      'Ficção científica · Filmes',
      'Ação · Filmes',
    ]);
    expect([...page.querySelectorAll('.row__why')].map((el) => el.textContent?.trim())).toEqual([
      'Porque você gostou de Duna e Matrix.',
      'Porque você gostou de Matrix.',
    ]);
    // O que já é favorito (Matrix) não é recomendado de novo.
    expect([...page.querySelectorAll('.card__title')].map((el) => el.textContent)).toEqual([
      'Novo do gênero 878',
      'Novo do gênero 28',
    ]);
  });

  it('recomendações completam os gêneros de favoritos antigos (uma vez) e os usam', async () => {
    const old = { posterPath: null, rating: 8, date: '' };
    const storage = memoryStorage({
      [FAVORITES_KEY]: JSON.stringify([
        { id: 603, media: 'movie', title: 'Matrix', ...old },
        { id: 404, media: 'movie', title: 'Sumiu do TMDB', ...old },
      ]),
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [...provideTesting(storage), provideRouter(routes, withComponentInputBinding())],
    });
    http = TestBed.inject(HttpTestingController);
    await loadKey(TEST_KEY);
    const harness = await RouterTestingHarness.create('/recomendacoes');
    TestBed.tick();
    http
      .expectOne((req) => req.url.endsWith('/movie/603'))
      .flush({
        id: 603,
        title: 'Matrix',
        genres: [{ id: 878, name: 'Ficção científica' }],
      });
    http
      .expectOne((req) => req.url.endsWith('/movie/404'))
      .flush({}, { status: 404, statusText: 'não encontrado' });
    await harness.fixture.whenStable();
    http
      .expectOne((req) => req.url.includes('/genre/movie/list'))
      .flush({ genres: [{ id: 878, name: 'Ficção científica' }] });
    http
      .expectOne((req) => req.params.get('with_genres') === '878')
      .flush({ results: [{ id: 1, title: 'Duna' }] });
    await harness.fixture.whenStable();
    const page = harness.routeNativeElement as HTMLElement;

    expect(TestBed.inject(LibraryService).favorites()[0].genreIds).toEqual([878]);
    expect(JSON.parse(storage.getItem(FAVORITES_KEY) ?? '[]')[0].genreIds).toEqual([878]);
    expect(page.querySelector('.row h2')?.textContent).toBe('Ficção científica · Filmes');
    expect(page.querySelector('.row__why')?.textContent?.trim()).toBe(
      'Porque você gostou de Matrix.',
    );

    // Voltar à tela não busca de novo: um título já completado e um que o TMDB não tem.
    await harness.navigateByUrl('/favoritos');
    await harness.navigateByUrl('/recomendacoes');
    TestBed.tick();
    http.expectNone((req) => /\/movie\/(603|404)$/.test(req.url));
    http.match(() => true).forEach((request) => request.flush({ results: [] }));
  });

  it('a moldura tem navegação principal e a atribuição ao TMDB', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const shell = fixture.nativeElement as HTMLElement;

    expect([...shell.querySelectorAll('nav a')].map((link) => link.textContent?.trim())).toEqual([
      'Início',
      'Filmes',
      'Séries',
      'Favoritos',
      'Listas',
      'Para você',
    ]);
    const status = shell.querySelector<HTMLElement>('.connection');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.hidden).toBe(true);
    expect(shell.querySelector('footer')?.textContent).toContain(
      'não é endossado nem certificado pelo',
    );
  });
});
