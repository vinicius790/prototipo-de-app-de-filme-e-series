import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { pageRange } from '../core/tmdb.util';

/**
 * Paginação por links: cada página é uma URL (`?pagina=N`), então funciona com teclado,
 * com o botão "voltar" e pode ser compartilhada. Os demais filtros da URL são preservados.
 */
@Component({
  selector: 'app-pagination',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (totalPages() > 1) {
      <nav class="pagination" aria-label="Paginação">
        <ul role="list">
          <li>
            @if (page() > 1) {
              <a
                class="page"
                [routerLink]="[]"
                [queryParams]="params(page() - 1)"
                queryParamsHandling="merge"
                >‹ Anterior</a
              >
            } @else {
              <span class="page page--disabled" aria-disabled="true">‹ Anterior</span>
            }
          </li>
          @for (entry of range(); track $index) {
            @if (entry === 'gap') {
              <li aria-hidden="true"><span class="page page--gap">…</span></li>
            } @else {
              <li>
                <a
                  class="page"
                  [routerLink]="[]"
                  [queryParams]="params(entry)"
                  queryParamsHandling="merge"
                  [attr.aria-label]="'Página ' + entry"
                  [attr.aria-current]="entry === page() ? 'page' : null"
                  >{{ entry }}</a
                >
              </li>
            }
          }
          <li>
            @if (page() < totalPages()) {
              <a
                class="page"
                [routerLink]="[]"
                [queryParams]="params(page() + 1)"
                queryParamsHandling="merge"
                >Próxima ›</a
              >
            } @else {
              <span class="page page--disabled" aria-disabled="true">Próxima ›</span>
            }
          </li>
        </ul>
      </nav>
    }
  `,
})
export class Pagination {
  readonly page = input.required<number>();
  readonly totalPages = input.required<number>();

  protected readonly range = computed(() => pageRange(this.page(), this.totalPages()));

  /** A página 1 é o padrão e sai da URL. */
  protected params(page: number): { pagina: number | null } {
    return { pagina: page > 1 ? page : null };
  }
}
