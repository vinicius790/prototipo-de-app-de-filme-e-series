// Funções puras de formatação e pequenos utilitários, sem DOM.

/** Faixa de cor da nota: verde a partir de 8, laranja a partir de 5, vermelho abaixo disso. */
export function ratingClass(rating) {
  if (rating >= 8) {
    return 'nota--alta';
  }
  if (rating >= 5) {
    return 'nota--media';
  }
  return 'nota--baixa';
}

export function formatRating(rating) {
  return rating > 0 ? rating.toFixed(1).replace('.', ',') : '–';
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

export function formatDate(iso) {
  const match = ISO_DATE.exec(iso ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

export function yearOf(iso) {
  return ISO_DATE.exec(iso ?? '')?.[1] ?? '';
}

export function formatRuntime(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return '';
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${String(rest).padStart(2, '0')}min` : `${rest}min`;
}

const DOLLARS = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** O TMDB informa orçamento e receita em dólares; zero significa "não informado". */
export function formatMoney(amount) {
  return Number.isFinite(amount) && amount > 0 ? DOLLARS.format(amount) : '';
}

const STATUS = {
  Released: 'Lançado',
  'Post Production': 'Pós-produção',
  'In Production': 'Em produção',
  Planned: 'Planejado',
  Rumored: 'Rumor',
  Canceled: 'Cancelado',
  'Returning Series': 'Em exibição',
  Ended: 'Finalizada',
  Pilot: 'Piloto',
};

export function translateStatus(status) {
  return STATUS[status] ?? status ?? '';
}

/**
 * Páginas a mostrar na paginação: primeira, última e uma janela em volta da atual.
 * Buracos entre elas viram a marca `'gap'`.
 * @returns {(number|'gap')[]}
 */
export function pageRange(current, total, radius = 2) {
  if (total < 1) {
    return [];
  }
  const pages = new Set([1, total]);
  for (let page = current - radius; page <= current + radius; page += 1) {
    if (page >= 1 && page <= total) {
      pages.add(page);
    }
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const range = [];
  for (const page of sorted) {
    if (range.length > 0 && page - range.at(-1) > 1) {
      range.push('gap');
    }
    range.push(page);
  }
  return range;
}

/** Adia a chamada até passarem `delay` ms sem novas chamadas. */
export function debounce(callback, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}
