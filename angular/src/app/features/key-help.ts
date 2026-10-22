import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { ConfigService } from '../core/config.service';

/** Estado "sem chave": explica como obter e configurar a chave do TMDB. */
@Component({
  selector: 'app-key-help',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="panel">
      <h1>Configurar a chave do TMDB</h1>
      <p class="panel__status">
        @if (config.hasKey()) {
          Há uma chave configurada em <code>config.json</code>. Se o TMDB a recusou, confira se ela
          foi copiada por inteiro.
        } @else {
          Nenhuma chave configurada. Sem ela o app não consegue buscar filmes e séries.
        }
      </p>
      <ol>
        <li>
          Crie uma conta gratuita em
          <a href="https://www.themoviedb.org/signup" target="_blank" rel="noopener noreferrer"
            >themoviedb.org</a
          >.
        </li>
        <li>
          Em
          <a
            href="https://www.themoviedb.org/settings/api"
            target="_blank"
            rel="noopener noreferrer"
            >Configurações › API</a
          >, solicite uma chave de desenvolvedor.
        </li>
        <li>
          Abra <code>public/config.json</code> (criado a partir de
          <code>public/config.example.json</code> ao rodar <code>npm start</code>) e preencha
          <code>apiKey</code> com a chave v3 ou com o token de leitura v4.
        </li>
        <li>Recarregue a página.</li>
      </ol>
      <p class="muted">O arquivo <code>config.json</code> é ignorado pelo git.</p>
    </div>
  `,
})
export class KeyHelp {
  protected readonly config = inject(ConfigService);
}
