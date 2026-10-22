import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TmdbError } from '../core/tmdb.interceptor';

/** Indicador de carregamento anunciado por leitores de tela. */
@Component({
  selector: 'app-loading',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="state" role="status">
      <span class="spinner" aria-hidden="true"></span>
      <p>Carregando…</p>
    </div>
  `,
})
export class Loading {}

/** Mensagem de erro com "tentar novamente" e, se a chave foi recusada, o caminho para trocá-la. */
@Component({
  selector: 'app-error-message',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="state" role="alert">
      <h2>Algo deu errado</h2>
      <p>{{ text() }}</p>
      <p class="actions">
        <button type="button" class="button button--primary" (click)="retry.emit()">
          Tentar novamente
        </button>
        @if (isAuthError()) {
          <a class="button" routerLink="/chave">Conferir a chave</a>
        }
      </p>
    </div>
  `,
})
export class ErrorMessage {
  readonly error = input.required<unknown>();
  readonly retry = output<void>();

  protected readonly isAuthError = computed(() => {
    const error = this.error();
    return error instanceof TmdbError && error.kind === 'auth';
  });

  protected readonly text = computed(() => {
    const error = this.error();
    return error instanceof TmdbError
      ? error.message
      : 'Ocorreu um erro inesperado ao carregar os dados.';
  });
}
