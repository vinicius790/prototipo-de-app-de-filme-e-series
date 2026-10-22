import { createClient, isValidKeyFormat } from './api.js';
import { createBackupPayload, downloadBackupFile, readBackupFile } from './backup.js';
import { h } from './dom.js';
import { debounce } from './format.js';
import { createListStore, decodeShare, encodeShare } from './lists.js';
import { CACHED_AT_HEADER, offlineStatus } from './offline.js';
import {
  GENRE_LOOKUP_CONCURRENCY,
  MAX_RECOMMENDED_GENRES,
  calculateAffinityScore,
  excludeKnown,
  explain,
  frequentFavoritedGenres,
  genreProfile,
  mapLimit,
  missingGenres,
} from './recommend.js';
import {
  cinemaModal,
  customListView,
  detailsView,
  hero,
  importView,
  keyPanel,
  listsView,
  loading,
  mediaCard,
  mediaGrid,
  mediaRow,
  message,
  pagination,
  reviewList,
  toastElement,
  watchedButton,
  watchtimeView,
} from './render.js';
import { customListHref, listHref, parseRoute, shareHref, watchtimeHref } from './router.js';
import { clearApiKey, createStore, loadApiKey, saveApiKey } from './store.js';
import { createWatchTimeStore } from './watchtime.js';

const SEARCH_DELAY = 350;

const LIST_LABELS = {
  movie: { popular: 'Populares', now: 'Em cartaz', top: 'Mais bem avaliados' },
  tv: { popular: 'Populares', now: 'No ar', top: 'Mais bem avaliadas' },
};

const HOME_ROWS = [
  { title: 'Filmes em cartaz', media: 'movie', list: 'now' },
  { title: 'Filmes populares', media: 'movie', list: 'popular' },
  { title: 'Séries no ar', media: 'tv', list: 'now' },
  { title: 'Séries mais bem avaliadas', media: 'tv', list: 'top' },
];

const $ = (id) => document.getElementById(id);

const views = {
  home: $('view-home'),
  list: $('view-list'),
  details: $('view-details'),
  favorites: $('view-favorites'),
  panel: $('view-panel'),
};
const searchInput = $('busca');
const listSelect = $('filtro-lista');
const genreSelect = $('filtro-genero');
const filterHint = $('filtros-dica');
const listTitle = $('list-title');
const listResults = $('list-results');
const orderSelect = $('filtro-ordem');
const yearFromInput = $('filtro-ano-de');
const yearToInput = $('filtro-ano-ate');
const announcer = $('aviso');
const connection = $('conexao');
const toastContainer = $('toast-container');

function showToast(text, type = 'info', duration = 3500) {
  if (!toastContainer) {
    return;
  }
  const el = toastElement({ message: text, type });
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(10px)';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// Em alguns modos de privacidade o simples acesso a localStorage lança erro.
function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    const data = new Map();
    return {
      getItem: (name) => data.get(name) ?? null,
      setItem: (name, value) => data.set(name, value),
      removeItem: (name) => data.delete(name),
    };
  }
}

const storage = browserStorage();
const store = createStore(storage);
const listStore = createListStore(storage);
const watchtimeStore = createWatchTimeStore(storage);

// Data de gravação da resposta em tela, quando ela veio do cache offline (ver sw.js).
let cachedAt = null;
let key = { apiKey: '', source: 'none' };
let client = createClient();
let controller = new AbortController();
let currentRoute = { view: 'home' };
let lastScreen = '';
let activeCinemaOverlay = null;

function openCinemaMode(details) {
  if (activeCinemaOverlay) {
    closeCinemaMode();
  }
  announce('Modo Cinema ativado. Pressione Escape para sair.');
  activeCinemaOverlay = cinemaModal({
    title: details.title,
    trailer: details.trailer,
    backdropPath: details.backdropPath,
    onClose: closeCinemaMode,
  });
  document.body.appendChild(activeCinemaOverlay);
  const closeBtn = activeCinemaOverlay.querySelector('.button--close-cinema');
  if (closeBtn) {
    closeBtn.focus();
  }
}

