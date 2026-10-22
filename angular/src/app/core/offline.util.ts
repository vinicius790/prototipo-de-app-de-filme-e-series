// Regras puras do modo offline. O cache em si é feito pelo service worker (`public/sw.js`),
// que guarda as últimas respostas do TMDB e os pôsteres vistos; aqui fica o que a tela usa.

/** Cabeçalho que o service worker põe nas respostas guardadas: momento da gravação, em ms. */
export const CACHED_AT_HEADER = 'x-cached-at';

/** Respostas da API valem offline por 24 horas (o mesmo prazo está em `public/sw.js`). */
export const API_TTL = 24 * 60 * 60 * 1000;

/** Sem data de gravação legível a resposta é tratada como vencida. */
export function isExpired(cachedAt: unknown, now: number, ttl = API_TTL): boolean {
  const time = Number(cachedAt);
  return cachedAt === null || cachedAt === '' || !Number.isFinite(time) || now - time > ttl;
}

const DATE_TIME = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Texto do indicador de conexão; vazio quando está tudo normal (online e dados novos).
 * `cachedAt` é a data de gravação do dado em tela, quando ele veio do cache.
 */
export function offlineStatus(state: { online: boolean; cachedAt: number | null }): string {
  const { online, cachedAt } = state;
  const saved =
    cachedAt !== null && Number.isFinite(cachedAt)
      ? ` Mostrando dados salvos em ${DATE_TIME.format(cachedAt)}.`
      : '';
  if (!online) {
    return `Você está offline.${saved || ' Só o que foi aberto nas últimas 24 horas está disponível.'}`;
  }
  return saved ? `Sem resposta do TMDB.${saved}` : '';
}
