import {
  ChangeDetectionStrategy,
  Component,
  PendingTasks,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { ListsService } from '../core/lists.service';
import { SharedList, decodeShare } from '../core/lists.util';
import { Loading } from '../shared/feedback';

/** Tela aberta por um link compartilhado (`/listas/importar?d=código`). Não exige chave. */
@Component({
  selector: 'app-list-import',
  imports: [RouterLink, Loading],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let shared = current();
    <div class="panel">
      @if (shared === undefined) {
        <app-loading />
      } @else if (shared) {
        <h1>Importar lista</h1>
        <p class="panel__status">“{{ shared.name }}” · {{ count(shared.items.length) }}</p>
        <ol>
          @for (item of shared.items; track item.media + item.id) {
            <li>
              <a [routerLink]="[item.media === 'tv' ? '/series' : '/filmes', item.id]">{{
                item.title
              }}</a>
              ({{ item.media === 'tv' ? 'Série' : 'Filme' }})
            </li>
          }
        </ol>
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
        <p class="actions">
          <button type="button" class="button button--primary" (click)="save()">
            Salvar nas minhas listas
          </button>
        </p>
      } @else {
        <h1>Link de lista inválido</h1>
        <p>
          O link está incompleto ou foi alterado. Peça a quem compartilhou que copie o link de novo.
        </p>
        <p class="actions">
          <a class="button button--primary" routerLink="/listas">Ir para as minhas listas</a>
        </p>
      }
    </div>
  `,
})
export class ListImport {
  private readonly lists = inject(ListsService);
  private readonly router = inject(Router);

  /** Código do link, vindo do parâmetro de consulta `d`. É validado por `decodeShare`. */
  readonly d = input<string>();

  protected readonly error = signal('');
  /** `undefined` enquanto o código é lido; `null` quando o link é inválido. */
  protected readonly current = signal<SharedList | null | undefined>(undefined);
  private readonly pendingTasks = inject(PendingTasks);
  private request = 0;

  constructor() {
    // A leitura é assíncrona (o código pode vir comprimido); só a mais recente vale.
    effect(() => {
      const code = this.d();
      const request = ++this.request;
      this.current.set(undefined);
      void this.pendingTasks.run(async () => {
        const shared = await decodeShare(code);
        if (request === this.request) {
          this.current.set(shared);
        }
      });
    });
  }

  protected count(total: number): string {
    return total === 1 ? '1 título' : `${total} títulos`;
  }

  protected save(): void {
    const shared = this.current();
    if (!shared) {
      return;
    }
    try {
      const list = this.lists.create(shared.name, shared.items);
      // replaceUrl: voltar no histórico não deve reabrir a tela de importação.
      void this.router.navigate(['/listas', list.id], { replaceUrl: true });
    } catch (failure) {
      this.error.set(
        failure instanceof RangeError ? failure.message : 'Não foi possível importar a lista.',
      );
    }
  }
}
