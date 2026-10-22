import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { distinctUntilChanged, filter, map, skip } from 'rxjs';

import { OfflineService } from './core/offline.service';

/** Moldura do app: cabeçalho com navegação, área de conteúdo e rodapé com a atribuição ao TMDB. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
})
export class App {
  private readonly main = viewChild.required<ElementRef<HTMLElement>>('conteudo');
  protected readonly offline = inject(OfflineService);

  constructor() {
    // O aviso de "dados salvos" vale para a tela em que apareceu; a próxima começa sem ele.
    inject(Router)
      .events.pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.offline.reset());

    // Ao trocar de tela (não de filtro ou página), o foco vai para o conteúdo novo.
    inject(Router)
      .events.pipe(
        filter((event) => event instanceof NavigationEnd),
        map((event) => event.urlAfterRedirects.split('?')[0]),
        distinctUntilChanged(),
        skip(1),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.focusMain());
  }

  /** O link "pular para o conteúdo" não pode mudar o hash, que é usado como rota. */
  protected skipToContent(event: Event): void {
    event.preventDefault();
    this.focusMain();
  }

  private focusMain(): void {
    this.main().nativeElement.focus({ preventScroll: true });
  }
}
