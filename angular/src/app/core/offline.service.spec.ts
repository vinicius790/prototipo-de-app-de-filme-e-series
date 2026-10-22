import { HttpClient } from '@angular/common/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { TEST_KEY, loadKey, provideTesting } from '../testing';
import { OfflineService } from './offline.service';
import { CACHED_AT_HEADER } from './offline.util';
import { TMDB_API } from './tmdb.util';

describe('OfflineService + offlineInterceptor', () => {
  let offline: OfflineService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideTesting() });
    offline = TestBed.inject(OfflineService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('resposta nova da rede não mostra aviso', async () => {
    await loadKey(TEST_KEY);
    const result = firstValueFrom(TestBed.inject(HttpClient).get(`${TMDB_API}/genre/movie/list`));
    http.expectOne((req) => req.url.endsWith('/genre/movie/list')).flush({ genres: [] });
    await result;

    expect(offline.status()).toBe('');
  });

  it('resposta vinda do cache do service worker mostra a data em que foi salva', async () => {
    await loadKey(TEST_KEY);
    const savedAt = new Date(2026, 4, 6, 7, 8).getTime();
    const result = firstValueFrom(TestBed.inject(HttpClient).get(`${TMDB_API}/movie/603`));
    http
      .expectOne((req) => req.url.endsWith('/movie/603'))
      .flush({ id: 603 }, { headers: { [CACHED_AT_HEADER]: String(savedAt) } });
    await result;

    expect(offline.status()).toMatch(
      /^Sem resposta do TMDB\. Mostrando dados salvos em 06\/05\/2026/,
    );
    offline.reset();
    expect(offline.status()).toBe('');
  });

  it('o navegador sem conexão aparece no indicador', () => {
    window.dispatchEvent(new Event('offline'));
    expect(offline.status()).toMatch(/^Você está offline\./);
    window.dispatchEvent(new Event('online'));
    expect(offline.status()).toBe('');
  });

  it('cabeçalho ilegível ou requisição que não é do TMDB não mudam nada', async () => {
    await loadKey(TEST_KEY);
    const client = TestBed.inject(HttpClient);
    const tmdb = firstValueFrom(client.get(`${TMDB_API}/movie/1`));
    http
      .expectOne((req) => req.url.endsWith('/movie/1'))
      .flush({}, { headers: { [CACHED_AT_HEADER]: 'ontem' } });
    await tmdb;

    const other = firstValueFrom(client.get('outro.json'));
    http.expectOne('outro.json').flush({}, { headers: { [CACHED_AT_HEADER]: '1' } });
    await other;

    expect(offline.status()).toBe('');
  });
});
