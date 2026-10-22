import { Injectable, inject, signal } from '@angular/core';

import { Favorite, STORAGE } from './library.service';
import { sameTitle } from './library.util';
import {
  CustomList,
  LISTS_KEY,
  LISTS_VERSION,
  addItem,
  createList,
  migrateLists,
  moveItem,
  randomListId,
  removeItem,
  renameList,
  serializeLists,
} from './lists.util';
import { MediaType } from './tmdb.models';

/**
 * Listas personalizadas do usuário, guardadas no navegador com número de versão.
 * As regras ficam em `lists.util.ts`; aqui só o estado (signal) e a persistência.
 */
@Injectable({ providedIn: 'root' })
export class ListsService {
  private readonly storage = inject(STORAGE);
  private readonly state = signal(this.read());

  readonly lists = this.state.asReadonly();

  get(id: string): CustomList | null {
    return this.state().find((list) => list.id === id) ?? null;
  }

  /** Cria uma lista, já com títulos quando vem de um link compartilhado. Nome vazio lança erro. */
  create(name: string, items: Favorite[] = [], now = new Date()): CustomList {
    const next = createList(this.state(), name, items, now.toISOString(), randomListId());
    this.commit(next);
    return next[next.length - 1];
  }

  /** Devolve se a lista existia; nome vazio lança `RangeError`. */
  rename(id: string, name: string, now = new Date()): boolean {
    return this.commit(renameList(this.state(), id, name, now.toISOString()));
  }

  remove(id: string): void {
    if (this.get(id)) {
      this.commit(this.state().filter((list) => list.id !== id));
    }
  }

  hasItem(id: string, media: MediaType, itemId: number): boolean {
    return this.get(id)?.items.some(sameTitle(media, itemId)) ?? false;
  }

  /** Devolve `true` se o título entrou; `false` se já estava, a lista não existe ou está cheia. */
  addItem(id: string, item: Favorite, now = new Date()): boolean {
    return this.commit(addItem(this.state(), id, item, now.toISOString()));
  }

  removeItem(id: string, media: MediaType, itemId: number, now = new Date()): boolean {
    return this.commit(removeItem(this.state(), id, media, itemId, now.toISOString()));
  }

  /** Reordena: leva o título da posição `from` para a posição `to`. Devolve se algo mudou. */
  moveItem(id: string, from: number, to: number, now = new Date()): boolean {
    return this.commit(moveItem(this.state(), id, from, to, now.toISOString()));
  }

  /** As funções de `lists.util` devolvem o mesmo array quando nada mudou. */
  private commit(next: CustomList[]): boolean {
    if (next === this.state()) {
      return false;
    }
    this.state.set(next);
    this.write(serializeLists(next));
    return true;
  }

  // Dados gravados por outra versão do app, ou editados à mão, não podem derrubar a página.
  private read(): CustomList[] {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(LISTS_KEY);
    } catch {
      // storage bloqueado: começa vazio
    }
    const lists = migrateLists(raw);
    // Um formato antigo é regravado no atual logo na primeira leitura.
    if (raw !== null && lists.length > 0 && !raw.startsWith(`{"version":${LISTS_VERSION},`)) {
      this.write(serializeLists(lists));
    }
    return lists;
  }

  private write(value: string): void {
    try {
      this.storage.setItem(LISTS_KEY, value);
    } catch {
      // Cota cheia ou storage bloqueado: o estado segue valendo só nesta sessão.
    }
  }
}
