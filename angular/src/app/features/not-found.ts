import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="panel">
      <h1>Página não encontrada</h1>
      <p>O endereço aberto não corresponde a nenhuma tela do app.</p>
      <p class="actions"><a class="button button--primary" routerLink="/">Ir para o início</a></p>
    </div>
  `,
})
export class NotFound {}
