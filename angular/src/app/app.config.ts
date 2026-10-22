import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withHashLocation,
  withInMemoryScrolling,
} from '@angular/router';

import { routes } from './app.routes';
import { ConfigService } from './core/config.service';
import { offlineInterceptor } from './core/offline.service';
import { tmdbInterceptor } from './core/tmdb.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // offlineInterceptor repara quando a resposta veio do cache do service worker (public/sw.js).
    provideHttpClient(withFetch(), withInterceptors([tmdbInterceptor, offlineInterceptor])),
    // A chave é lida antes da primeira rota, para o guarda `requireKey` já saber se ela existe.
    provideAppInitializer(() => inject(ConfigService).load()),
    provideRouter(
      routes,
      // Rotas por hash funcionam em hospedagem estática (GitHub Pages) sem regra de reescrita.
      withHashLocation(),
      // Parâmetros de rota, de consulta e `data` chegam aos componentes como inputs.
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
    ),
  ],
};
