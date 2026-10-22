// Regras puras das listas personalizadas: formato gravado, migração entre versões, operações
// (todas devolvem um array novo, ou o mesmo quando nada mudou) e compartilhamento por link.
// O formato do storage e o do link são os mesmos da versão web-vanilla.

import type { Favorite } from './library.service';
import { asString, isEntry, sameTitle, toFavorite } from './library.util';
import type { MediaType } from './tmdb.models';

export interface CustomList {
  id: string;
  name: string;
  items: Favorite[];
  createdAt: string;
  updatedAt: string;
}

export interface SharedList {
  name: string;
  items: Favorite[];
}

export const LISTS_KEY = 'movie-app:listas';
export const LISTS_VERSION = 1;
export const MAX_LISTS = 50;
export const MAX_LIST_NAME = 60;
export const MAX_LIST_ITEMS = 200;
export const SHARE_VERSION = 1;
const MAX_TITLE_LENGTH = 200;

export function cleanListName(name: unknown): string {
  return asString(name).replace(/\s+/g, ' ').trim().slice(0, MAX_LIST_NAME);
}

/** Nome limpo, ou erro com mensagem pronta para a tela. */
export function requireListName(name: unknown): string {
  const clean = cleanListName(name);
  if (!clean) {
    throw new RangeError('A lista precisa de um nome.');
  }
  return clean;
}

function uniqueItems(items: Favorite[]): Favorite[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.media}:${item.id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function cleanItems(items: unknown[]): Favorite[] {
  return uniqueItems(items.filter(isEntry).map(toFavorite)).slice(0, MAX_LIST_ITEMS);
}

function toList(value: unknown, fallbackDate: string): CustomList | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const list = value as Record<string, unknown>;
  const id = asString(list['id']);
  const name = cleanListName(list['name']);
  const items = list['items'];
  if (!/^[\w-]{1,40}$/.test(id) || !name || !Array.isArray(items)) {
    return null;
  }
  const createdAt = asString(list['createdAt']) || fallbackDate;
  return {
    id,
    name,
    items: cleanItems(items),
    createdAt,
    updatedAt: asString(list['updatedAt']) || createdAt,
  };
}

/**
 * Converte o que estiver gravado (qualquer versão, ou lixo) para o formato atual.
 * Versão 0: só o array de listas, sem envelope nem datas. Versão 1: `{ version: 1, lists }`.
 */
export function migrateLists(raw: string | null, now = new Date()): CustomList[] {
  let value: unknown;
  try {
    value = JSON.parse(raw ?? 'null');
  } catch {
    return [];
  }
  let stored: unknown[] = [];
  if (Array.isArray(value)) {
    stored = value;
  } else if (value !== null && typeof value === 'object') {
    const envelope = value as Record<string, unknown>;
    const version = envelope['version'];
    const lists = envelope['lists'];
    if (Number.isInteger(version) && (version as number) >= 1 && Array.isArray(lists)) {
      stored = lists;
    }
  }
  const seen = new Set<string>();
  const result: CustomList[] = [];
  for (const entry of stored) {
    const list = toList(entry, now.toISOString());
    if (list && !seen.has(list.id)) {
      seen.add(list.id);
      result.push(list);
    }
  }
  return result.slice(0, MAX_LISTS);
}

export function serializeLists(lists: CustomList[]): string {
  return JSON.stringify({ version: LISTS_VERSION, lists });
}

export function randomListId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Acrescenta uma lista (já com títulos quando vem de um link compartilhado). */
export function createList(
  lists: CustomList[],
  name: unknown,
  items: unknown[],
  stamp: string,
  id: string,
): CustomList[] {
  const clean = requireListName(name);
  if (lists.length >= MAX_LISTS) {
    throw new RangeError(`O limite é de ${MAX_LISTS} listas.`);
  }
  return [
    ...lists,
    { id, name: clean, items: cleanItems(items), createdAt: stamp, updatedAt: stamp },
  ];
}

function change(
  lists: CustomList[],
  id: string,
  stamp: string,
  update: (list: CustomList) => Partial<CustomList> | null,
): CustomList[] {
  const list = lists.find((entry) => entry.id === id);
  const changes = list ? update(list) : null;
  if (!list || !changes) {
    return lists;
  }
  return lists.map((entry) => (entry === list ? { ...list, ...changes, updatedAt: stamp } : entry));
}

export function renameList(
  lists: CustomList[],
  id: string,
  name: unknown,
  stamp: string,
): CustomList[] {
  const clean = requireListName(name);
  return change(lists, id, stamp, () => ({ name: clean }));
}

/** Não muda nada se o título já está na lista, é inválido ou a lista está cheia. */
export function addItem(
  lists: CustomList[],
  id: string,
  item: unknown,
  stamp: string,
): CustomList[] {
  return change(lists, id, stamp, (list) => {
    if (!isEntry(item) || list.items.length >= MAX_LIST_ITEMS) {
      return null;
    }
    return list.items.some(sameTitle(item.media, item.id))
      ? null
      : { items: [...list.items, toFavorite(item)] };
  });
}

