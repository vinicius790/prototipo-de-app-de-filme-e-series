import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  EMPTY,
  Observable,
  catchError,
  forkJoin,
  from,
  map,
  mergeMap,
  of,
  startWith,
  switchMap,
  tap,
  toArray,
} from 'rxjs';

import { LibraryService } from '../core/library.service';
import {
  GENRE_LOOKUP_CONCURRENCY,
  MAX_RECOMMENDED_GENRES,
  excludeKnown,
  explain,
  genreProfile,
  missingGenres,
} from '../core/recommend.util';
import { TmdbError } from '../core/tmdb.interceptor';
import { MediaSummary } from '../core/tmdb.models';
import { TmdbService } from '../core/tmdb.service';
import { ErrorMessage, Loading } from '../shared/feedback';
import { MediaCard } from '../shared/media-card';

interface Row {
  title: string;
  /** "Porque você gostou de…" */
  why: string;
  link: string;
  genre: string;
  items: MediaSummary[];
}

type RecommendationsState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; error: unknown }
  | { status: 'ok'; rows: Row[] };

/**
 * Favoritos e avaliações gravados antes da versão 1.1 não têm gêneros: busca os detalhes de cada
 * um no TMDB (no máximo GENRE_LOOKUP_CONCURRENCY ao mesmo tempo) e regrava. Título sem gênero, ou
 * que não existe mais no TMDB, é gravado com `[]` e não é buscado de novo. Falha de rede não grava
 * nada: o título é buscado de novo na próxima visita.
 */
@Injectable({ providedIn: 'root' })
export class GenreBackfill {
  private readonly tmdb = inject(TmdbService);
  private readonly library = inject(LibraryService);

  /** Completa o que der e termina sempre com sucesso: falhas só deixam o título como estava. */
  complete(): Observable<unknown> {
    const missing = missingGenres(this.library.favorites(), this.library.reviews());
    return from(missing).pipe(
      mergeMap(
        ({ media, id }) =>
          this.tmdb.details(media, id).pipe(
            tap((details) => this.library.fillGenres(media, id, details.genreIds)),
            catchError((error: unknown) => {
              if (error instanceof TmdbError && error.kind === 'not-found') {
                this.library.fillGenres(media, id, []);
              }
              return EMPTY;
            }),
          ),
        GENRE_LOOKUP_CONCURRENCY,
      ),
      toArray(),
    );
  }
}

/** "Para você": títulos populares dos gêneros que mais aparecem nos favoritos e avaliações. */
@Component({
  selector: 'app-recommendations',
  imports: [RouterLink, MediaCard, Loading, ErrorMessage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Para você</h1>
    @let current = state();
    @switch (current.status) {
      @case ('loading') {
        <app-loading />
      }
      @case ('error') {
        <app-error-message [error]="current.error" (retry)="retry()" />
      }
      @case ('empty') {
        <div class="state">
          <h2>Ainda não há recomendações</h2>
          <p>
            Favorite alguns títulos, ou avalie com 4 ou 5 estrelas, para receber sugestões dos
            gêneros de que você mais gosta.
          </p>
          <p class="actions">
            <a class="button button--primary" routerLink="/filmes">Explorar filmes</a>
          </p>
        </div>
      }
      @case ('ok') {
        <p class="muted">
          Sugestões calculadas neste navegador a partir dos gêneros dos seus favoritos e das suas
          avaliações.
        </p>
        @for (row of current.rows; track row.link + row.genre) {
          <section class="row" [attr.aria-labelledby]="'recomendacao-' + $index">
            <div class="row__head">
              <h2 [id]="'recomendacao-' + $index">{{ row.title }}</h2>
              <a
                [routerLink]="row.link"
                [queryParams]="{ genero: row.genre }"
                [attr.aria-label]="'Ver todos: ' + row.title"
                >Ver todos</a
              >
            </div>
            <p class="muted row__why">{{ row.why }}</p>
            <ul class="row__track" role="list">
              @for (item of row.items; track item.id) {
                <li><app-media-card [item]="item" /></li>
              }
            </ul>
          </section>
        } @empty {
          <div class="state">
            <h2>Nada novo por enquanto</h2>
            <p>Você já favoritou ou avaliou tudo o que apareceu nos seus gêneros preferidos.</p>
          </div>
        }
      }
    }
  `,
})
export class Recommendations {
  private readonly tmdb = inject(TmdbService);
  private readonly library = inject(LibraryService);
  private readonly backfill = inject(GenreBackfill);
  private readonly attempt = signal(0);

  protected readonly state = toSignal(
    toObservable(this.attempt).pipe(switchMap(() => this.load())),
    { initialValue: { status: 'loading' } as RecommendationsState },
  );

  protected retry(): void {
    this.attempt.update((count) => count + 1);
  }

  private load(): Observable<RecommendationsState> {
    return this.backfill.complete().pipe(
      switchMap(() => this.recommend()),
      startWith<RecommendationsState>({ status: 'loading' }),
    );
  }

  private recommend(): Observable<RecommendationsState> {
    // Fotografia do momento em que a tela abre: favoritar uma sugestão não reembaralha a tela.
    const favorites = this.library.favorites();
    const reviews = this.library.reviews();
    const profile = genreProfile(favorites, reviews).slice(0, MAX_RECOMMENDED_GENRES);
    if (profile.length === 0) {
      return of<RecommendationsState>({ status: 'empty' });
    }

    let firstError: unknown = null;
    const requests = profile.map((genre) =>
      forkJoin([
        this.tmdb.genres(genre.media),
        this.tmdb.list({ media: genre.media, genre: String(genre.genreId) }),
      ]).pipe(
        map(([genres, page]): Row | null => {
          const name = genres.find((entry) => entry.id === genre.genreId)?.name ?? 'Gênero';
          return {
            title: `${name} · ${genre.media === 'tv' ? 'Séries' : 'Filmes'}`,
            why: explain(genre.because),
            link: genre.media === 'tv' ? '/series' : '/filmes',
            genre: String(genre.genreId),
            items: excludeKnown(page.items, favorites, reviews),
          };
        }),
        catchError((error: unknown) => {
          firstError ??= error;
          return of(null);
        }),
      ),
    );
    return forkJoin(requests).pipe(
      map((results): RecommendationsState => {
        if (results.every((row) => row === null)) {
          return { status: 'error', error: firstError };
        }
        return {
          status: 'ok',
          rows: results.filter((row): row is Row => row !== null && row.items.length > 0),
        };
      }),
    );
  }
}
