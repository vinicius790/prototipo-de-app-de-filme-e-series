import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, debounceTime, filter, map, of, startWith, switchMap } from 'rxjs';

import { Genre, ListQuery, ListType, MediaSummary, MediaType, Page } from '../core/tmdb.models';
import { TmdbService } from '../core/tmdb.service';
import { clampPage, parseGenre, parseList } from '../core/tmdb.util';
import { ErrorMessage, Loading } from '../shared/feedback';
import { MediaCard } from '../shared/media-card';
import { Pagination } from '../shared/pagination';

type ListState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ok'; page: Page<MediaSummary> };

export const SEARCH_DELAY = 350;

const LIST_LABELS: Record<MediaType, { value: ListType; label: string }[]> = {
  movie: [
    { value: 'popular', label: 'Populares' },
    { value: 'now', label: 'Em cartaz' },
    { value: 'top', label: 'Mais bem avaliados' },
  ],
  tv: [
    { value: 'popular', label: 'Populares' },
    { value: 'now', label: 'No ar' },
    { value: 'top', label: 'Mais bem avaliadas' },
  ],
};

/**
 * Listagem de filmes ou séries com busca, lista, gênero e paginação.
 * O estado dos filtros mora na URL (`?lista=&genero=&q=&pagina=`); a tela só o reflete.
 */
@Component({
  selector: 'app-browse',
  imports: [ReactiveFormsModule, RouterLink, MediaCard, Pagination, Loading, ErrorMessage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ media() === 'tv' ? 'Séries' : 'Filmes' }}</h1>

    <form class="filters" role="search" (submit)="$event.preventDefault()">
      <div class="field field--grow">
        <label for="busca">Buscar por título</label>
        <input
          #busca
          type="search"
          id="busca"
          autocomplete="off"
          placeholder="Ex.: Cidade de Deus"
          [formControl]="search"
        />
      </div>
      <div class="field">
        <label for="filtro-lista">Lista</label>
        <select
          #lista
          id="filtro-lista"
          [disabled]="searching()"
          (change)="applyFilter({ lista: lista.value === 'popular' ? null : lista.value })"
        >
          @for (option of listOptions(); track option.value) {
            <option [value]="option.value" [selected]="option.value === query().list">
              {{ option.label }}
            </option>
          }
        </select>
      </div>
      <div class="field">
        <label for="filtro-genero">Gênero</label>
        <select
          #genero
          id="filtro-genero"
          [disabled]="searching()"
          (change)="applyFilter({ genero: genero.value || null })"
        >
          <option value="" [selected]="query().genre === ''">Todos</option>
          @for (genre of genres(); track genre.id) {
            <option [value]="genre.id" [selected]="genre.id.toString() === query().genre">
              {{ genre.name }}
            </option>
          }
        </select>
      </div>
      @if (searching()) {
        <p class="muted filters__hint">
          A busca por título ignora a lista e o gênero. Apague o texto para voltar a filtrar.
        </p>
      }
    </form>

    @let current = state();
    <div aria-live="polite" [attr.aria-busy]="current.status === 'loading'">
      @switch (current.status) {
        @case ('loading') {
          <app-loading />
        }
        @case ('error') {
          <app-error-message [error]="current.error" (retry)="retry()" />
        }
        @case ('ok') {
          @if (current.page.items.length > 0) {
            <p class="sr-only">
              {{ current.page.totalResults }} resultados. Página {{ current.page.page }} de
              {{ current.page.totalPages }}.
            </p>
            <ul class="grid" role="list">
              @for (item of current.page.items; track item.id) {
                <li><app-media-card [item]="item" /></li>
              }
            </ul>
            <app-pagination [page]="current.page.page" [totalPages]="current.page.totalPages" />
          } @else {
            <div class="state">
              <h2>Nenhum resultado</h2>
              @if (searching()) {
                <p>Não encontramos nada para “{{ query().query }}”. Tente outro título.</p>
              } @else {
                <p>Não há títulos para esta combinação de filtros.</p>
              }
              <p class="actions"><a class="button" [routerLink]="[]">Limpar filtros</a></p>
            </div>
          }
        }
      }
    </div>
  `,
})
export class Browse {
  private readonly tmdb = inject(TmdbService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly searchInput = viewChild.required<ElementRef<HTMLInputElement>>('busca');
  private readonly attempt = signal(0);

  // Vêm da rota: `media` de `data`, os demais dos parâmetros de consulta.
  readonly media = input.required<MediaType>();
  readonly lista = input<string>();
  readonly genero = input<string>();
  readonly q = input<string>();
  readonly pagina = input<string>();

  protected readonly search = new FormControl('', { nonNullable: true });

  protected readonly query = computed<Required<ListQuery>>(() => ({
    media: this.media(),
    list: parseList(this.lista()),
    genre: parseGenre(this.genero()),
    query: (this.q() ?? '').trim(),
    page: clampPage(this.pagina()),
  }));
  protected readonly searching = computed(() => this.query().query !== '');
  protected readonly listOptions = computed(() => LIST_LABELS[this.media()]);

  private readonly request = computed(() => ({ query: this.query(), attempt: this.attempt() }));

  protected readonly state = toSignal(
    toObservable(this.request).pipe(
      // switchMap cancela a requisição anterior quando os filtros mudam.
      switchMap(({ query }) =>
        this.tmdb.list(query).pipe(
          map((page): ListState => ({ status: 'ok', page })),
          startWith<ListState>({ status: 'loading' }),
          catchError((error: unknown) => of<ListState>({ status: 'error', error })),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as ListState },
  );

  protected readonly genres = toSignal(
    toObservable(this.media).pipe(
      switchMap((media) => this.tmdb.genres(media).pipe(catchError(() => of<Genre[]>([])))),
    ),
    { initialValue: [] as Genre[] },
  );

  constructor() {
    this.search.valueChanges
      .pipe(
        debounceTime(SEARCH_DELAY),
        map((term) => term.trim()),
        // Compara com a URL, não com o último termo digitado: depois de "limpar filtros" ou de
        // voltar no histórico, digitar de novo o mesmo título precisa refazer a busca.
        filter((term) => term !== this.query().query),
        takeUntilDestroyed(),
      )
      .subscribe((term) => this.applyFilter({ q: term || null }, true));

    // Voltar/avançar e "limpar filtros" mudam a URL por fora do campo; quem digita não é interrompido.
    effect(() => {
      const term = this.query().query;
      const input = this.searchInput().nativeElement;
      if (document.activeElement !== input && this.search.value.trim() !== term) {
        this.search.setValue(term, { emitEvent: false });
      }
    });
  }

  /** Aplica um filtro mantendo os demais; qualquer mudança volta para a página 1. */
  protected applyFilter(changes: Record<string, string | null>, replaceUrl = false): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { ...changes, pagina: null },
      queryParamsHandling: 'merge',
      replaceUrl,
    });
  }

  protected retry(): void {
    this.attempt.update((count) => count + 1);
  }
}
