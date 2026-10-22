import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { tap } from 'rxjs';

import { CACHED_AT_HEADER, offlineStatus } from './offline.util';
import { TMDB_API } from './tmdb.util';

/**
 * Estado da conexão mostrado no topo do app: se o navegador está offline e se o que está em tela
 * veio do cache do service worker (`public/sw.js`), com a data em que foi gravado.
 */
@Injectable({ providedIn: 'root' })
export class OfflineService {
  private readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  private readonly cachedAt = signal<number | null>(null);

  /** Texto do indicador; vazio quando está tudo normal. */
  readonly status = computed(() =>
    offlineStatus({ online: this.online(), cachedAt: this.cachedAt() }),
  );

  constructor() {
    // Serviço raiz: vive enquanto a página viver, então os ouvintes não precisam ser removidos.
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.online.set(true));
      window.addEventListener('offline', () => this.online.set(false));
    }
  }

  /** Chamado a cada resposta do TMDB com o valor do cabeçalho `x-cached-at` (ou `null`). */
  noteResponse(cachedAt: string | null): void {
    const time = Number(cachedAt);
    if (cachedAt && Number.isFinite(time)) {
      this.cachedAt.set(time);
    }
  }

  /** Ao trocar de tela, o aviso de "dados salvos" da tela anterior deixa de valer. */
  reset(): void {
    this.cachedAt.set(null);
  }
}

/** Repara quando o service worker respondeu a uma chamada ao TMDB com uma cópia guardada. */
export const offlineInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(TMDB_API)) {
    return next(request);
  }
  const offline = inject(OfflineService);
  return next(request).pipe(
    tap((event) => {
      if (event instanceof HttpResponse) {
        offline.noteResponse(event.headers.get(CACHED_AT_HEADER));
      }
    }),
  );
};
