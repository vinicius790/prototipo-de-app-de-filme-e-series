import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Favorite, LibraryService } from '../core/library.service';
import { formatRating, imageUrl, ratingClass, yearOf } from '../core/tmdb.util';

/** Cartão de um filme ou série, com link para os detalhes e botão de favorito. */
@Component({
  selector: 'app-media-card',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: ':host { display: block; height: 100%; }',
  template: `
    <article class="card">
      <a class="card__link" [routerLink]="link()">
        <!-- alt vazio: o título logo abaixo já nomeia o link. -->
        @if (poster(); as src) {
          <img
            class="card__poster"
            [src]="src"
            alt=""
            loading="lazy"
            decoding="async"
            width="342"
            height="513"
          />
        } @else {
          <span class="card__poster card__poster--empty" aria-hidden="true">Sem imagem</span>
        }
        <span class="card__title">{{ item().title }}</span>
      </a>
      <p class="card__meta">
        <span class="nota" [class]="ratingClass()">
          <span class="sr-only">Nota </span>{{ rating() }}
        </span>
        <span>{{ label() }}</span>
      </p>
      <button
        type="button"
        class="fav"
        [attr.aria-pressed]="favorite()"
        [attr.aria-label]="'Favorito: ' + item().title"
        (click)="library.toggleFavorite(item())"
      >
        <span class="fav__icon" aria-hidden="true"></span>
      </button>
    </article>
  `,
})
export class MediaCard {
  protected readonly library = inject(LibraryService);

  readonly item = input.required<Favorite>();

  protected readonly link = computed(() => [
    this.item().media === 'tv' ? '/series' : '/filmes',
    this.item().id,
  ]);
  protected readonly poster = computed(() => imageUrl(this.item().posterPath));
  protected readonly rating = computed(() => formatRating(this.item().rating));
  protected readonly ratingClass = computed(() => ratingClass(this.item().rating));
  protected readonly favorite = computed(() =>
    this.library.isFavorite(this.item().media, this.item().id),
  );
  protected readonly label = computed(() => {
    const kind = this.item().media === 'tv' ? 'Série' : 'Filme';
    const year = yearOf(this.item().date);
    return year ? `${kind} · ${year}` : kind;
  });
}
