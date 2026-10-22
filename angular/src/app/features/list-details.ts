import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  Injector,
  PendingTasks,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';

import { Favorite } from '../core/library.service';
import { ListsService } from '../core/lists.service';
import { MAX_LIST_NAME, encodeShare } from '../core/lists.util';
import { MediaCard } from '../shared/media-card';

/** Uma lista personalizada: renomear, compartilhar por link, excluir, reordenar e remover. */
@Component({
  selector: 'app-list-details',
  imports: [RouterLink, MediaCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (list(); as list) {
      <p><a routerLink="/listas">‹ Minhas listas</a></p>
      <h1 tabindex="-1">{{ list.name }}</h1>
      <p class="muted">{{ count(list.items.length) }}</p>

      <form class="inline-form" (submit)="rename($event, nome)">
        <label for="renomear-lista">Nome da lista</label>
        <input
          #nome
          id="renomear-lista"
          type="text"
          required
          autocomplete="off"
          [maxLength]="maxName"
          [value]="list.name"
          [attr.aria-describedby]="error() ? 'renomear-lista-erro' : null"
        />
        <button type="submit" class="button">Renomear</button>
        @if (error()) {
          <p id="renomear-lista-erro" class="error" role="alert">{{ error() }}</p>
        }
      </form>

      <div class="inline-form">
        <label for="link-lista">
          Link para compartilhar (leva só o nome da lista e os títulos)
        </label>
        <input #link id="link-lista" type="text" readonly [value]="shareUrl()" />
        <button type="button" class="button" (click)="copyLink(link)">
          {{ copied() ? 'Link copiado' : 'Copiar link' }}
        </button>
      </div>

      @if (list.items.length > 0) {
        <ol class="grid" [attr.aria-label]="'Títulos de ' + list.name + ', na ordem da lista'">
          @for (item of list.items; track item.media + item.id) {
            <li>
              <app-media-card [item]="item" />
              <p class="actions list-tools">
                <button
                  type="button"
                  class="button button--small"
                  [disabled]="$first"
                  [attr.aria-label]="'Mover ' + item.title + ' para cima'"
                  (click)="move(item, $index, $index - 1, list.items.length)"
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="button button--small"
                  [disabled]="$last"
                  [attr.aria-label]="'Mover ' + item.title + ' para baixo'"
                  (click)="move(item, $index, $index + 1, list.items.length)"
                >
                  ↓
                </button>
                <button
                  type="button"
                  class="button button--small"
                  [attr.aria-label]="'Remover ' + item.title + ' da lista'"
                  (click)="removeItem(item)"
                >
                  Remover
                </button>
              </p>
            </li>
          }
        </ol>
      } @else {
        <div class="state">
          <h2>Lista vazia</h2>
          <p>Abra um filme ou série e marque esta lista em “Minhas listas”.</p>
          <p class="actions">
            <a class="button button--primary" routerLink="/filmes">Explorar filmes</a>
          </p>
        </div>
      }

      <p class="actions">
        <button type="button" class="button" (click)="remove(list.name)">Excluir lista</button>
      </p>
      <p class="sr-only" role="status">{{ notice() }}</p>
    } @else {
      <div class="panel">
        <h1>Lista não encontrada</h1>
        <p>Esta lista não existe neste navegador. Ela pode ter sido excluída.</p>
        <p class="actions">
          <a class="button button--primary" routerLink="/listas">Ir para as minhas listas</a>
        </p>
      </div>
    }
  `,
})
export class ListDetails {
  private readonly lists = inject(ListsService);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly pendingTasks = inject(PendingTasks);
  /** Conta as gerações do link: só a mais recente pode preencher o campo. */
  private shareRequest = 0;

  /** Vem do caminho da rota (`/listas/:id`). */
  readonly id = input.required<string>();

  protected readonly maxName = MAX_LIST_NAME;
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly copied = signal(false);

  protected readonly list = computed(() => {
    const id = this.id();
    return this.lists.lists().find((entry) => entry.id === id) ?? null;
  });

  /**
   * O app usa rotas por hash: o link é a página atual mais `#/listas/importar?d=código`.
   * A compressão do código é assíncrona, então o campo é preenchido assim que ele fica pronto.
   */
  protected readonly shareUrl = signal('');

  constructor() {
    effect(() => {
      const list = this.list();
      this.copied.set(false);
      this.shareUrl.set('');
      const request = ++this.shareRequest;
      if (list) {
        this.title.setTitle(`${list.name} · Movie App`);
        const base = this.document.location.href.split('#')[0];
        // PendingTasks: a aplicação (e os testes) só ficam estáveis depois que o link sai.
        void this.pendingTasks.run(async () => {
          const code = await encodeShare(list);
          if (request === this.shareRequest) {
            this.shareUrl.set(`${base}#/listas/importar?d=${code}`);
          }
        });
      }
    });
  }

  protected count(total: number): string {
    return total === 1 ? '1 título' : `${total} títulos`;
  }

  protected rename(event: Event, input: HTMLInputElement): void {
    event.preventDefault();
    try {
      this.lists.rename(this.id(), input.value);
      this.error.set('');
      this.notice.set('Lista renomeada.');
    } catch (failure) {
      this.error.set(
        failure instanceof RangeError ? failure.message : 'Não foi possível renomear.',
      );
      input.focus();
    }
  }

  protected async copyLink(input: HTMLInputElement): Promise<void> {
    if (!this.shareUrl()) {
      return;
    }
    try {
      await navigator.clipboard.writeText(this.shareUrl());
      this.copied.set(true);
      this.notice.set('Link copiado.');
    } catch {
      // Sem permissão ou sem a API de área de transferência: deixa o link selecionado para Ctrl+C.
      input.select();
      this.notice.set(
        'Não foi possível copiar sozinho. O link está selecionado: copie com Ctrl+C.',
      );
    }
  }

  protected move(item: Favorite, from: number, to: number, total: number): void {
    if (this.lists.moveItem(this.id(), from, to)) {
      this.notice.set(`${item.title} agora é o ${to + 1}º de ${total}.`);
      this.restoreFocus(`Mover ${item.title} para ${to < from ? 'cima' : 'baixo'}`);
    }
  }

  protected removeItem(item: Favorite): void {
    this.lists.removeItem(this.id(), item.media, item.id);
    this.notice.set(`${item.title} removido da lista.`);
    this.restoreFocus();
  }

  /**
   * Reordenar move os itens no DOM e remover apaga o botão clicado, e nos dois casos o foco se
   * perderia: volta ao botão de mesmo rótulo, se ainda está ativo, ou ao título da lista.
   */
  private restoreFocus(label = ''): void {
    afterNextRender(
      () => {
        const host = this.host.nativeElement;
        const button = [...host.querySelectorAll<HTMLButtonElement>('.list-tools button')].find(
          (candidate) => candidate.getAttribute('aria-label') === label && !candidate.disabled,
        );
        (button ?? host.querySelector<HTMLElement>('h1'))?.focus();
      },
      { injector: this.injector },
    );
  }

  protected remove(name: string): void {
    const question = `Excluir a lista “${name}”? Os títulos continuam nos favoritos e no catálogo.`;
    if (this.document.defaultView?.confirm(question)) {
      this.lists.remove(this.id());
      void this.router.navigate(['/listas']);
    }
  }
}
