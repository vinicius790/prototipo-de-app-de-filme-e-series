import { isDevMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig).catch((err) => console.error(err));

// Modo offline: só no build de produção, para o `ng serve` nunca servir arquivos antigos do cache.
// Falha de registro (navegador antigo, contexto inseguro) só desliga o modo offline.
if (!isDevMode() && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => undefined);
}
