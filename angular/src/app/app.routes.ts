import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';

import { ConfigService } from './core/config.service';

/** Telas que dependem da API mandam para a ajuda da chave enquanto ela não estiver configurada. */
export const requireKey: CanActivateFn = () =>
  inject(ConfigService).hasKey() || inject(Router).parseUrl('/chave');

const browse = () => import('./features/browse').then((module) => module.Browse);
const details = () => import('./features/details').then((module) => module.Details);

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Movie App · Filmes e séries',
    canActivate: [requireKey],
    loadComponent: () => import('./features/home').then((module) => module.Home),
  },
  {
    path: 'filmes',
    title: 'Filmes · Movie App',
    data: { media: 'movie' },
    canActivate: [requireKey],
    loadComponent: browse,
  },
  {
    path: 'filmes/:id',
    title: 'Filme · Movie App',
    data: { media: 'movie' },
    canActivate: [requireKey],
    loadComponent: details,
  },
  {
    path: 'series',
    title: 'Séries · Movie App',
    data: { media: 'tv' },
    canActivate: [requireKey],
    loadComponent: browse,
  },
  {
    path: 'series/:id',
    title: 'Série · Movie App',
    data: { media: 'tv' },
    canActivate: [requireKey],
    loadComponent: details,
  },
  {
    path: 'favoritos',
    title: 'Favoritos · Movie App',
    loadComponent: () => import('./features/favorites').then((module) => module.Favorites),
  },
  {
    path: 'listas',
    title: 'Minhas listas · Movie App',
    loadComponent: () => import('./features/lists').then((module) => module.Lists),
  },
  {
    // Antes de 'listas/:id', para "importar" nunca ser lido como id de uma lista.
    path: 'listas/importar',
    title: 'Importar lista · Movie App',
    loadComponent: () => import('./features/list-import').then((module) => module.ListImport),
  },
  {
    path: 'listas/:id',
    title: 'Lista · Movie App',
    loadComponent: () => import('./features/list-details').then((module) => module.ListDetails),
  },
  {
    path: 'recomendacoes',
    title: 'Para você · Movie App',
    canActivate: [requireKey],
    loadComponent: () =>
      import('./features/recommendations').then((module) => module.Recommendations),
  },
  {
    path: 'chave',
    title: 'Chave da API · Movie App',
    loadComponent: () => import('./features/key-help').then((module) => module.KeyHelp),
  },
  {
    path: '**',
    title: 'Página não encontrada · Movie App',
    loadComponent: () => import('./features/not-found').then((module) => module.NotFound),
  },
];
