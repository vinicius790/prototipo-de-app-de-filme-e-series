import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeResourceUrl, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

import { LibraryService, MAX_REVIEW_LENGTH } from '../core/library.service';
import { ListsService } from '../core/lists.service';
import { CustomList, MAX_LIST_NAME } from '../core/lists.util';
import { MediaDetails, MediaType } from '../core/tmdb.models';
import { TmdbService } from '../core/tmdb.service';
import {
  formatDate,
  formatMoney,
  formatRating,
  formatRuntime,
  imageUrl,
  ratingClass,
  translateStatus,
} from '../core/tmdb.util';
import { ErrorMessage, Loading } from '../shared/feedback';

type DetailsState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ok'; details: MediaDetails };

/** Página de um filme ou série: dados, elenco, trailer, favorito e a avaliação do usuário. */
@Component({
  selector: 'app-details',
  imports: [RouterLink, Loading, ErrorMessage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let current = state();
    @switch (current.status) {
      @case ('loading') {
        <app-loading />
      }
      @case ('error') {
        <app-error-message [error]="current.error" (retry)="retry()" />
      }
      @case ('ok') {
        @let details = current.details;
        <article class="details">
          @if (image(details.backdropPath, 'w1280'); as src) {
            <img class="details__backdrop" [src]="src" alt="" />
          }
          <div class="details__main">
            @if (image(details.posterPath, 'w500'); as src) {
              <img
                class="details__poster"
                [src]="src"
                [alt]="'Pôster de ' + details.title"
                width="500"
                height="750"
              />
            } @else {
              <span class="details__poster card__poster--empty" aria-hidden="true">Sem imagem</span>
            }
            <div class="details__info">
              <p class="eyebrow">{{ details.media === 'tv' ? 'Série' : 'Filme' }}</p>
              <h1>{{ details.title }}</h1>
              @if (details.tagline) {
                <p class="details__tagline">{{ details.tagline }}</p>
              }
              <p class="details__meta">
                <span class="nota" [class]="ratingClass(details.rating)">
                  <span class="sr-only">Nota </span>{{ formatRating(details.rating) }}
                </span>
                @for (genre of details.genres; track genre) {
                  <span class="chip">{{ genre }}</span>
                }
              </p>
              <p>{{ details.overview || 'Sinopse não disponível em português.' }}</p>
              <dl class="facts">
                @for (fact of facts(); track fact.name) {
                  <div>
                    <dt>{{ fact.name }}</dt>
                    <dd>{{ fact.value }}</dd>
                  </div>
                }
              </dl>
              <p class="actions">
                <button
                  type="button"
                  class="fav fav--text button"
                  [attr.aria-pressed]="favorite()"
                  (click)="library.toggleFavorite(details)"
                >
                  <span class="fav__icon" aria-hidden="true"></span>Favorito
                </button>
                @if (details.homepage; as homepage) {
                  <a class="button" [href]="homepage" target="_blank" rel="noopener noreferrer">
                    Site oficial (nova aba)
                  </a>
                }
              </p>
            </div>
          </div>

          @if (details.trailer; as trailer) {
            <section class="block" aria-labelledby="titulo-trailer">
              <h2 id="titulo-trailer">Trailer</h2>
              <div class="trailer">
                <!-- O player só é carregado depois do clique: nada do YouTube é baixado antes disso. -->
                @if (playing()) {
                  <iframe
                    class="trailer__frame"
                    [src]="trailerUrl()"
                    [title]="'Trailer: ' + trailer.name"
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                    referrerpolicy="strict-origin-when-cross-origin"
                  ></iframe>
                } @else {
                  <button type="button" class="button button--primary" (click)="playing.set(true)">
                    ▶ Assistir ao trailer
                  </button>
                }
              </div>
              <p>
                <a
                  [href]="'https://www.youtube.com/watch?v=' + trailer.key"
                  target="_blank"
                  rel="noopener noreferrer"
                  >Abrir no YouTube (nova aba)</a
                >
              </p>
            </section>
          }

          @if (details.cast.length > 0) {
            <section class="block" aria-labelledby="titulo-elenco">
              <h2 id="titulo-elenco">Elenco</h2>
              <ul class="cast" role="list">
                @for (person of details.cast; track person.id) {
                  <li class="cast__person">
                    @if (image(person.profilePath, 'w185'); as src) {
                      <img
                        class="cast__photo"
                        [src]="src"
                        alt=""
                        loading="lazy"
                        width="185"
                        height="278"
                      />
                    } @else {
                      <span class="cast__photo cast__photo--empty" aria-hidden="true">?</span>
                    }
                    <strong>{{ person.name }}</strong>
                    @if (person.character) {
                      <span class="muted">{{ person.character }}</span>
                    }
                  </li>
                }
              </ul>
            </section>
          }

          <section class="block" aria-labelledby="titulo-listas">
            <h2 id="titulo-listas">Minhas listas</h2>
            @if (lists.lists().length > 0) {
              <fieldset class="checks">
                <legend>Este título está em</legend>
                @for (list of lists.lists(); track list.id) {
                  <label class="checks__option">
                    <input
                      type="checkbox"
                      [checked]="lists.hasItem(list.id, details.media, details.id)"
                      (change)="toggleList(list, details, $any($event.target))"
                    />
                    {{ list.name }}
                  </label>
                }
              </fieldset>
            } @else {
              <p class="muted">Você ainda não tem listas.</p>
            }
            <form class="inline-form" (submit)="createList($event, novaLista, details)">
              <label for="nova-lista">Nova lista com este título</label>
              <input
                #novaLista
                id="nova-lista"
                type="text"
                required
                autocomplete="off"
                [maxLength]="maxListName"
              />
              <button type="submit" class="button">Criar e adicionar</button>
            </form>
            <p><a routerLink="/listas">Ver todas as listas</a></p>
            <p class="sr-only" role="status">{{ listNotice() }}</p>
          </section>

          <section class="block" aria-labelledby="titulo-avaliacao">
            <h2 id="titulo-avaliacao">Sua avaliação</h2>
            <p class="muted">Fica salva apenas neste navegador.</p>
            <form class="review-form" (submit)="saveReview($event, details)">
              <fieldset class="stars">
                <legend>Sua nota</legend>
                @for (value of [1, 2, 3, 4, 5]; track value) {
                  <label class="stars__option">
                    <input
                      type="radio"
                      name="nota"
                      required
                      [value]="value"
                      [checked]="rating() === value"
                      (change)="rating.set(value)"
                    />
                    {{ value }} <span aria-hidden="true">★</span>
                  </label>
                }
              </fieldset>
              <label for="comentario">Comentário (opcional)</label>
              <textarea
                #comentario
                id="comentario"
                rows="4"
                [maxLength]="maxLength"
                [value]="text()"
                (input)="text.set(comentario.value)"
              ></textarea>
              <p class="actions">
                <button type="submit" class="button button--primary">
                  {{ review() ? 'Atualizar avaliação' : 'Salvar avaliação' }}
                </button>
                @if (review()) {
                  <button type="button" class="button" (click)="removeReview(details)">
                    Remover avaliação
                  </button>
                }
              </p>
              <p class="sr-only" role="status">{{ notice() }}</p>
            </form>
          </section>
        </article>
      }
    }
  `,
})
export class Details {
  private readonly tmdb = inject(TmdbService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly title = inject(Title);
  protected readonly library = inject(LibraryService);
  protected readonly lists = inject(ListsService);
  private readonly attempt = signal(0);

  // Vêm da rota: `media` de `data` e `id` do caminho (`/filmes/:id`).
  readonly media = input.required<MediaType>();
  readonly id = input.required<string>();

  protected readonly maxLength = MAX_REVIEW_LENGTH;
  protected readonly maxListName = MAX_LIST_NAME;
  protected readonly listNotice = signal('');
  protected readonly ratingClass = ratingClass;
  protected readonly formatRating = formatRating;
  protected readonly image = imageUrl;

  protected readonly rating = signal(0);
  protected readonly text = signal('');
  protected readonly playing = signal(false);
  protected readonly notice = signal('');

  private readonly numericId = computed(() => (/^\d+$/.test(this.id()) ? Number(this.id()) : 0));
  private readonly request = computed(() => ({
    media: this.media(),
    id: this.numericId(),
    attempt: this.attempt(),
  }));

  protected readonly state = toSignal(
    toObservable(this.request).pipe(
      switchMap(({ media, id }) =>
        this.tmdb.details(media, id).pipe(
          map((details): DetailsState => ({ status: 'ok', details })),
          startWith<DetailsState>({ status: 'loading' }),
          catchError((error: unknown) => of<DetailsState>({ status: 'error', error })),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as DetailsState },
  );

  private readonly loaded = computed(() => {
    const state = this.state();
    return state.status === 'ok' ? state.details : null;
  });

  protected readonly favorite = computed(() =>
    this.library.isFavorite(this.media(), this.numericId()),
  );
  protected readonly review = computed(() => this.library.review(this.media(), this.numericId()));

  protected readonly facts = computed(() => {
    const details = this.loaded();
    if (!details) {
      return [];
    }
    return [
      { name: 'Lançamento', value: formatDate(details.date) },
      { name: 'Duração', value: formatRuntime(details.runtime) },
      { name: 'Temporadas', value: details.seasons ? String(details.seasons) : '' },
      { name: 'Episódios', value: details.episodes ? String(details.episodes) : '' },
      { name: 'Situação', value: translateStatus(details.status) },
      { name: 'Orçamento', value: formatMoney(details.budget) },
      { name: 'Receita', value: formatMoney(details.revenue) },
    ].filter((fact) => fact.value !== '');
  });

  protected readonly trailerUrl = computed<SafeResourceUrl | null>(() => {
    const key = this.loaded()?.trailer?.key;
    // Seguro: `pickTrailer` só aceita chaves no formato do YouTube ([\w-]{6,20}) e o domínio é fixo.
    return key
      ? this.sanitizer.bypassSecurityTrustResourceUrl(
          `https://www.youtube-nocookie.com/embed/${key}?autoplay=1`,
        )
      : null;
  });

  constructor() {
    // Ao abrir outro título, o formulário passa a mostrar a avaliação salva dele.
    effect(() => {
      const review = this.review();
      this.rating.set(review?.rating ?? 0);
      this.text.set(review?.text ?? '');
    });
    effect(() => {
      const details = this.loaded();
      this.playing.set(false);
      if (details) {
        this.title.setTitle(`${details.title} · Movie App`);
      }
    });
  }

  protected retry(): void {
    this.attempt.update((count) => count + 1);
  }

  protected toggleList(list: CustomList, details: MediaDetails, box: HTMLInputElement): void {
    if (!box.checked) {
      this.lists.removeItem(list.id, details.media, details.id);
      this.listNotice.set(`${details.title} removido de ${list.name}.`);
    } else if (this.lists.addItem(list.id, details)) {
      this.listNotice.set(`${details.title} adicionado a ${list.name}.`);
    } else {
      // Lista cheia: o [checked] não muda de valor, então a caixa é desmarcada aqui.
      box.checked = false;
      this.listNotice.set(`${list.name} está cheia.`);
    }
  }

  protected createList(event: Event, input: HTMLInputElement, details: MediaDetails): void {
    event.preventDefault();
    try {
      const list = this.lists.create(input.value, [details]);
      input.value = '';
      this.listNotice.set(`Lista ${list.name} criada com ${details.title}.`);
    } catch (failure) {
      this.listNotice.set(
        failure instanceof RangeError ? failure.message : 'Não foi possível criar.',
      );
      input.focus();
    }
  }

  protected saveReview(event: Event, details: MediaDetails): void {
    event.preventDefault();
    if (this.rating() < 1) {
      this.notice.set('Escolha uma nota de 1 a 5.');
      return;
    }
    this.library.saveReview(details, this.rating(), this.text());
    this.notice.set('Avaliação salva.');
  }

  protected removeReview(details: MediaDetails): void {
    this.library.removeReview(details.media, details.id);
    this.notice.set('Avaliação removida.');
  }
}
