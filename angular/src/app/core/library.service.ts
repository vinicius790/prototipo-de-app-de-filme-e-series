import { Injectable, InjectionToken, inject, signal } from '@angular/core';

import {
  Entry,
  asString,
  forgetEmptyGenres,
  genresField,
  isEntry,
  sameTitle,
  toFavorite,
  toGenreIds,
} from './library.util';
import { MediaType } from './tmdb.models';

export interface Favorite {
  id: number;
  media: MediaType;
  title: string;
  posterPath: string | null;
  rating: number;
  date: string;
  /** Ids de gênero do TMDB. Ausente: ainda não se sabe; `[]`: conferido, sem gênero. */
  genreIds?: number[];
}

export interface Review {
  id: number;
  media: MediaType;
  title: string;
  rating: number;
  text: string;
  updatedAt: string;
  genreIds?: number[];
}

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Storage injetável: nos testes entra um substituto em memória. */
export const STORAGE = new InjectionToken<KeyValueStorage>('storage', {
  providedIn: 'root',
  factory: () => {
    try {
      return window.localStorage;
    } catch {
      // Em alguns modos de privacidade o acesso a localStorage lança erro.
      const data = new Map<string, string>();
      return {
        getItem: (name) => data.get(name) ?? null,
        setItem: (name, value) => void data.set(name, value),
      };
    }
  },
});

// Mesmas chaves da versão web-vanilla: servidas na mesma origem, as duas versões compartilham os dados.
export const FAVORITES_KEY = 'movie-app:favoritos';
export const REVIEWS_KEY = 'movie-app:avaliacoes';
export const MAX_REVIEW_LENGTH = 1000;
/** Marca de que favoritos e avaliações já estão no formato de gêneros da 1.3 (o mesmo da web-vanilla). */
export const GENRES_FORMAT_KEY = 'movie-app:generos-v2';

function toReview(entry: Entry): Review | null {
  const { rating, text, updatedAt, genreIds } = entry as Partial<Record<keyof Review, unknown>>;
  if (!Number.isInteger(rating) || (rating as number) < 1 || (rating as number) > 5) {
    return null;
  }
  return {
    id: entry.id,
    media: entry.media,
    title: entry.title,
    rating: rating as number,
    text: asString(text),
    updatedAt: asString(updatedAt),
    ...genresField(genreIds),
  };
}

/** Favoritos e avaliações do usuário, guardados no navegador. */
@Injectable({ providedIn: 'root' })
export class LibraryService {
  private readonly storage = inject(STORAGE);
  private readonly legacyGenres = this.isLegacyGenres();
  private readonly favoriteList = signal(
    this.read(FAVORITES_KEY)
      .map(toFavorite)
      .map((entry) => (this.legacyGenres ? forgetEmptyGenres(entry) : entry)),
  );
  private readonly reviewList = signal(
    this.read(REVIEWS_KEY)
      .map(toReview)
      .filter((review) => review !== null)
      .map((entry) => (this.legacyGenres ? forgetEmptyGenres(entry) : entry)),
  );

  readonly favorites = this.favoriteList.asReadonly();
  readonly reviews = this.reviewList.asReadonly();

  constructor() {
    // Migração única dos gêneros (a versão web-vanilla, na mesma origem, faz a mesma coisa).
    if (this.legacyGenres) {
      if (this.favoriteList().length > 0) {
        this.write(FAVORITES_KEY, this.favoriteList());
      }
      if (this.reviewList().length > 0) {
        this.write(REVIEWS_KEY, this.reviewList());
      }
      try {
        this.storage.setItem(GENRES_FORMAT_KEY, '1');
      } catch {
        // storage bloqueado: a migração é refeita na próxima sessão, sem perda
      }
    }
  }

  isFavorite(media: MediaType, id: number): boolean {
    return this.favoriteList().some(sameTitle(media, id));
  }

  /** Alterna o favorito e devolve `true` quando o título passou a ser favorito. */
  toggleFavorite(item: Favorite): boolean {
    const wasFavorite = this.isFavorite(item.media, item.id);
    // toFavorite guarda só o resumo, mesmo quando recebe os detalhes inteiros do título.
    this.favoriteList.update((list) =>
      wasFavorite
        ? list.filter((entry) => !sameTitle(item.media, item.id)(entry))
        : [...list, toFavorite(item)],
    );
    this.write(FAVORITES_KEY, this.favoriteList());
    return !wasFavorite;
  }

  review(media: MediaType, id: number): Review | null {
    return this.reviewList().find(sameTitle(media, id)) ?? null;
  }

  /** Uma avaliação por título: salvar de novo substitui a anterior. */
  saveReview(
    entry: Entry & { genreIds?: number[] },
    rating: number,
    text = '',
    now = new Date(),
  ): Review {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new RangeError('A nota precisa ser um número inteiro de 1 a 5.');
    }
    const review: Review = {
      id: entry.id,
      media: entry.media,
      title: entry.title,
      rating,
      text: text.trim().slice(0, MAX_REVIEW_LENGTH),
      updatedAt: now.toISOString(),
      ...genresField(entry.genreIds),
    };
    this.reviewList.update((list) => [
      ...list.filter((item) => !sameTitle(entry.media, entry.id)(item)),
      review,
    ]);
    this.write(REVIEWS_KEY, this.reviewList());
    return review;
  }

  removeReview(media: MediaType, id: number): void {
    this.reviewList.update((list) => list.filter((item) => !sameTitle(media, id)(item)));
    this.write(REVIEWS_KEY, this.reviewList());
  }

  /**
   * Grava os gêneros de um título cujo gênero ainda não se sabe (favorito e/ou avaliação).
   * Lista vazia também é gravada: marca o título como conferido, para não ser buscado de novo.
   * Não mexe em entradas que já têm o campo. Devolve se algo mudou.
   */
  fillGenres(media: MediaType, id: number, genreIds: readonly number[]): boolean {
    const ids = toGenreIds(genreIds);
    const needs = (entry: Favorite | Review) =>
      sameTitle(media, id)(entry) && entry.genreIds === undefined;
    if (![...this.favoriteList(), ...this.reviewList()].some(needs)) {
      return false;
    }
    this.favoriteList.update((list) =>
      list.map((entry) => (needs(entry) ? { ...entry, genreIds: ids } : entry)),
    );
    this.reviewList.update((list) =>
      list.map((entry) => (needs(entry) ? { ...entry, genreIds: ids } : entry)),
    );
    this.write(FAVORITES_KEY, this.favoriteList());
    this.write(REVIEWS_KEY, this.reviewList());
    return true;
  }

  private isLegacyGenres(): boolean {
    try {
      return this.storage.getItem(GENRES_FORMAT_KEY) === null;
    } catch {
      return true;
    }
  }

  // Dados gravados por outra versão do app, ou editados à mão, não podem derrubar a página.
  private read(key: string): Entry[] {
    try {
      const value: unknown = JSON.parse(this.storage.getItem(key) ?? 'null');
      return Array.isArray(value) ? value.filter(isEntry) : [];
    } catch {
      return [];
    }
  }

  private write(key: string, value: unknown): void {
    try {
      this.storage.setItem(key, JSON.stringify(value));
    } catch {
      // Cota cheia ou storage bloqueado: o estado segue valendo só nesta sessão.
    }
  }
}