function closeCinemaMode() {
  if (activeCinemaOverlay) {
    activeCinemaOverlay.remove();
    activeCinemaOverlay = null;
    announce('Modo Cinema encerrado.');
    const detailsTitle = $('titulo-detalhes');
    if (detailsTitle) {
      detailsTitle.focus();
    }
  }
}

const favoriteHandlers = {
  isFavorite: (item) => store.isFavorite(item.media, item.id),
  onToggleFavorite: (item) => {
    const favorite = store.toggleFavorite(item);
    announce(favorite ? `${item.title} adicionado aos favoritos.` : `${item.title} removido dos favoritos.`);
    return favorite;
  },
};

function announce(text) {
  announcer.textContent = text;
}

function updateConnection() {
  const text = offlineStatus({ online: navigator.onLine, cachedAt });
  connection.textContent = text;
  connection.hidden = text === '';
}

/** fetch que repara quando o service worker respondeu com uma cópia guardada. */
async function trackedFetch(...args) {
  const response = await fetch(...args);
  const stamp = response.headers.get(CACHED_AT_HEADER);
  if (stamp) {
    cachedAt = Number(stamp);
    updateConnection();
  }
  return response;
}

function showView(name) {
  for (const [viewName, element] of Object.entries(views)) {
    element.hidden = viewName !== name;
  }
}

function highlightNav(route) {
  const listViews = ['lists', 'custom-list', 'list-import'];
  let active = route.view;
  if (route.view === 'list' || route.view === 'details') {
    active = route.media;
  } else if (listViews.includes(route.view)) {
    active = 'lists';
  } else if (route.view === 'watchtime') {
    active = 'watchtime';
  }
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === active) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  }
}

