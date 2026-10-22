import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, shareReplay, throwError } from 'rxjs';

import { TmdbError } from './tmdb.interceptor';
import {
  Genre,
  ListQuery,
  MediaDetails,
  MediaSummary,
  MediaType,
  Page,
  TmdbRawDetails,
  TmdbRawPage,
} from './tmdb.models';
import { TMDB_API, buildListRequest, normalizeDetails, normalizePage } from './tmdb.util';

/** Acesso tipado à API do TMDB. Chave, idioma e tradução de erros ficam no interceptador. */
@Injectable({ providedIn: 'root' })
export class TmdbService {
  private readonly http = inject(HttpClient);
  private readonly genreCache = new Map<MediaType, Observable<Genre[]>>();

  /** Lista paginada de filmes ou séries (populares, em cartaz, mais bem avaliados ou busca). */
  list(query: ListQuery, today = new Date()): Observable<Page<MediaSummary>> {
    const { path, params } = buildListRequest(query, today);
    return this.http
      .get<TmdbRawPage>(TMDB_API + path, { params })
      .pipe(map((raw) => normalizePage(raw, query.media)));
  }

  /** Gêneros reais do TMDB (id + nome), buscados uma vez por tipo de mídia. */
  genres(media: MediaType): Observable<Genre[]> {
    let cached = this.genreCache.get(media);
    if (!cached) {
      cached = this.http.get<{ genres?: Genre[] }>(`${TMDB_API}/genre/${media}/list`).pipe(
        map((response) => response.genres ?? []),
        catchError((error: unknown) => {
          this.genreCache.delete(media);
          return throwError(() => error);
        }),
        shareReplay(1),
      );
      this.genreCache.set(media, cached);
    }
    return cached;
  }

  /** Detalhes com elenco e vídeos numa única requisição. */
  details(media: MediaType, id: number): Observable<MediaDetails> {
    if (!Number.isInteger(id) || id < 1) {
      return throwError(() => new TmdbError('not-found', 404));
    }
    return this.http
      .get<TmdbRawDetails>(`${TMDB_API}/${media}/${id}`, {
        params: { append_to_response: 'credits,videos', include_video_language: 'pt,en' },
      })
      .pipe(map((raw) => normalizeDetails(raw, media)));
  }
}
