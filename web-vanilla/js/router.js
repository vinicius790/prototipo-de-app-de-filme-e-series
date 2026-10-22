// Rotas por hash: a URL é a única fonte de verdade da tela e dos filtros,
// então voltar/avançar do navegador e links compartilhados funcionam sem código extra.

import { LIST_TYPES, clampPage } from './api.js';

const LIST_PATHS = { filmes: 'movie', series: 'tv' };
const DETAILS_PATHS = { filme: 'movie', serie: 'tv' };

/** @param {string} hash valor de `location.hash` */
export function parseRoute(hash) {
  const [path, search = ''] = hash.replace(/^#/, '').split('?');
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 0) {
    return { view: 'home' };
  }
  if (segments.length === 1 && Object.hasOwn(LIST_PATHS, segments[0])) {
    const params = new URLSearchParams(search);
    const list = params.get('lista');
    const genre = params.get('genero') ?? '';
    const sort = params.get('ordem') ?? '';
    const yearFrom = params.get('ano_de') ?? '';
    const yearTo = params.get('ano_ate') ?? '';
    const route = {
      view: 'list',
      media: LIST_PATHS[segments[0]],
      list: LIST_TYPES.includes(list) ? list : 'popular',
      genre: /^\d+$/.test(genre) ? genre : '',
      query: (params.get('q') ?? '').trim(),
      page: clampPage(params.get('pagina')),
    };
    if (['popularidade', 'nota', 'recentes'].includes(sort)) {
      route.sort = sort;
    }
    if (/^\d{4}$/.test(yearFrom)) {
      route.yearFrom = yearFrom;
    }
    if (/^\d{4}$/.test(yearTo)) {
      route.yearTo = yearTo;
    }
    return route;
  }
  if (segments.length === 2 && Object.hasOwn(DETAILS_PATHS, segments[0]) && /^\d+$/.test(segments[1])) {
    return { view: 'details', media: DETAILS_PATHS[segments[0]], id: Number(segments[1]) };
  }
  if (segments.length === 1 && segments[0] === 'favoritos') {
    return { view: 'favorites' };
  }
  if (segments.length === 1 && segments[0] === 'listas') {
    return { view: 'lists' };
  }
  if (segments.length === 1 && segments[0] === 'recomendacoes') {
    return { view: 'recommendations' };
  }
  if (segments.length === 1 && (segments[0] === 'tempo-assistido' || segments[0] === 'metricas')) {
    return { view: 'watchtime' };
  }
  if (segments.length === 2 && segments[0] === 'lista' && segments[1] === 'importar') {
    // O código é validado por decodeShare; aqui só é repassado.
    return { view: 'list-import', code: new URLSearchParams(search).get('d') ?? '' };
  }
  if (segments.length === 2 && segments[0] === 'lista' && /^[\w-]{1,40}$/.test(segments[1])) {
    return { view: 'custom-list', id: segments[1] };
  }
  if (segments.length === 1 && segments[0] === 'chave') {
    return { view: 'key' };
  }
  return { view: 'not-found' };
}

/** Link de uma listagem; valores padrão ficam de fora para a URL sair curta. */
export function listHref({
  media,
  list = 'popular',
  genre = '',
  query = '',
  page = 1,
  sort = '',
  yearFrom = '',
  yearTo = '',
}) {
  const params = new URLSearchParams();
  if (list !== 'popular') {
    params.set('lista', list);
  }
  if (genre) {
    params.set('genero', genre);
  }
  if (query) {
    params.set('q', query);
  }
  if (sort && sort !== 'popularidade') {
    params.set('ordem', sort);
  }
  if (yearFrom && /^\d{4}$/.test(String(yearFrom))) {
    params.set('ano_de', String(yearFrom));
  }
  if (yearTo && /^\d{4}$/.test(String(yearTo))) {
    params.set('ano_ate', String(yearTo));
  }
  if (page > 1) {
    params.set('pagina', String(page));
  }
  const search = params.toString();
  return `#/${media === 'tv' ? 'series' : 'filmes'}${search ? `?${search}` : ''}`;
}

export function customListHref(id) {
  return `#/lista/${id}`;
}

/** Link de importação de uma lista compartilhada; `code` vem de `encodeShare`. */
export function shareHref(code) {
  return `#/lista/importar?d=${code}`;
}

export function detailsHref(media, id) {
  return `#/${media === 'tv' ? 'serie' : 'filme'}/${id}`;
}

export function watchtimeHref() {
  return '#/tempo-assistido';
}
