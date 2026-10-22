// Apoio aos testes: HttpClient com o interceptador real e backend simulado.

import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { EnvironmentProviders, Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ConfigService } from './core/config.service';
import { KeyValueStorage, STORAGE } from './core/library.service';
import { offlineInterceptor } from './core/offline.service';
import { tmdbInterceptor } from './core/tmdb.interceptor';

export const TEST_KEY = 'chave-de-teste';

export function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (name) => data.get(name) ?? null,
    setItem: (name, value) => void data.set(name, value),
  };
}

export function provideTesting(storage = memoryStorage()): (Provider | EnvironmentProviders)[] {
  return [
    provideHttpClient(withInterceptors([tmdbInterceptor, offlineInterceptor])),
    provideHttpClientTesting(),
    { provide: STORAGE, useValue: storage },
  ];
}

/** Simula o carregamento de `config.json` com a chave informada. */
export async function loadKey(apiKey: string): Promise<void> {
  const loading = TestBed.inject(ConfigService).load();
  TestBed.inject(HttpTestingController).expectOne('config.json').flush({ apiKey });
  await loading;
}
