import { HttpBackend, HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { catchError, firstValueFrom, map, of } from 'rxjs';

/**
 * Lê a chave do TMDB de `config.json`, servido junto com o app.
 * O arquivo real fica fora do git; o versionado é `public/config.example.json`.
 */
@Injectable({ providedIn: 'root' })
export class ConfigService {
  // HttpBackend direto: esta requisição não deve passar pelos interceptadores do app.
  private readonly http = new HttpClient(inject(HttpBackend));
  private readonly key = signal('');

  readonly apiKey = this.key.asReadonly();
  readonly hasKey = computed(() => this.key() !== '');

  /** Nunca rejeita: arquivo ausente ou inválido significa apenas "sem chave". */
  async load(): Promise<void> {
    const key = await firstValueFrom(
      this.http.get<{ apiKey?: unknown } | null>('config.json').pipe(
        map((config) => (typeof config?.apiKey === 'string' ? config.apiKey.trim() : '')),
        catchError(() => of('')),
      ),
    );
    this.key.set(key);
  }
}