/** Ao trocar de tela, leva o foco para o título dela (leitores de tela e teclado). */
function focusHeading(screen, heading) {
  if (screen !== lastScreen && lastScreen !== '') {
    heading?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  lastScreen = screen;
}

function errorMessage(error, retry) {
  const actions = [h('button', { type: 'button', class: 'button button--primary', onclick: retry }, 'Tentar novamente')];
  if (error.kind === 'auth') {
    actions.push(h('a', { class: 'button', href: '#/chave' }, 'Trocar a chave'));
  }
  return message({
    title: 'Algo deu errado',
    text: error.kind ? error.message : 'Ocorreu um erro inesperado ao carregar os dados.',
    actions,
    alert: true,
  });
}

function showPanel(content, screen) {
  views.panel.replaceChildren(content);
  showView('panel');
  focusHeading(screen, views.panel.querySelector('h1'));
}

function showKeyPanel(error = '') {
  document.title = 'Chave da API · Movie App';
  showPanel(
    keyPanel({
      source: key.source,
      error,
      onSave: (apiKey) => {
        if (!isValidKeyFormat(apiKey)) {
          showKeyPanel('Formato inválido. A chave v3 tem 32 caracteres hexadecimais; o token v4 começa com "eyJ".');
          $('chave').focus();
          return;
        }
        saveApiKey(storage, apiKey);
        useKey({ apiKey, source: 'browser' });
        announce('Chave salva.');
        if (currentRoute.view === 'key') {
          location.hash = '#/';
        } else {
          navigate();
        }
      },
      onRemove: () => {
        clearApiKey(storage);
        useKey({ apiKey: '', source: 'none' });
        announce('Chave removida.');
        showKeyPanel();
      },
    }),
    'key',
  );
}

function useKey(nextKey) {
  key = nextKey;
  client = createClient({ apiKey: key.apiKey, fetch: trackedFetch });
}

async function showHome(signal) {
  document.title = 'Movie App · Filmes e séries';
  const content = $('home-content');
  showView('home');
  focusHeading('home', $('home-title'));
  content.replaceChildren(loading());

  const results = await Promise.allSettled(
    HOME_ROWS.map((row) => client.list({ media: row.media, list: row.list }, signal)),
  );
  if (signal.aborted) {
    return;
  }
  const firstError = results.find((result) => result.status === 'rejected')?.reason;
  if (results.every((result) => result.status === 'rejected')) {
    content.replaceChildren(errorMessage(firstError, navigate));
    return;
  }

  const featured = results[0].status === 'fulfilled' ? results[0].value.items.find((item) => item.backdropPath) : null;
  const rows = HOME_ROWS.map((row, index) => {
    const result = results[index];
    const items = result.status === 'fulfilled' ? result.value.items.slice(0, 12) : [];
    return mediaRow({
      id: `faixa-${index}`,
      title: row.title,
      moreHref: listHref({ media: row.media, list: row.list }),
      content:
        items.length > 0
          ? h(
              'ul',
              { class: 'row__track', role: 'list' },
              items.map((item) =>
                h('li', {}, mediaCard(item, { favorite: favoriteHandlers.isFavorite(item), ...favoriteHandlers })),
              ),
            )
          : h('p', { class: 'muted' }, 'Não foi possível carregar esta lista agora.'),
    });
  });
  content.replaceChildren(...(featured ? [hero(featured, 'Em cartaz')] : []), ...rows);
}

function syncFilters(route, sameScreen) {
  const labels = LIST_LABELS[route.media];
  listSelect.replaceChildren(
    ...Object.entries(labels).map(([value, label]) => h('option', { value, selected: value === route.list }, label)),
  );
  // Não mexe no campo enquanto a pessoa digita: a rota muda a cada pausa da digitação.
  if (!sameScreen || document.activeElement !== searchInput) {
    searchInput.value = route.query;
  }
  if (orderSelect) {
    orderSelect.value = route.sort || 'popularidade';
  }
  if (!sameScreen || document.activeElement !== yearFromInput) {
    if (yearFromInput) {
      yearFromInput.value = route.yearFrom || '';
    }
  }
  if (!sameScreen || document.activeElement !== yearToInput) {
    if (yearToInput) {
      yearToInput.value = route.yearTo || '';
    }
  }
  const searching = route.query !== '';
  listSelect.disabled = searching;
  genreSelect.disabled = searching;
  filterHint.hidden = !searching;
}

function fillGenres(genres, selected) {
  genreSelect.replaceChildren(
    h('option', { value: '' }, 'Todos'),
    ...genres.map((genre) => h('option', { value: genre.id, selected: String(genre.id) === selected }, genre.name)),
  );
}

async function showList(route, signal) {
  const mediaName = route.media === 'tv' ? 'Séries' : 'Filmes';
  document.title = `${mediaName} · Movie App`;
  listTitle.textContent = mediaName;
  const screen = `list-${route.media}`;
  syncFilters(route, lastScreen === screen);
  showView('list');
  focusHeading(screen, listTitle);
  // Paginação e "tentar novamente" são removidos ao redesenhar; o foco volta para o título.
  if (listResults.contains(document.activeElement)) {
    listTitle.focus();
  }
  listResults.setAttribute('aria-busy', 'true');
  listResults.replaceChildren(loading());

  try {
    const [genres, page] = await Promise.all([client.genres(route.media), client.list(route, signal)]);
    if (signal.aborted) {
      return;
    }
    fillGenres(genres, route.genre);
    if (page.items.length === 0) {
      listResults.replaceChildren(
        message({
          title: 'Nenhum resultado',
          text: route.query
            ? `Não encontramos nada para “${route.query}”. Tente outro título.`
            : 'Não há títulos para esta combinação de filtros.',
          actions: [h('a', { class: 'button', href: listHref({ media: route.media }) }, 'Limpar filtros')],
        }),
      );
      announce('Nenhum resultado.');
    } else {
      listResults.replaceChildren(
        mediaGrid(page.items, favoriteHandlers),
        pagination(page.page, page.totalPages, (target) => listHref({ ...route, page: target })) ?? '',
      );
      announce(`${page.totalResults} resultados. Página ${page.page} de ${page.totalPages}.`);
    }
  } catch (error) {
    if (signal.aborted) {
      return;
    }
    listResults.replaceChildren(errorMessage(error, navigate));
  } finally {
    if (!signal.aborted) {
      listResults.setAttribute('aria-busy', 'false');
    }
  }
}

async function showDetails(route, signal) {
  showView('details');
  views.details.replaceChildren(loading());
  let details;
  try {
    details = await client.details(route.media, route.id, signal);
  } catch (error) {
    if (!signal.aborted) {
      document.title = 'Erro · Movie App';
      views.details.replaceChildren(errorMessage(error, navigate));
    }
    return;
  }
  if (signal.aborted) {
    return;
  }
  document.title = `${details.title} · Movie App`;

  const draw = () => {
    views.details.replaceChildren(
      detailsView(details, {
        favorite: store.isFavorite(details.media, details.id),
        review: store.review(details.media, details.id),
        onToggleFavorite: favoriteHandlers.onToggleFavorite,
        lists: listStore.lists(),
        isInList: (list) => listStore.hasItem(list.id, details.media, details.id),
        watched: watchtimeStore.isWatched(details.media, details.id),
        onToggleWatched: (item) => {
          const added = watchtimeStore.toggleWatched(item);
          announce(added ? `${item.title} marcado como assistido.` : `${item.title} removido dos assistidos.`);
          draw();
          return added;
        },
        affinity: calculateAffinityScore(details, store.favorites(), store.reviews()),
        onOpenCinema: (item) => openCinemaMode(item),
        onToggleList: (list, checked) => {
          if (checked) {
            const added = listStore.addItem(list.id, details);
            announce(added ? `${details.title} adicionado a ${list.name}.` : `${list.name} está cheia.`);
          } else {
            listStore.removeItem(list.id, details.media, details.id);
            announce(`${details.title} removido de ${list.name}.`);
          }
          draw();
          $('titulo-listas').focus();
        },
        onCreateList: (name) => {
          try {
            const list = listStore.create(name, [details]);
            announce(`Lista ${list.name} criada com ${details.title}.`);
          } catch (error) {
            announce(error.message);
          }
          draw();
          $('titulo-listas').focus();
        },
        onSaveReview: ({ rating, text }) => {
          const { media, id, title, genreIds } = details;
          store.saveReview({ media, id, title, rating, text, genreIds });
          draw();
          $('titulo-avaliacao').focus();
          announce('Avaliação salva.');
        },
        onRemoveReview: () => {
          store.removeReview(details.media, details.id);
          draw();
          $('titulo-avaliacao').focus();
          announce('Avaliação removida.');
        },
      }),
    );
  };
  draw();
  focusHeading(`details-${route.media}-${route.id}`, $('titulo-detalhes'));
}

function showFavorites() {
  document.title = 'Favoritos · Movie App';
  const favorites = store.favorites();
  const reviews = store.reviews();
  const content = $('favorites-content');
  content.replaceChildren(
    favorites.length > 0
      ? mediaGrid(favorites, {
          isFavorite: () => true,
          onToggleFavorite: (item) => {
            const favorite = favoriteHandlers.onToggleFavorite(item);
            showFavorites();
            $('favorites-title').focus();
            return favorite;
          },
        })
      : message({
          title: 'Nenhum favorito ainda',
          text: 'Use o coração nos cartões de filmes e séries para guardá-los aqui.',
          actions: [h('a', { class: 'button button--primary', href: '#/filmes' }, 'Explorar filmes')],
        }),
    h('h2', {}, 'Minhas avaliações'),
    reviews.length > 0
      ? reviewList(reviews, {
          onRemove: (review) => {
            store.removeReview(review.media, review.id);
            announce('Avaliação removida.');
            showFavorites();
            $('favorites-title').focus();
          },
        })
      : h('p', { class: 'muted' }, 'Você ainda não avaliou nenhum título. A avaliação fica na página de detalhes.'),
  );
  showView('favorites');
  focusHeading('favorites', $('favorites-title'));
}

function showNotFound() {
  document.title = 'Página não encontrada · Movie App';
  showPanel(
    h(
      'div',
      { class: 'panel' },
      h('h1', { tabindex: -1 }, 'Página não encontrada'),
      h('p', {}, 'O endereço aberto não corresponde a nenhuma tela do app.'),
      h('p', { class: 'actions' }, h('a', { class: 'button button--primary', href: '#/' }, 'Ir para o início')),
    ),
    'not-found',
  );
}

function showLists(error = '') {
  document.title = 'Minhas listas · Movie App';
  showPanel(
    listsView(listStore.lists(), {
      error,
      onCreate: (name) => {
        try {
          const list = listStore.create(name);
          announce(`Lista ${list.name} criada.`);
          location.hash = customListHref(list.id);
        } catch (failure) {
          showLists(failure.message);
          $('nome-lista').focus();
        }
      },
      onExportBackup: () => {
        const payload = createBackupPayload({
          favorites: store.favorites(),
          reviews: store.reviews(),
          lists: listStore.lists(),
          watchtime: watchtimeStore.items(),
        });
        downloadBackupFile(payload);
        showToast('Backup exportado com sucesso!', 'success');
      },
      onImportBackup: async (file) => {
        const result = await readBackupFile(file);
        if (!result.valid) {
          showToast(result.error || 'Erro ao importar backup.', 'error');
          showLists(result.error);
          return;
        }
        store.importFavorites(result.data.favorites);
        store.importReviews(result.data.reviews);
        listStore.importLists(result.data.lists);
        if (Array.isArray(result.data.watchtime)) {
          watchtimeStore.importItems(result.data.watchtime);
        }
        showToast(
          `Backup restaurado com sucesso! (${result.data.favorites.length} favoritos, ${result.data.lists.length} listas)`,
          'success',
        );
        showLists();
      },
    }),
    'lists',
  );
}

function showCustomList(id, error = '') {
  const list = listStore.get(id);
  if (!list) {
    showNotFound();
    return;
  }
  document.title = `${list.name} · Movie App`;
  /** Redesenha e devolve o foco: ao botão de mesmo rótulo, se ainda existir, ou ao título. */
  const redraw = (text, label = '') => {
    showCustomList(id);
    const button = [...views.panel.querySelectorAll('.list-tools button')].find(
      (candidate) => candidate.getAttribute('aria-label') === label && !candidate.disabled,
    );
    (button ?? $('titulo-lista')).focus();
    announce(text);
  };
  // A compressão do link é assíncrona: o campo é preenchido assim que o código fica pronto.
  const shareUrl = encodeShare(list).then((code) => location.href.split('#')[0] + shareHref(code));

  showPanel(
    customListView(list, {
      shareUrl: '',
      error,
      isFavorite: favoriteHandlers.isFavorite,
      onToggleFavorite: favoriteHandlers.onToggleFavorite,
      onRename: (name) => {
        try {
          listStore.rename(id, name);
          redraw('Lista renomeada.');
        } catch (failure) {
          showCustomList(id, failure.message);
          $('renomear-lista').focus();
        }
      },
      onDelete: () => {
        if (window.confirm(`Excluir a lista “${list.name}”? Os títulos continuam nos favoritos e no catálogo.`)) {
          listStore.remove(id);
          announce('Lista excluída.');
          location.hash = '#/listas';
        }
      },
      onCopyLink: async (event) => {
        const button = event.currentTarget;
        try {
          await navigator.clipboard.writeText(await shareUrl);
          button.textContent = 'Link copiado';
          announce('Link copiado.');
        } catch {
          // Sem permissão ou sem a API de área de transferência: deixa o link selecionado para Ctrl+C.
          $('link-lista').select();
          announce('Não foi possível copiar sozinho. O link está selecionado: copie com Ctrl+C.');
        }
      },
      onMove: (from, to) => {
        const item = list.items[from];
        if (listStore.moveItem(id, from, to)) {
          const direction = to < from ? 'cima' : 'baixo';
          redraw(
            `${item.title} agora é o ${to + 1}º de ${list.items.length}.`,
            `Mover ${item.title} para ${direction}`,
          );
        }
      },
      onRemoveItem: (item) => {
        listStore.removeItem(id, item.media, item.id);
        redraw(`${item.title} removido da lista.`);
      },
    }),
    `custom-list-${id}`,
  );
  // Guarda o campo desta renderização: se a tela for redesenhada antes, o campo antigo já saiu.
  const linkInput = $('link-lista');
  shareUrl.then((url) => {
    linkInput.value = url;
  });
}

async function showImport(code, signal) {
  document.title = 'Importar lista · Movie App';
  showPanel(loading(), 'list-import-loading');
  const shared = await decodeShare(code);
  if (signal.aborted) {
    return;
  }
  showPanel(
    importView(shared, {
      onImport: () => {
        try {
          const list = listStore.create(shared.name, shared.items);
          announce(`Lista ${list.name} salva.`);
          // replace: voltar no histórico não deve reabrir a tela de importação.
          location.replace(customListHref(list.id));
        } catch (failure) {
          showPanel(
            h(
              'div',
              { class: 'panel' },
              h('h1', { tabindex: -1 }, 'Não foi possível importar'),
              h('p', { role: 'alert' }, failure.message),
              h('p', { class: 'actions' }, h('a', { class: 'button', href: '#/listas' }, 'Ver as minhas listas')),
            ),
            'list-import-error',
          );
        }
      },
    }),
    'list-import',
  );
}

/**
 * Favoritos e avaliações gravados antes da versão 1.1 não têm gêneros: busca os detalhes de cada
 * um no TMDB (no máximo GENRE_LOOKUP_CONCURRENCY ao mesmo tempo) e regrava. Título sem gênero, ou
 * que não existe mais no TMDB, é gravado com `[]` e não é buscado de novo. Falha de rede não grava
 * nada: o título é buscado de novo na próxima visita.
 */
async function completeGenres(signal) {
  const missing = missingGenres(store.favorites(), store.reviews());
  await mapLimit(missing, GENRE_LOOKUP_CONCURRENCY, async ({ media, id }) => {
    if (signal.aborted) {
      return;
    }
    try {
      const details = await client.details(media, id, signal);
      store.fillGenres(media, id, details.genreIds);
    } catch (error) {
      if (error?.kind === 'not-found') {
        store.fillGenres(media, id, []);
      }
    }
  });
}

async function showRecommendations(signal) {
  document.title = 'Para você · Movie App';
  const heading = h('h1', { tabindex: -1 }, 'Para você');
  const intro = h(
    'p',
    { class: 'muted', hidden: true },
    'Sugestões calculadas neste navegador a partir dos gêneros dos seus favoritos e das suas avaliações.',
  );
  const content = h('div', { 'aria-busy': 'true' }, loading());
  showPanel(h('div', {}, heading, intro, content), 'recommendations');

  await completeGenres(signal);
  if (signal.aborted) {
    return;
  }
  const favorites = store.favorites();
  const reviews = store.reviews();
  const profile = genreProfile(favorites, reviews).slice(0, MAX_RECOMMENDED_GENRES);
  if (profile.length === 0) {
    content.setAttribute('aria-busy', 'false');
    content.replaceChildren(
      message({
        title: 'Ainda não há recomendações',
        text: 'Favorite alguns títulos, ou avalie com 4 ou 5 estrelas, para receber sugestões dos gêneros de que você mais gosta.',
        actions: [h('a', { class: 'button button--primary', href: '#/filmes' }, 'Explorar filmes')],
      }),
    );
    return;
  }
  intro.hidden = false;

  const results = await Promise.allSettled(
    profile.map(async (genre) => {
      const [genres, page] = await Promise.all([
        client.genres(genre.media),
        client.list({ media: genre.media, genre: String(genre.genreId) }, signal),
      ]);
      return {
        name: genres.find((entry) => entry.id === genre.genreId)?.name ?? 'Gênero',
        items: excludeKnown(page.items, favorites, reviews),
      };
    }),
  );
  if (signal.aborted) {
    return;
  }
  content.setAttribute('aria-busy', 'false');
  if (results.every((result) => result.status === 'rejected')) {
    content.replaceChildren(errorMessage(results[0].reason, navigate));
    return;
  }
  const rows = profile.flatMap((genre, index) => {
    const result = results[index];
    if (result.status !== 'fulfilled' || result.value.items.length === 0) {
      return [];
    }
    return mediaRow({
      id: `recomendacao-${index}`,
      title: `${result.value.name} · ${genre.media === 'tv' ? 'Séries' : 'Filmes'}`,
      subtitle: explain(genre.because),
      moreHref: listHref({ media: genre.media, genre: String(genre.genreId) }),
      content: h(
        'ul',
        { class: 'row__track', role: 'list' },
        result.value.items.map((item) =>
          h('li', {}, mediaCard(item, { favorite: favoriteHandlers.isFavorite(item), ...favoriteHandlers })),
        ),
      ),
    });
  });

  const frequent = frequentFavoritedGenres(favorites);
  let chips = null;
  if (frequent.length > 0) {
    const movieGenres = await client.genres('movie').catch(() => []);
    const tvGenres = await client.genres('tv').catch(() => []);
    const genreMap = new Map([...movieGenres, ...tvGenres].map((g) => [g.id, g.name]));
    chips = h(
      'div',
      {},
      h('h2', { class: 'sr-only' }, 'Gêneros mais frequentes'),
      h(
        'ul',
        { class: 'genre-chips', role: 'list', 'aria-label': 'Gêneros mais frequentes favoritados' },
        frequent.slice(0, 6).map((g) =>
          h(
            'li',
            { class: 'genre-chip' },
            h('span', {}, genreMap.get(g.genreId) || `Gênero ${g.genreId}`),
            h('strong', {}, `${Math.round(g.frequency * 100)}%`),
          ),
        ),
      ),
    );
  }

  content.replaceChildren(
    ...(chips ? [chips] : []),
    ...(rows.length > 0
      ? rows
      : [
          message({
            title: 'Nada novo por enquanto',
            text: 'Você já favoritou ou avaliou tudo o que apareceu nos seus gêneros preferidos.',
          }),
        ]),
  );
  announce(`${rows.length} faixas de recomendação.`);
}

async function showWatchTime() {
  document.title = 'Tempo assistido e métricas · Movie App';
  const movieGenres = await client.genres('movie').catch(() => []);
  const tvGenres = await client.genres('tv').catch(() => []);
  const genreMap = new Map([...movieGenres, ...tvGenres].map((g) => [g.id, g.name]));

  const redraw = () => {
    const stats = watchtimeStore.stats();
    const items = watchtimeStore.items();
    showPanel(
      watchtimeView(stats, items, {
        genreNames: genreMap,
        onUnmarkWatched: (item) => {
          watchtimeStore.unmarkWatched(item.media, item.id);
          announce(`${item.title} removido dos assistidos.`);
          redraw();
          const heading = $('titulo-watchtime');
          if (heading) {
            heading.focus();
          }
        },
        onExportBackup: () => {
          const payload = createBackupPayload({
            favorites: store.favorites(),
            reviews: store.reviews(),
            lists: listStore.lists(),
            watchtime: watchtimeStore.items(),
          });
          downloadBackupFile(payload);
          showToast('Backup com tempo assistido exportado com sucesso!', 'success');
        },
        onImportBackup: async (file) => {
          const result = await readBackupFile(file);
          if (!result.valid) {
            showToast(result.error || 'Erro ao importar backup.', 'error');
            return;
          }
          store.importFavorites(result.data.favorites);
          store.importReviews(result.data.reviews);
          listStore.importLists(result.data.lists);
          if (Array.isArray(result.data.watchtime)) {
            watchtimeStore.importItems(result.data.watchtime);
          }
          showToast('Backup restaurado com sucesso!', 'success');
          redraw();
        },
      }),
      'watchtime',
    );
  };
  redraw();
}

function navigate() {
  controller.abort();
  controller = new AbortController();
  const { signal } = controller;
  currentRoute = parseRoute(location.hash);
  highlightNav(currentRoute);
  cachedAt = null;
  updateConnection();

  if (currentRoute.view === 'favorites') {
    showFavorites();
  } else if (currentRoute.view === 'lists') {
    showLists();
  } else if (currentRoute.view === 'watchtime') {
    showWatchTime();
  } else if (currentRoute.view === 'custom-list') {
    showCustomList(currentRoute.id);
  } else if (currentRoute.view === 'list-import') {
    showImport(currentRoute.code, signal);
  } else if (currentRoute.view === 'not-found') {
    showNotFound();
  } else if (currentRoute.view === 'key' || !client.hasKey) {
    showKeyPanel();
  } else if (currentRoute.view === 'recommendations') {
    showRecommendations(signal);
  } else if (currentRoute.view === 'home') {
    showHome(signal);
  } else if (currentRoute.view === 'list') {
    showList(currentRoute, signal);
  } else {
    showDetails(currentRoute, signal);
  }
}

/** Aplica um filtro mantendo os demais; qualquer mudança volta para a página 1. */
function updateList(changes, { replace = false } = {}) {
  if (currentRoute.view !== 'list') {
    return;
  }
  const href = listHref({ ...currentRoute, ...changes, page: 1 });
  if (replace) {
    location.replace(href);
  } else {
    location.hash = href;
  }
}

function bindEvents() {
  const search = debounce(() => updateList({ query: searchInput.value.trim() }, { replace: true }), SEARCH_DELAY);
  searchInput.addEventListener('input', search);
  $('filtros').addEventListener('submit', (event) => {
    event.preventDefault();
    updateList({ query: searchInput.value.trim() });
  });
  listSelect.addEventListener('change', () => updateList({ list: listSelect.value }));
  genreSelect.addEventListener('change', () => updateList({ genre: genreSelect.value }));

  if (orderSelect) {
    orderSelect.addEventListener('change', () =>
      updateList({ sort: orderSelect.value === 'popularidade' ? '' : orderSelect.value }),
    );
  }
  if (yearFromInput) {
    yearFromInput.addEventListener(
      'input',
      debounce(() => updateList({ yearFrom: yearFromInput.value.trim() }), SEARCH_DELAY),
    );
  }
  if (yearToInput) {
    yearToInput.addEventListener(
      'input',
      debounce(() => updateList({ yearTo: yearToInput.value.trim() }), SEARCH_DELAY),
    );
  }

  // O link "pular para o conteúdo" não pode trocar o hash, que é usado como rota.
  $('pular').addEventListener('click', (event) => {
    event.preventDefault();
    $('conteudo').focus();
  });
  window.addEventListener('hashchange', navigate);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && activeCinemaOverlay) {
      event.preventDefault();
      closeCinemaMode();
    }
  });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    showToast('App disponível para instalação no seu dispositivo (PWA)!', 'info', 6000);
  });
  window.addEventListener('online', () => {
    updateConnection();
    showToast('Conexão restabelecida! Você está online novamente.', 'online', 3500);
  });
  window.addEventListener('offline', () => {
    updateConnection();
    showToast('Você está offline. O catálogo em cache continuará acessível.', 'offline', 5000);
  });
}

/** Modo offline: o service worker guarda o app, as últimas respostas e os pôsteres vistos. */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    // Falha de registro (navegador antigo, contexto inseguro) só desliga o modo offline.
    navigator.serviceWorker.register('sw.js', { type: 'module' }).catch(() => {});
  }
}

async function start() {
  useKey(await loadApiKey(storage, () => import('../config.js')));
  bindEvents();
  navigate();
  registerServiceWorker();
}

start();
