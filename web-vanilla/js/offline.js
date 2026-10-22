// Regras do modo offline, compartilhadas entre a página e o service worker (sw.js).
// Sem DOM e sem Cache API aqui, para rodar também nos testes com `node --test`.

/**
 * Prefixo dos caches desta versão. Na troca de versão só os caches com este prefixo são
 * apagados: o Cache Storage é da origem inteira e a versão Angular (`movie-app-ng-v…`) pode
 * estar servida na mesma origem.
 */
export const CACHE_PREFIX = 'movie-app-v';
export const CACHE_NAME = `${CACHE_PREFIX}1`;

/** Cabeçalho que o service worker põe nas respostas guardadas: momento da gravação, em ms. */
export const CACHED_AT_HEADER = 'x-cached-at';

/** Respostas da API valem offline por 24 horas; depois disso são apagadas em vez de mostradas. */
export const API_TTL = 24 * 60 * 60 * 1000;

/** Pôsteres não mudam: em vez de prazo, o limite é a quantidade (os mais antigos saem). */
export const MAX_IMAGES = 300;

/** Arquivos do próprio app, guardados na instalação para a página abrir sem rede. */
export const SHELL_FILES = [
  './',
  'index.html',
  'style.css',
  'manifest.json',
  'config.js',
  'js/api.js',
  'js/app.js',
  'js/backup.js',
  'js/dom.js',
  'js/format.js',
  'js/lists.js',
  'js/lru-cache.js',
  'js/offline.js',
  'js/recommend.js',
  'js/render.js',
  'js/router.js',
  'js/store.js',
  'js/watchtime.js',
];

/**
 * Decide o que fazer com uma requisição GET.
 * @returns {'shell'|'api'|'image'|null} `null`: o service worker não se mete (YouTube etc.)
 */
export function cachePolicy(requestUrl, appOrigin) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.origin === 'https://api.themoviedb.org') {
    return 'api';
  }
  if (url.origin === 'https://image.tmdb.org') {
    return 'image';
  }
  return url.origin === appOrigin ? 'shell' : null;
}

/** Sem data de gravação legível a resposta é tratada como vencida. */
export function isExpired(cachedAt, now, ttl = API_TTL) {
  const time = Number(cachedAt);
  return cachedAt === null || cachedAt === '' || !Number.isFinite(time) || now - time > ttl;
}

const DATE_TIME = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Texto do indicador de conexão; vazio quando está tudo normal (online e dados novos).
 * @param {{online: boolean, cachedAt: number|null}} state `cachedAt`: gravação do dado em tela
 */
export function offlineStatus({ online, cachedAt }) {
  const saved = Number.isFinite(cachedAt) ? ` Mostrando dados salvos em ${DATE_TIME.format(cachedAt)}.` : '';
  if (!online) {
    return `Você está offline.${saved || ' Só o que foi aberto nas últimas 24 horas está disponível.'}`;
  }
  return saved ? `Sem resposta do TMDB.${saved}` : '';
}
