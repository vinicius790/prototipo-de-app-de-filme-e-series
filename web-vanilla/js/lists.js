// Listas personalizadas: criar, renomear, excluir, adicionar, remover e reordenar títulos.
// Ficam no localStorage dentro de um envelope com número de versão, para que formatos antigos
// possam ser migrados. Também cuida do compartilhamento de uma lista por link.

import { isEntry, toFavorite } from './store.js';

export const LISTS_KEY = 'movie-app:listas';
export const LISTS_VERSION = 1;
export const MAX_LISTS = 50;
export const MAX_LIST_NAME = 60;
export const MAX_LIST_ITEMS = 200;
const MAX_TITLE_LENGTH = 200;

const sameTitle = (media, id) => (entry) => entry.media === media && entry.id === id;
const asString = (value) => (typeof value === 'string' ? value : '');

export function cleanListName(name) {
  return asString(name).replace(/\s+/g, ' ').trim().slice(0, MAX_LIST_NAME);
}

function uniqueItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.media}:${item.id}`;
    return seen.has(key) ? false : seen.add(key);
  });
}

export function toList(value, fallbackDate) {
  if (value === null || typeof value !== 'object' || !/^[\w-]{1,40}$/.test(asString(value.id))) {
    return null;
  }
  const name = cleanListName(value.name);
  if (!name || !Array.isArray(value.items)) {
    return null;
  }
  const createdAt = asString(value.createdAt) || fallbackDate;
  return {
    id: value.id,
    name,
    items: uniqueItems(value.items.filter(isEntry).map(toFavorite)).slice(0, MAX_LIST_ITEMS),
    createdAt,
    updatedAt: asString(value.updatedAt) || createdAt,
  };
}

/**
 * Converte o que estiver gravado (qualquer versão, ou lixo) para o formato atual.
 * Versão 0: só o array de listas, sem envelope nem datas. Versão 1: `{ version: 1, lists }`.
 * @param {string|null} raw texto lido do storage
 * @param {Date} [now] data usada para preencher listas antigas sem data
 */
export function migrateLists(raw, now = new Date()) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  let lists = [];
  if (Array.isArray(value)) {
    lists = value;
  } else if (Number.isInteger(value?.version) && value.version >= 1 && Array.isArray(value.lists)) {
    lists = value.lists;
  }
  const seen = new Set();
  return lists
    .map((list) => toList(list, now.toISOString()))
    .filter((list) => list !== null && !seen.has(list.id) && seen.add(list.id))
    .slice(0, MAX_LISTS);
}

function randomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @param {Storage} storage
 * @param {{now?: () => Date, newId?: () => string}} [options] injetáveis nos testes
 */
export function createListStore(storage, { now = () => new Date(), newId = randomId } = {}) {
  let raw = null;
  try {
    raw = storage.getItem(LISTS_KEY);
  } catch {
    // storage bloqueado: começa vazio
  }
  let lists = migrateLists(raw, now());

  const save = () => {
    try {
      storage.setItem(LISTS_KEY, JSON.stringify({ version: LISTS_VERSION, lists }));
    } catch {
      // Cota cheia ou storage bloqueado: o estado segue valendo só nesta sessão.
    }
  };
  // Um formato antigo é regravado no atual logo na primeira leitura.
  if (raw !== null && lists.length > 0 && !raw.startsWith(`{"version":${LISTS_VERSION},`)) {
    save();
  }

  const copy = (list) => ({ ...list, items: [...list.items] });
  const find = (id) => lists.find((list) => list.id === id) ?? null;

  /** Troca os itens (ou o nome) de uma lista e marca a data de alteração. */
  function update(id, changes) {
    const list = find(id);
    if (!list) {
      return null;
    }
    const next = { ...list, ...changes, updatedAt: now().toISOString() };
    lists = lists.map((entry) => (entry === list ? next : entry));
    save();
    return copy(next);
  }

  function requireName(name) {
    const clean = cleanListName(name);
    if (!clean) {
      throw new RangeError('A lista precisa de um nome.');
    }
    return clean;
  }

  return {
    lists() {
      return lists.map(copy);
    },

    get(id) {
      const list = find(id);
      return list ? copy(list) : null;
    },

    /** Cria uma lista, já com títulos quando vem de um link compartilhado. */
    create(name, items = []) {
      const clean = requireName(name);
      if (lists.length >= MAX_LISTS) {
        throw new RangeError(`O limite é de ${MAX_LISTS} listas.`);
      }
      const stamp = now().toISOString();
      const list = {
        id: newId(),
        name: clean,
        items: uniqueItems(items.filter(isEntry).map(toFavorite)).slice(0, MAX_LIST_ITEMS),
        createdAt: stamp,
        updatedAt: stamp,
      };
      lists = [...lists, list];
      save();
      return copy(list);
    },

    /** Devolve a lista renomeada, ou `null` se ela não existe. */
    rename(id, name) {
      return update(id, { name: requireName(name) });
    },

    remove(id) {
      lists = lists.filter((list) => list.id !== id);
      save();
    },

    hasItem(id, media, itemId) {
      return find(id)?.items.some(sameTitle(media, itemId)) ?? false;
    },

    /** Devolve `true` se o título entrou; `false` se já estava, a lista não existe ou está cheia. */
    addItem(id, item) {
      const list = find(id);
      if (!list || !isEntry(item) || list.items.length >= MAX_LIST_ITEMS) {
        return false;
      }
      if (list.items.some(sameTitle(item.media, item.id))) {
        return false;
      }
      update(id, { items: [...list.items, toFavorite(item)] });
      return true;
    },

    removeItem(id, media, itemId) {
      const list = find(id);
      if (list) {
        update(id, { items: list.items.filter((entry) => !sameTitle(media, itemId)(entry)) });
      }
    },

    /** Reordena: leva o título da posição `from` para a posição `to`. Devolve se algo mudou. */
    moveItem(id, from, to) {
      const list = find(id);
      const valid = (index) => Number.isInteger(index) && index >= 0 && index < (list?.items.length ?? 0);
      if (!list || !valid(from) || !valid(to) || from === to) {
        return false;
      }
      const items = [...list.items];
      items.splice(to, 0, ...items.splice(from, 1));
      update(id, { items });
      return true;
    },

    /**
     * Importa uma lista de listas (ex.: a partir de um backup JSON).
     * @param {object[]} importedLists
     * @param {{overwrite?: boolean}} [options]
     */
    importLists(importedLists, { overwrite = false } = {}) {
      const fallbackDate = now().toISOString();
      const valid = importedLists
        .map((l) => toList(l, fallbackDate))
        .filter((l) => l !== null);

      if (overwrite) {
        lists = valid.slice(0, MAX_LISTS);
      } else {
        const existingIds = new Set(lists.map((l) => l.id));
        for (const list of valid) {
          if (lists.length >= MAX_LISTS) {
            break;
          }
          if (existingIds.has(list.id)) {
            // Se o id já existe, gera um novo id para não conflitar
            list.id = newId();
          }
          existingIds.add(list.id);
          lists.push(list);
        }
      }
      save();
      return lists.map(copy);
    },
  };
}

// ---- Compartilhamento por link ----
// O link leva só o nome da lista e, de cada título, o tipo, o id do TMDB e o nome:
// `{"v":1,"n":"nome","i":[[0,603,"Matrix"],[1,1399,"Dark"]]}` em UTF-8.
// Formato do código: `z` + base64url do JSON comprimido com deflate-raw (links longos ficam bem
// mais curtos) ou, se a compressão não ajudar ou o navegador não a tiver, base64url do JSON puro
// (o formato da versão 1.1, que continua sendo lido). Um JSON puro começa com `{` e, em base64,
// com `e`: nunca com `z`, então os dois formatos não se confundem.
// Notas, comentários, favoritos, datas e a chave da API nunca entram no link.

export const SHARE_VERSION = 1;
const COMPRESSED_PREFIX = 'z';
/** Limite do JSON descomprimido: barra códigos pequenos que se expandem em gigabytes. */
const MAX_SHARE_BYTES = 256 * 1024;

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code) {
  const base64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Passa os bytes por um CompressionStream/DecompressionStream, parando acima de `limit`. */
async function transform(bytes, stream, limit = Infinity) {
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reader = source.pipeThrough(stream).getReader();
  const chunks = [];
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
export async function encodeShare(list) {
  const payload = {
    v: SHARE_VERSION,
    n: list.name,
    i: list.items.map((item) => [item.media === 'tv' ? 1 : 0, item.id, item.title]),
  };
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const plain = toBase64Url(json);
  try {
    const compressed = COMPRESSED_PREFIX + toBase64Url(await transform(json, new CompressionStream('deflate-raw')));
    return compressed.length < plain.length ? compressed : plain;
  } catch {
    // Navegador sem CompressionStream (ou sem deflate-raw): o formato sem compressão vale igual.
    return plain;
  }
}

/**
 * Lê o código de um link compartilhado. Qualquer coisa fora do formato esperado invalida o
 * link inteiro (devolve `null`): é dado vindo de fora e não dá para confiar em parte dele.
 * @returns {Promise<{name: string, items: object[]}|null>}
 */
export async function decodeShare(code) {
  if (typeof code !== 'string' || !/^[\w-]{1,40000}$/.test(code)) {
    return null;
  }
  let payload;
  try {
    const bytes = code.startsWith(COMPRESSED_PREFIX)
      ? await transform(fromBase64Url(code.slice(1)), new DecompressionStream('deflate-raw'), MAX_SHARE_BYTES)
      : fromBase64Url(code);
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  const name = cleanListName(payload?.n);
  if (payload?.v !== SHARE_VERSION || !name || !Array.isArray(payload.i) || payload.i.length > MAX_LIST_ITEMS) {
    return null;
  }
  const items = [];
  for (const entry of payload.i) {
    if (!Array.isArray(entry) || entry.length !== 3) {
      return null;
    }
    const [kind, id, title] = entry;
    const cleanTitle = asString(title).trim().slice(0, MAX_TITLE_LENGTH);
    if ((kind !== 0 && kind !== 1) || !Number.isInteger(id) || id < 1 || !cleanTitle) {
      return null;
    }
    items.push(toFavorite({ id, media: kind === 1 ? 'tv' : 'movie', title: cleanTitle }));
  }
  return { name, items: uniqueItems(items) };
}