export function removeItem(
  lists: CustomList[],
  id: string,
  media: MediaType,
  itemId: number,
  stamp: string,
): CustomList[] {
  return change(lists, id, stamp, (list) => {
    const items = list.items.filter((entry) => !sameTitle(media, itemId)(entry));
    return items.length === list.items.length ? null : { items };
  });
}

/** Reordena: leva o título da posição `from` para a posição `to`. */
export function moveItem(
  lists: CustomList[],
  id: string,
  from: number,
  to: number,
  stamp: string,
): CustomList[] {
  return change(lists, id, stamp, (list) => {
    const valid = (index: number) =>
      Number.isInteger(index) && index >= 0 && index < list.items.length;
    if (!valid(from) || !valid(to) || from === to) {
      return null;
    }
    const items = [...list.items];
    items.splice(to, 0, ...items.splice(from, 1));
    return { items };
  });
}

// ---- Compartilhamento por link ----
// O link leva só o nome da lista e, de cada título, o tipo, o id do TMDB e o nome:
// `{"v":1,"n":"nome","i":[[0,603,"Matrix"],[1,1399,"Dark"]]}` em UTF-8.
// Formato do código: `z` + base64url do JSON comprimido com deflate-raw (links longos ficam bem
// mais curtos) ou, se a compressão não ajudar ou o navegador não a tiver, base64url do JSON puro
// (o formato da versão 1.1, que continua sendo lido). Um JSON puro começa com `{` e, em base64,
// com `e`: nunca com `z`, então os dois formatos não se confundem. Igual à versão web-vanilla.
// Notas, comentários, favoritos, datas e a chave da API nunca entram no link.

const COMPRESSED_PREFIX = 'z';
/** Limite do JSON descomprimido: barra códigos pequenos que se expandem em gigabytes. */
const MAX_SHARE_BYTES = 256 * 1024;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code: string): Uint8Array<ArrayBuffer> {
  const base64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Passa os bytes por um CompressionStream/DecompressionStream, parando acima de `limit`. */
async function transform(
  bytes: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
  limit = Infinity,
): Promise<Uint8Array<ArrayBuffer>> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reader = source.pipeThrough(stream).getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new RangeError('Conteúdo grande demais.');
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/** Código do link de uma lista (assíncrono por causa da compressão). */
export async function encodeShare(list: SharedList): Promise<string> {
  const payload = {
    v: SHARE_VERSION,
    n: list.name,
    i: list.items.map((item) => [item.media === 'tv' ? 1 : 0, item.id, item.title]),
  };
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const plain = toBase64Url(json);
  try {
    const deflated = await transform(json, new CompressionStream('deflate-raw'));
    const compressed = COMPRESSED_PREFIX + toBase64Url(deflated);
    return compressed.length < plain.length ? compressed : plain;
  } catch {
    // Navegador sem CompressionStream (ou sem deflate-raw): o formato sem compressão vale igual.
    return plain;
  }
}

/**
 * Lê o código de um link compartilhado. Qualquer coisa fora do formato esperado invalida o
 * link inteiro (devolve `null`): é dado vindo de fora e não dá para confiar em parte dele.
 */
export async function decodeShare(code: unknown): Promise<SharedList | null> {
  if (typeof code !== 'string' || !/^[\w-]{1,40000}$/.test(code)) {
    return null;
  }
  let parsed: unknown;
  try {
    const bytes = code.startsWith(COMPRESSED_PREFIX)
      ? await transform(
          fromBase64Url(code.slice(1)),
          new DecompressionStream('deflate-raw'),
          MAX_SHARE_BYTES,
        )
      : fromBase64Url(code);
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') {
    return null;
  }
  const payload = parsed as Record<string, unknown>;
  const name = cleanListName(payload['n']);
  const entries = payload['i'];
  if (
    payload['v'] !== SHARE_VERSION ||
    !name ||
    !Array.isArray(entries) ||
    entries.length > MAX_LIST_ITEMS
  ) {
    return null;
  }
  const items: Favorite[] = [];
  for (const entry of entries as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 3) {
      return null;
    }
    const [kind, id, title] = entry as unknown[];
    const cleanTitle = asString(title).trim().slice(0, MAX_TITLE_LENGTH);
    if (
      (kind !== 0 && kind !== 1) ||
      typeof id !== 'number' ||
      !Number.isInteger(id) ||
      id < 1 ||
      !cleanTitle
    ) {
      return null;
    }
    items.push(toFavorite({ id, media: kind === 1 ? 'tv' : 'movie', title: cleanTitle }));
  }
  return { name, items: uniqueItems(items) };
}
