import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { ListsService } from '../core/lists.service';
import { MAX_LIST_NAME } from '../core/lists.util';

/** Índice das listas personalizadas, com criação. Funciona mesmo sem chave do TMDB. */
@Component({
  selector: 'app-lists',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Minhas listas</h1>
    <p class="muted">
      As listas ficam salvas apenas neste navegador. Para levar uma lista a outra pessoa ou
      aparelho, abra a lista e use o link de compartilhamento.
    </p>

    <form class="inline-form" (submit)="create($event, nome)">
      <label for="nome-lista">Nome da nova lista</label>
      <input
        #nome
        id="nome-lista"
        type="text"
        required
        autocomplete="off"
        [maxLength]="maxName"
        [attr.aria-describedby]="error() ? 'nome-lista-erro' : null"
      />
      <button type="submit" class="button">Criar lista</button>
      @if (error()) {
        <p id="nome-lista-erro" class="error" role="alert">{{ error() }}</p>
      }
    </form>

    @if (lists.lists().length > 0) {
      <ul class="lists" role="list">
        @for (list of lists.lists(); track list.id) {
          <li class="lists__item">
            <a [routerLink]="['/listas', list.id]">{{ list.name }}</a>
            <span class="muted">{{ count(list.items.length) }}</span>
          </li>
        }
      </ul>
    } @else {
      <div class="state">
        <h2>Nenhuma lista ainda</h2>
        <p>
          Crie uma lista acima e adicione títulos pela página de detalhes de cada filme ou série.
        </p>
      </div>
    }
  `,
})
export class Lists {
  private readonly router = inject(Router);
  protected readonly lists = inject(ListsService);
  protected readonly maxName = MAX_LIST_NAME;
  protected readonly error = signal('');

  protected count(total: number): string {
    return total === 1 ? '1 título' : `${total} títulos`;
  }

  protected create(event: Event, input: HTMLInputElement): void {
    event.preventDefault();
    try {
      const list = this.lists.create(input.value);
      this.error.set('');
      void this.router.navigate(['/listas', list.id]);
    } catch (failure) {
      this.error.set(failure instanceof RangeError ? failure.message : 'Não foi possível criar.');
      input.focus();
    }
  }
}
