import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Observable, catchError, forkJoin, map, of, startWith, switchMap } from 'rxjs';

import { ListType, MediaSummary, MediaType } from '../core/tmdb.models';
import { TmdbService } from '../core/tmdb.service';
import { imageUrl } from '../core/tmdb.util';
import { ErrorMessage, Loading } from '../shared/feedback';
import { MediaCard } from '../shared/media-card';

interface RowConfig {
  title: string;
  media: MediaType;
  list: ListType;
  link: string;
}

interface Row extends RowConfig {
  /** `null` quando só esta faixa falhou; as demais continuam na tela. */
  items: MediaSummary[] | null;
}

type HomeState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ok'; rows: Row[]; featured: MediaSummary | null };

const ROWS: RowConfig[] = [
  { title: 'Filmes em cartaz', media: 'movie', list: 'now', link: '/filmes' },
  { title: 'Filmes populares', media: 'movie', list: 'popular', link: '/filmes' },
  { title: 'Séries no ar', media: 'tv', list: 'now', link: '/series' },
  { title: 'Séries mais bem avaliadas', media: 'tv', list: 'top', link: '/series' },
];

/** Página inicial: destaque em cartaz e quatro faixas de filmes e séries. */
@Component({
  selector: 'app-home',
  imports: [RouterLink, MediaCard, Loading, ErrorMessage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="sr-only">Início</h1>
    @let current = state();
    @switch (current.status) {
      @case ('loading') {
        <app-loading />
      }
      @case ('error') {
        <app-error-message [error]="current.error" (retry)="retry()" />
      }
      @case ('ok') {
        @if (current.featured; as featured) {
          <section class="hero" aria-label="Destaque">
            @if (backdrop(featured); as src) {
              <img class="hero__image" [src]="src" alt="" />
            }
            <div class="hero__body">
              <p class="eyebrow">Em cartaz</p>
              <h2 class="hero__title">{{ featured.title }}</h2>
              @if (featured.overview) {
                <p class="hero__overview">{{ featured.overview }}</p>
              }
              <a class="button button--primary" [routerLink]="['/filmes', featured.id]">
                Ver detalhes
              </a>
            </div>
          </section>
        }
        @for (row of current.rows; track row.title) {
          <section class="row" [attr.aria-labelledby]="'faixa-' + $index">
            <div class="row__head">
              <h2 [id]="'faixa-' + $index">{{ row.title }}</h2>
              <a
                [routerLink]="row.link"
                [queryParams]="row.list === 'popular' ? {} : { lista: row.list }"
                [attr.aria-label]="'Ver todos: ' + row.title"
                >Ver todos</a
              >
            </div>
            @if (row.items; as items) {
              <ul class="row__track" role="list">
                @for (item of items; track item.id) {
                  <li><app-media-card [item]="item" /></li>
                }
              </ul>
            } @else {
              <p class="muted">Não foi possível carregar esta lista agora.</p>
            }
          </section>
        }
      }
    }
  `,
})
export class Home {
  private readonly tmdb = inject(TmdbService);
  private readonly attempt = signal(0);

  protected readonly state = toSignal(
    toObservable(this.attempt).pipe(switchMap(() => this.load())),
    { initialValue: { status: 'loading' } as HomeState },
  );

  protected retry(): void {
    this.attempt.update((count) => count + 1);
  }

  protected backdrop(item: MediaSummary): string | null {
    return imageUrl(item.backdropPath, 'w1280');
  }

  private load(): Observable<HomeState> {
    let firstError: unknown = null;
    const requests = ROWS.map((row) =>
      this.tmdb.list({ media: row.media, list: row.list }).pipe(
        map((page) => page.items.slice(0, 12)),
        catchError((error: unknown) => {
          firstError ??= error;
          return of(null);
        }),
      ),
    );
    return forkJoin(requests).pipe(
      map((results): HomeState => {
        if (results.every((items) => items === null)) {
          return { status: 'error', error: firstError };
        }
        return {
          status: 'ok',
          rows: ROWS.map((row, index) => ({ ...row, items: results[index] })),
          featured: results[0]?.find((item) => item.backdropPath) ?? null,
        };
      }),
      startWith<HomeState>({ status: 'loading' }),
    );
  }
}
