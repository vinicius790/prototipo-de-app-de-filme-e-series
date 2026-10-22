import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { LibraryService, Review } from '../core/library.service';
import { formatDate } from '../core/tmdb.util';
import { MediaCard } from '../shared/media-card';

/** Favoritos e avaliações guardados no navegador. Funciona mesmo sem chave do TMDB. */
@Component({
  selector: 'app-favorites',
  imports: [RouterLink, MediaCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: '.section-title { margin-top: 2.5rem; }',
  template: `
    <h1>Favoritos</h1>
    @if (library.favorites().length > 0) {
      <ul class="grid" role="list">
        @for (item of library.favorites(); track item.media + item.id) {
          <li><app-media-card [item]="item" /></li>
        }
      </ul>
    } @else {
      <div class="state">
        <h2>Nenhum favorito ainda</h2>
        <p>Use o coração nos cartões de filmes e séries para guardá-los aqui.</p>
        <p class="actions">
          <a class="button button--primary" routerLink="/filmes">Explorar filmes</a>
        </p>
      </div>
    }

    <h2 class="section-title">Minhas avaliações</h2>
    @if (library.reviews().length > 0) {
      <ul class="reviews" role="list">
        @for (review of library.reviews(); track review.media + review.id) {
          <li class="review">
            <p class="review__head">
              <a [routerLink]="[review.media === 'tv' ? '/series' : '/filmes', review.id]">{{
                review.title
              }}</a>
              <span class="review__stars">
                <span aria-hidden="true">{{ stars(review) }}</span>
                <span class="sr-only">Nota {{ review.rating }} de 5</span>
              </span>
            </p>
            @if (review.text) {
              <p>{{ review.text }}</p>
            }
            <p class="actions">
              <span class="muted">{{ formatDate(review.updatedAt) }}</span>
              <button
                type="button"
                class="button"
                [attr.aria-label]="'Remover avaliação de ' + review.title"
                (click)="library.removeReview(review.media, review.id)"
              >
                Remover
              </button>
            </p>
          </li>
        }
      </ul>
    } @else {
      <p class="muted">
        Você ainda não avaliou nenhum título. A avaliação fica na página de detalhes.
      </p>
    }
  `,
})
export class Favorites {
  protected readonly library = inject(LibraryService);
  protected readonly formatDate = formatDate;

  protected stars(review: Review): string {
    return '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
  }
}
