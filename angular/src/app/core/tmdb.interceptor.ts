import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';

import { ConfigService } from './config.service';
import { TMDB_API } from './tmdb.util';

export type TmdbErrorKind = 'no-key' | 'auth' | 'not-found' | 'rate-limit' | 'network' | 'http';

const MESSAGES: Record<TmdbErrorKind, string> = {
  'no-key': 'Nenhuma chave da API do TMDB foi configurada.',
  auth: 'O TMDB recusou a chave da API. Confira se ela foi copiada corretamente.',
  'not-found': 'Este título não foi encontrado no TMDB.',
  'rate-limit': 'Muitas requisições em pouco tempo. Aguarde alguns segundos e tente de novo.',
  network: 'Não foi possível conectar ao TMDB. Verifique sua conexão com a internet.',
  http: 'O TMDB respondeu com um erro inesperado.',
};

/** Erro já traduzido para o usuário; é o único tipo de erro que as telas precisam tratar. */
export class TmdbError extends Error {
  constructor(
    readonly kind: TmdbErrorKind,
    readonly status?: number,
  ) {
    super(MESSAGES[kind]);
    this.name = 'TmdbError';
  }
}

function kindForStatus(status: number): TmdbErrorKind {
  if (status === 0) {
    return 'network';
  }
  if (status === 401 || status === 403) {
    return 'auth';
  }
  if (status === 404) {
    return 'not-found';
  }
  if (status === 429) {
    return 'rate-limit';
  }
  return 'http';
}

export function toTmdbError(error: unknown): TmdbError {
  if (error instanceof TmdbError) {
    return error;
  }
  if (error instanceof HttpErrorResponse) {
    return new TmdbError(kindForStatus(error.status), error.status);
  }
  return new TmdbError('http');
}

/**
 * Para requisições ao TMDB: acrescenta chave e idioma e converte falhas em `TmdbError`.
 * Tokens de leitura da API v4 (JWT) vão no cabeçalho; chaves v3 vão na query string.
 * Qualquer outra URL passa intacta, sem receber a chave.
 */
export const tmdbInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(TMDB_API)) {
    return next(request);
  }
  const apiKey = inject(ConfigService).apiKey();
  if (!apiKey) {
    return throwError(() => new TmdbError('no-key'));
  }
  const bearer = apiKey.startsWith('eyJ');
  const authorized = request.clone({
    setParams: bearer ? { language: 'pt-BR' } : { language: 'pt-BR', api_key: apiKey },
    setHeaders: bearer ? { Authorization: `Bearer ${apiKey}` } : {},
  });
  return next(authorized).pipe(
    catchError((error: unknown) => throwError(() => toTmdbError(error))),
  );
};
