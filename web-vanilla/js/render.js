// Monta os blocos de interface a partir de dados já normalizados.
// Cada função devolve um elemento pronto; quem decide onde colocá-lo é o app.js.

import { imageUrl } from './api.js';
import { h } from './dom.js';
import {
  formatDate,
  formatMoney,
  formatRating,
  formatRuntime,
  pageRange,
  ratingClass,
  translateStatus,
  yearOf,
} from './format.js';
import { MAX_LIST_NAME } from './lists.js';
import { customListHref, detailsHref } from './router.js';
import { MAX_REVIEW_LENGTH } from './store.js';

const mediaLabel = (media) => (media === 'tv' ? 'Série' : 'Filme');

export function loading(label = 'Carregando…') {
  return h(
    'div',
    { class: 'state', role: 'status' },
    h('span', { class: 'spinner', 'aria-hidden': 'true' }),
    h('p', {}, label),
  );
}

/** Mensagem de estado vazio ou de erro, com ações opcionais (botões ou links). */
export function message({ title, text, actions = [], alert = false }) {
  return h(
    'div',
    { class: 'state', role: alert ? 'alert' : null },
    h('h2', {}, title),
    text && h('p', {}, text),
    actions.length > 0 && h('p', { class: 'actions' }, actions),
  );
}

function ratingBadge(rating) {
  return h(
    'span',
    { class: `nota ${ratingClass(rating)}` },
    h('span', { class: 'sr-only' }, 'Nota '),
    formatRating(rating),
  );
}

/**
 * Botão de alternância de favorito. `onToggle` devolve o novo estado,
 * que é refletido em `aria-pressed` sem redesenhar o card.
 */
export function favoriteButton(item, favorite, onToggle, { withText = false } = {}) {
  const button = h(
    'button',
    {
      type: 'button',
      class: withText ? 'fav fav--text button' : 'fav',
      'aria-pressed': String(favorite),
      'aria-label': withText ? null : `Favorito: ${item.title}`,
      onclick: () => button.setAttribute('aria-pressed', String(onToggle(item))),
    },
    h('span', { class: 'fav__icon', 'aria-hidden': 'true' }),
    withText && 'Favorito',
  );
  return button;
}

/**
 * Botão de alternância de assistido.
 */
export function watchedButton(item, watched, onToggle, { withText = false } = {}) {
  const button = h(
    'button',
    {
      type: 'button',
      class: withText ? 'watched-btn watched-btn--text button' : 'watched-btn',
      'aria-pressed': String(watched),
      'aria-label': withText ? null : `Assistido: ${item.title}`,
      onclick: () => button.setAttribute('aria-pressed', String(onToggle(item))),
    },
    h('span', { class: 'watched-btn__icon', 'aria-hidden': 'true' }),
    withText && (watched ? 'Assistido ✓' : 'Marcar como assistido'),
  );
  return button;
}

export function mediaCard(item, { favorite = false, onToggleFavorite, affinity = null }) {
  const poster = imageUrl(item.posterPath, 'w342');
  const year = yearOf(item.date);
  return h(
    'article',
    { class: 'card' },
    h(
      'a',
      { class: 'card__link', href: detailsHref(item.media, item.id) },
      // alt vazio: o título logo abaixo já nomeia o link.
      poster
        ? h('img', {
            class: 'card__poster',
            src: poster,
            alt: '',
            loading: 'lazy',
            decoding: 'async',
            width: 342,
            height: 513,
          })
        : h('span', { class: 'card__poster card__poster--empty', 'aria-hidden': 'true' }, 'Sem imagem'),
      h('span', { class: 'card__title' }, item.title),
    ),
    h(
      'p',
      { class: 'card__meta' },
      ratingBadge(item.rating),
      affinity && h('span', { class: 'card__affinity', title: affinity.label }, `★ ${affinity.score}%`),
      h('span', {}, year ? `${mediaLabel(item.media)} · ${year}` : mediaLabel(item.media)),
    ),
    favoriteButton(item, favorite, onToggleFavorite),
  );
}

export function mediaGrid(items, { isFavorite, onToggleFavorite }) {
  return h(
    'ul',
    { class: 'grid', role: 'list' },
    items.map((item) =>
      h('li', {}, mediaCard(item, { favorite: isFavorite(item), onToggleFavorite })),
    ),
  );
}

/** Faixa horizontal da página inicial e das recomendações (`subtitle` explica a recomendação). */
export function mediaRow({ id, title, moreHref, content, subtitle = '' }) {
  return h(
    'section',
    { class: 'row', 'aria-labelledby': id },
    h(
      'div',
      { class: 'row__head' },
      h('h2', { id }, title),
      h('a', { href: moreHref, 'aria-label': `Ver todos: ${title}` }, 'Ver todos'),
    ),
    subtitle && h('p', { class: 'muted row__why' }, subtitle),
    content,
  );
}

export function hero(item, eyebrow) {
  const backdrop = imageUrl(item.backdropPath, 'w1280');
  return h(
    'section',
    { class: 'hero', 'aria-label': 'Destaque' },
    backdrop && h('img', { class: 'hero__image', src: backdrop, alt: '' }),
    h(
      'div',
      { class: 'hero__body' },
      h('p', { class: 'eyebrow' }, eyebrow),
      h('h2', { class: 'hero__title' }, item.title),
      item.overview && h('p', { class: 'hero__overview' }, item.overview),
      h(
        'a',
        { class: 'button button--primary', href: detailsHref(item.media, item.id) },
        'Ver detalhes',
      ),
    ),
  );
}

export function pagination(page, totalPages, hrefFor) {
  if (totalPages <= 1) {
    return null;
  }
  const step = (target, label, enabled) =>
    enabled
      ? h('a', { class: 'page', href: hrefFor(target) }, label)
      : h('span', { class: 'page page--disabled', 'aria-disabled': 'true' }, label);
  return h(
    'nav',
    { class: 'pagination', 'aria-label': 'Paginação' },
    h(
      'ul',
      { role: 'list' },
      h('li', {}, step(page - 1, '‹ Anterior', page > 1)),
      pageRange(page, totalPages).map((entry) =>
        entry === 'gap'
          ? h('li', { 'aria-hidden': 'true' }, h('span', { class: 'page page--gap' }, '…'))
          : h(
              'li',
              {},
              h(
                'a',
                {
                  class: 'page',
                  href: hrefFor(entry),
                  'aria-label': `Página ${entry}`,
                  'aria-current': entry === page ? 'page' : null,
                },
                entry,
              ),
            ),
      ),
      h('li', {}, step(page + 1, 'Próxima ›', page < totalPages)),
    ),
  );
}

function trailerSection(trailer, onOpenCinema = null) {
  if (!trailer) {
    return null;
  }
  // O player só é carregado depois do clique: nada do YouTube é baixado antes disso.
  const player = h('div', { class: 'trailer' });
  player.append(
    h(
      'button',
      {
        type: 'button',
        class: 'button button--primary',
        onclick: () =>
          player.replaceChildren(
            h('iframe', {
              class: 'trailer__frame',
              src: `https://www.youtube-nocookie.com/embed/${trailer.key}?autoplay=1`,
              title: `Trailer: ${trailer.name}`,
              allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
              referrerpolicy: 'strict-origin-when-cross-origin',
            }),
          ),
      },
      '▶ Assistir ao trailer',
    ),
  );
  return h(
    'section',
    { class: 'block', 'aria-labelledby': 'titulo-trailer' },
    h('h2', { id: 'titulo-trailer' }, 'Trailer'),
    player,
    h(
      'p',
      { class: 'actions' },
      onOpenCinema &&
        h('button', { type: 'button', class: 'button button--cinema', onclick: onOpenCinema }, '🎬 Modo Cinema'),
      h(
        'a',
        {
          class: 'button',
          href: `https://www.youtube.com/watch?v=${trailer.key}`,
          target: '_blank',
          rel: 'noopener noreferrer',
        },
        'Abrir no YouTube (nova aba)',
      ),
    ),
  );
}

function castSection(cast) {
  if (cast.length === 0) {
    return null;
  }
  return h(
    'section',
    { class: 'block', 'aria-labelledby': 'titulo-elenco' },
    h('h2', { id: 'titulo-elenco' }, 'Elenco'),
    h(
      'ul',
      { class: 'cast', role: 'list' },
      cast.map((person) => {
        const photo = imageUrl(person.profilePath, 'w185');
        return h(
          'li',
          { class: 'cast__person' },
          photo
            ? h('img', {
                class: 'cast__photo',
                src: photo,
                alt: '',
                loading: 'lazy',
                width: 185,
                height: 278,
              })
            : h('span', { class: 'cast__photo cast__photo--empty', 'aria-hidden': 'true' }, '?'),
          h('strong', {}, person.name),
          person.character && h('span', { class: 'muted' }, person.character),
        );
      }),
    ),
  );
}

function reviewSection(review, { onSaveReview, onRemoveReview }) {
  const form = h(
    'form',
    {
      class: 'review-form',
      onsubmit: (event) => {
        event.preventDefault();
        const data = new FormData(form);
        onSaveReview({ rating: Number(data.get('nota')), text: String(data.get('comentario') ?? '') });
      },
    },
    h(
      'fieldset',
      { class: 'stars' },
      h('legend', {}, 'Sua nota'),
      [1, 2, 3, 4, 5].map((value) =>
        h(
          'label',
          { class: 'stars__option' },
          h('input', {
            type: 'radio',
            name: 'nota',
            value,
            required: true,
            checked: review?.rating === value,
          }),
          value,
          h('span', { 'aria-hidden': 'true' }, ' ★'),
        ),
      ),
    ),
    h('label', { for: 'comentario' }, 'Comentário (opcional)'),
    h(
      'textarea',
      { id: 'comentario', name: 'comentario', rows: 4, maxlength: MAX_REVIEW_LENGTH },
      review?.text ?? '',
    ),
    h(
      'p',
      { class: 'actions' },
      h(
        'button',
        { type: 'submit', class: 'button button--primary' },
        review ? 'Atualizar avaliação' : 'Salvar avaliação',
      ),
      review &&
        h('button', { type: 'button', class: 'button', onclick: onRemoveReview }, 'Remover avaliação'),
    ),
  );
  return h(
    'section',
    { class: 'block', 'aria-labelledby': 'titulo-avaliacao' },
    h('h2', { id: 'titulo-avaliacao', tabindex: -1 }, 'Sua avaliação'),
    h('p', { class: 'muted' }, 'Fica salva apenas neste navegador.'),
    form,
  );
}

export function detailsView(
  details,
  {
    favorite,
    review,
    onToggleFavorite,
    onSaveReview,
    onRemoveReview,
    lists = [],
    isInList,
    onToggleList,
    onCreateList,
    watched = false,
    onToggleWatched = null,
    onOpenCinema = null,
    affinity = null,
  },
) {
  const poster = imageUrl(details.posterPath, 'w500');
  const backdrop = imageUrl(details.backdropPath, 'w1280');
  const facts = [
    ['Lançamento', formatDate(details.date)],
    ['Duração', formatRuntime(details.runtime)],
    ['Temporadas', details.seasons || ''],
    ['Episódios', details.episodes || ''],
    ['Situação', translateStatus(details.status)],
    ['Orçamento', formatMoney(details.budget)],
    ['Receita', formatMoney(details.revenue)],
  ].filter(([, value]) => value !== '');

  const cinemaHandler = onOpenCinema ? () => onOpenCinema(details) : null;

  return h(
    'article',
    { class: 'details' },
    backdrop && h('img', { class: 'details__backdrop', src: backdrop, alt: '' }),
    h(
      'div',
      { class: 'details__main' },
      poster
        ? h('img', {
            class: 'details__poster',
            src: poster,
            alt: `Pôster de ${details.title}`,
            width: 500,
            height: 750,
          })
        : h('span', { class: 'details__poster card__poster--empty', 'aria-hidden': 'true' }, 'Sem imagem'),
      h(
        'div',
        { class: 'details__info' },
        h('p', { class: 'eyebrow' }, mediaLabel(details.media)),
        h('h1', { id: 'titulo-detalhes', tabindex: -1 }, details.title),
        details.tagline && h('p', { class: 'details__tagline' }, details.tagline),
        h(
          'p',
          { class: 'details__meta' },
          ratingBadge(details.rating),
          affinity && h('span', { class: 'chip chip--affinity' }, `★ ${affinity.label}`),
          details.genres.map((genre) => h('span', { class: 'chip' }, genre)),
        ),
        h('p', {}, details.overview || 'Sinopse não disponível em português.'),
        h(
          'dl',
          { class: 'facts' },
          facts.map(([name, value]) => h('div', {}, h('dt', {}, name), h('dd', {}, value))),
        ),
        h(
          'p',
          { class: 'actions' },
          favoriteButton(details, favorite, onToggleFavorite, { withText: true }),
          onToggleWatched && watchedButton(details, watched, onToggleWatched, { withText: true }),
          cinemaHandler &&
            h('button', { type: 'button', class: 'button button--cinema', onclick: cinemaHandler }, '🎬 Modo Cinema'),
          details.homepage &&
            h(
              'a',
              { class: 'button', href: details.homepage, target: '_blank', rel: 'noopener noreferrer' },
              'Site oficial (nova aba)',
            ),
        ),
      ),
    ),
    trailerSection(details.trailer, cinemaHandler),
    castSection(details.cast),
    onToggleList && listsSection(lists, { isInList, onToggleList, onCreateList }),
    reviewSection(review, { onSaveReview, onRemoveReview }),
  );
}

/** Lista "Minhas avaliações" da tela de favoritos. */
export function reviewList(reviews, { onRemove }) {
  return h(
    'ul',
    { class: 'reviews', role: 'list' },
    reviews.map((review) =>
      h(
        'li',
        { class: 'review' },
        h(
          'p',
          { class: 'review__head' },
          h('a', { href: detailsHref(review.media, review.id) }, review.title),
          h(
            'span',
            { class: 'review__stars' },
            h('span', { 'aria-hidden': 'true' }, '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating)),
            h('span', { class: 'sr-only' }, `Nota ${review.rating} de 5`),
          ),
        ),
        review.text && h('p', {}, review.text),
        h(
          'p',
          { class: 'actions' },
          h('span', { class: 'muted' }, formatDate(review.updatedAt)),
          h(
            'button',
            {
              type: 'button',
              class: 'button',
              'aria-label': `Remover avaliação de ${review.title}`,
              onclick: () => onRemove(review),
            },
            'Remover',
          ),
        ),
      ),
    ),
  );
}

/** Tela de configuração da chave: é também o estado "sem chave" do app. */
export function keyPanel({ source, error = '', onSave, onRemove }) {
  const form = h(
    'form',
    {
      class: 'key-form',
      onsubmit: (event) => {
        event.preventDefault();
        onSave(String(new FormData(form).get('chave') ?? '').trim());
      },
    },
    h('label', { for: 'chave' }, 'Chave da API (v3) ou token de leitura (v4)'),
    h('input', {
      id: 'chave',
      name: 'chave',
      type: 'password',
      required: true,
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-describedby': 'chave-ajuda',
    }),
    h(
      'p',
      { id: 'chave-ajuda', class: 'muted' },
      'A chave fica salva só neste navegador (localStorage) e é enviada apenas ao TMDB.',
    ),
    error && h('p', { class: 'error', role: 'alert' }, error),
    h(
      'p',
      { class: 'actions' },
      h('button', { type: 'submit', class: 'button button--primary' }, 'Salvar chave'),
      source === 'browser' &&
        h('button', { type: 'button', class: 'button', onclick: onRemove }, 'Remover chave salva'),
    ),
  );

  const status = {
    none: 'Nenhuma chave configurada. Sem ela o app não consegue buscar filmes e séries.',
    browser: 'Há uma chave salva neste navegador. Você pode substituí-la ou removê-la.',
    file: 'A chave em uso vem do arquivo config.js. Para trocá-la, edite esse arquivo.',
  }[source];

  return h(
    'div',
    { class: 'panel' },
    h('h1', { id: 'titulo-chave', tabindex: -1 }, 'Configurar a chave do TMDB'),
    h('p', { class: 'panel__status' }, status),
    h(
      'ol',
      {},
      h(
        'li',
        {},
        'Crie uma conta gratuita em ',
        h(
          'a',
          { href: 'https://www.themoviedb.org/signup', target: '_blank', rel: 'noopener noreferrer' },
          'themoviedb.org',
        ),
        '.',
      ),
      h(
        'li',
        {},
        'Em ',
        h(
          'a',
          {
            href: 'https://www.themoviedb.org/settings/api',
            target: '_blank',
            rel: 'noopener noreferrer',
          },
          'Configurações › API',
        ),
        ', solicite uma chave de desenvolvedor.',
      ),
      h(
        'li',
        {},
        'Cole a chave abaixo, ou copie ',
        h('code', {}, 'config.example.js'),
        ' para ',
        h('code', {}, 'config.js'),
        ' e preencha ',
        h('code', {}, 'apiKey'),
        '.',
      ),
    ),
    source !== 'file' && form,
  );
}

// ---- Listas personalizadas ----

const countLabel = (count) => (count === 1 ? '1 título' : `${count} títulos`);

/** Formulário de um campo só (nome de lista). `onSubmit` recebe o texto digitado. */
function nameForm({ id, label, button, value = '', onSubmit, error = '' }) {
  const input = h('input', {
    id,
    name: 'nome',
    type: 'text',
    required: true,
    maxlength: MAX_LIST_NAME,
    autocomplete: 'off',
    value,
    'aria-describedby': error ? `${id}-erro` : null,
  });
  return h(
    'form',
    {
      class: 'inline-form',
      onsubmit: (event) => {
        event.preventDefault();
        onSubmit(String(input.value ?? ''));
      },
    },
    h('label', { for: id }, label),
    input,
    h('button', { type: 'submit', class: 'button' }, button),
    error && h('p', { id: `${id}-erro`, class: 'error', role: 'alert' }, error),
  );
}

/** Bloco "Minhas listas" da página de detalhes: uma caixa de seleção por lista e criação rápida. */
function listsSection(lists, { isInList, onToggleList, onCreateList }) {
  return h(
    'section',
    { class: 'block', 'aria-labelledby': 'titulo-listas' },
    h('h2', { id: 'titulo-listas', tabindex: -1 }, 'Minhas listas'),
    lists.length > 0
      ? h(
          'fieldset',
          { class: 'checks' },
          h('legend', {}, 'Este título está em'),
          lists.map((list) =>
            h(
              'label',
              { class: 'checks__option' },
              h('input', {
                type: 'checkbox',
                checked: isInList(list),
                onchange: (event) => onToggleList(list, event.target.checked),
              }),
              list.name,
            ),
          ),
        )
      : h('p', { class: 'muted' }, 'Você ainda não tem listas.'),
    nameForm({
      id: 'nova-lista',
      label: 'Nova lista com este título',
      button: 'Criar e adicionar',
      onSubmit: onCreateList,
    }),
    h('p', {}, h('a', { href: '#/listas' }, 'Ver todas as listas')),
  );
}

export function toastElement({ message, type = 'info' }) {
  const icons = {
    online: '🟢',
    offline: '⚠️',
    success: '✅',
    error: '❌',
    info: 'ℹ️',
  };
  const icon = icons[type] || 'ℹ️';
  return h(
    'div',
    { class: `toast toast--${type}`, role: 'status' },
    h('span', { 'aria-hidden': 'true' }, icon),
    h('span', {}, message),
  );
}

export function backupSection({ onExportBackup, onImportBackup, status = '', error = '' }) {
  const fileInput = h('input', {
    type: 'file',
    accept: '.json,application/json',
    class: 'backup-input-hidden',
    id: 'backup-file-input',
    onchange: (event) => {
      const file = event.target.files?.[0];
      if (file && onImportBackup) {
        onImportBackup(file);
      }
      event.target.value = '';
    },
  });

  return h(
    'section',
    { class: 'backup-panel', 'aria-labelledby': 'titulo-backup' },
    h('h2', { id: 'titulo-backup' }, 'Backup dos seus dados'),
    h(
      'p',
      { class: 'muted' },
      'Exporte ou importe um arquivo JSON completo com seus favoritos, avaliações e listas.',
    ),
    h(
      'div',
      { class: 'backup-actions' },
      h(
        'button',
        { type: 'button', class: 'button button--primary', onclick: onExportBackup },
        'Exportar backup (.json)',
      ),
      h(
        'button',
        { type: 'button', class: 'button', onclick: () => fileInput.click() },
        'Importar backup (.json)',
      ),
      fileInput,
    ),
    status && h('p', { class: 'muted' }, status),
    error && h('p', { class: 'error', role: 'alert' }, error),
  );
}

/** Tela "Minhas listas": criação e índice das listas. */
export function listsView(
  lists,
  { onCreate, error = '', onExportBackup, onImportBackup, backupStatus = '', backupError = '' },
) {
  const backupNode =
    onExportBackup || onImportBackup
      ? backupSection({ onExportBackup, onImportBackup, status: backupStatus, error: backupError })
      : null;

  return h(
    'div',
    {},
    h('h1', { id: 'titulo-listas-pagina', tabindex: -1 }, 'Minhas listas'),
    h(
      'p',
      { class: 'muted' },
      'As listas ficam salvas apenas neste navegador. Para levar uma lista a outra pessoa ou aparelho, abra a lista e use o link de compartilhamento ou faça um backup completo.',
    ),
    nameForm({ id: 'nome-lista', label: 'Nome da nova lista', button: 'Criar lista', onSubmit: onCreate, error }),
    lists.length > 0
      ? h(
          'ul',
          { class: 'lists', role: 'list' },
          lists.map((list) =>
            h(
              'li',
              { class: 'lists__item' },
              h('a', { href: customListHref(list.id) }, list.name),
              h('span', { class: 'muted' }, countLabel(list.items.length)),
            ),
          ),
        )
      : message({
          title: 'Nenhuma lista ainda',
          text: 'Crie uma lista acima e adicione títulos pela página de detalhes de cada filme ou série.',
        }),
    backupNode,
  );
}

/** Tela de uma lista: renomear, compartilhar, excluir, reordenar e remover títulos. */
export function customListView(
  list,
  { shareUrl, error = '', onRename, onDelete, onCopyLink, onMove, onRemoveItem, isFavorite, onToggleFavorite },
) {
  const last = list.items.length - 1;
  const tool = (label, ariaLabel, onclick, disabled = false) =>
    h('button', { type: 'button', class: 'button button--small', 'aria-label': ariaLabel, disabled, onclick }, label);
  return h(
    'div',
    {},
    h('p', {}, h('a', { href: '#/listas' }, '‹ Minhas listas')),
    h('h1', { id: 'titulo-lista', tabindex: -1 }, list.name),
    h('p', { class: 'muted' }, countLabel(list.items.length)),
    nameForm({
      id: 'renomear-lista',
      label: 'Nome da lista',
      button: 'Renomear',
      value: list.name,
      onSubmit: onRename,
      error,
    }),
    h(
      'div',
      { class: 'inline-form' },
      h('label', { for: 'link-lista' }, 'Link para compartilhar (leva só o nome da lista e os títulos)'),
      h('input', { id: 'link-lista', type: 'text', readonly: true, value: shareUrl }),
      h('button', { type: 'button', class: 'button', onclick: onCopyLink }, 'Copiar link'),
    ),
    list.items.length > 0
      ? h(
          'ol',
          { class: 'grid', 'aria-label': `Títulos de ${list.name}, na ordem da lista` },
          list.items.map((item, index) =>
            h(
              'li',
              {},
              mediaCard(item, { favorite: isFavorite(item), onToggleFavorite }),
              h(
                'p',
                { class: 'actions list-tools' },
                tool('↑', `Mover ${item.title} para cima`, () => onMove(index, index - 1), index === 0),
                tool('↓', `Mover ${item.title} para baixo`, () => onMove(index, index + 1), index === last),
                tool('Remover', `Remover ${item.title} da lista`, () => onRemoveItem(item)),
              ),
            ),
          ),
        )
      : message({
          title: 'Lista vazia',
          text: 'Abra um filme ou série e marque esta lista em “Minhas listas”.',
          actions: [h('a', { class: 'button button--primary', href: '#/filmes' }, 'Explorar filmes')],
        }),
    h(
      'p',
      { class: 'actions' },
      h('button', { type: 'button', class: 'button', onclick: onDelete }, 'Excluir lista'),
    ),
  );
}

/** Tela aberta por um link compartilhado. `shared` nulo significa link inválido. */
export function importView(shared, { onImport }) {
  if (!shared) {
    return h(
      'div',
      { class: 'panel' },
      h('h1', { tabindex: -1 }, 'Link de lista inválido'),
      h('p', {}, 'O link está incompleto ou foi alterado. Peça a quem compartilhou que copie o link de novo.'),
      h(
        'p',
        { class: 'actions' },
        h('a', { class: 'button button--primary', href: '#/listas' }, 'Ir para as minhas listas'),
      ),
    );
  }
  return h(
    'div',
    { class: 'panel' },
    h('h1', { tabindex: -1 }, 'Importar lista'),
    h('p', { class: 'panel__status' }, `“${shared.name}” · ${countLabel(shared.items.length)}`),
    h(
      'ol',
      {},
      shared.items.map((item) =>
        h('li', {}, h('a', { href: detailsHref(item.media, item.id) }, item.title), ` (${mediaLabel(item.media)})`),
      ),
    ),
    h(
      'p',
      { class: 'actions' },
      h('button', { type: 'button', class: 'button button--primary', onclick: onImport }, 'Salvar nas minhas listas'),
    ),
  );
}

/** Modal imersivo para o Modo Cinema. */
export function cinemaModal({ title, trailer, backdropPath, onClose }) {
  const backdrop = imageUrl(backdropPath, 'w1280');
  const overlay = h(
    'div',
    {
      class: 'cinema-overlay',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': `Modo Cinema: ${title}`,
      onclick: (event) => {
        if (event.target === overlay) {
          onClose();
        }
      },
    },
    h(
      'div',
      { class: 'cinema-bar' },
      h('div', { class: 'cinema-bar__title' }, '🎬 Modo Cinema · ', h('span', {}, title)),
      h(
        'button',
        {
          type: 'button',
          class: 'button button--close-cinema',
          'aria-label': 'Fechar Modo Cinema',
          onclick: onClose,
        },
        '✕ Sair (Esc)',
      ),
    ),
    h(
      'div',
      { class: 'cinema-stage' },
      trailer
        ? h('iframe', {
            class: 'cinema-frame',
            src: `https://www.youtube-nocookie.com/embed/${trailer.key}?autoplay=1`,
            title: `Trailer: ${trailer.name}`,
            allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
            referrerpolicy: 'strict-origin-when-cross-origin',
          })
        : backdrop
        ? h('img', { class: 'cinema-backdrop', src: backdrop, alt: `Cena de ${title}` })
        : h('p', { class: 'muted' }, 'Nenhum vídeo disponível no momento.'),
    ),
  );
  return overlay;
}

/** Tela de métricas e controle de tempo assistido. */
export function watchtimeView(
  stats,
  items,
  { onUnmarkWatched, onExportBackup, onImportBackup, genreNames = new Map() } = {},
) {
  const cards = h(
    'div',
    { class: 'stats-grid' },
    h(
      'div',
      { class: 'stat-card' },
      h('span', { class: 'stat-card__icon', 'aria-hidden': 'true' }, '⏱️'),
      h('h2', { class: 'stat-card__title' }, 'Tempo assistido'),
      h('p', { class: 'stat-card__value' }, stats.formattedDuration),
      h('span', { class: 'stat-card__sub' }, `${stats.totalMinutes.toLocaleString('pt-BR')} minutos`),
    ),
    h(
      'div',
      { class: 'stat-card' },
      h('span', { class: 'stat-card__icon', 'aria-hidden': 'true' }, '🎬'),
      h('h2', { class: 'stat-card__title' }, 'Filmes concluídos'),
      h('p', { class: 'stat-card__value' }, String(stats.movieCount)),
      h('span', { class: 'stat-card__sub' }, 'longas-metragens assistidos'),
    ),
    h(
      'div',
      { class: 'stat-card' },
      h('span', { class: 'stat-card__icon', 'aria-hidden': 'true' }, '📺'),
      h('h2', { class: 'stat-card__title' }, 'Séries acompanhadas'),
      h('p', { class: 'stat-card__value' }, String(stats.showCount)),
      h('span', { class: 'stat-card__sub' }, 'títulos no histórico'),
    ),
    h(
      'div',
      { class: 'stat-card' },
      h('span', { class: 'stat-card__icon', 'aria-hidden': 'true' }, '📊'),
      h('h2', { class: 'stat-card__title' }, 'Média por obra'),
      h('p', { class: 'stat-card__value' }, stats.formattedAverage),
      h('span', { class: 'stat-card__sub' }, 'duração média por título'),
    ),
  );

  let genresSection = null;
  if (stats.genreDistribution && stats.genreDistribution.length > 0) {
    genresSection = h(
      'section',
      { class: 'block', 'aria-labelledby': 'titulo-distribuicao' },
      h('h2', { id: 'titulo-distribuicao' }, 'Distribuição por gênero'),
      h(
        'div',
        { class: 'genre-bars' },
        stats.genreDistribution.slice(0, 8).map((g) => {
          const name = genreNames.get(g.genreId) || `Gênero ${g.genreId}`;
          return h(
            'div',
            { class: 'genre-bar-item' },
            h(
              'div',
              { class: 'genre-bar-label' },
              h('span', { class: 'genre-name' }, name),
              h('span', { class: 'genre-meta' }, `${g.percentage}% (${formatRuntime(g.minutes)})`),
            ),
            h(
              'div',
              { class: 'progress-track' },
              h('div', {
                class: 'progress-fill',
                style: `width: ${Math.max(4, g.percentage)}%`,
              }),
            ),
          );
        }),
      ),
    );
  }

  // Seção de backup
  const backupInput = h('input', {
    type: 'file',
    accept: '.json',
    class: 'backup-input-hidden',
    onchange: (event) => {
      const file = event.target.files?.[0];
      if (file && onImportBackup) {
        onImportBackup(file);
        event.target.value = '';
      }
    },
  });

  const backupSec = h(
    'section',
    { class: 'backup-panel' },
    h('h2', {}, 'Exportação e restauração de dados (JSON)'),
    h('p', { class: 'muted' }, 'Exporte seus favoritos, listas, avaliações e histórico de tempo assistido em JSON.'),
    h(
      'div',
      { class: 'backup-actions' },
      h(
        'button',
        { type: 'button', class: 'button button--primary', onclick: onExportBackup },
        'Exportar dados (JSON)',
      ),
      h(
        'button',
        { type: 'button', class: 'button', onclick: () => backupInput.click() },
        'Restaurar backup (JSON)',
      ),
      backupInput,
    ),
  );

  let historySec = null;
  if (items && items.length > 0) {
    historySec = h(
      'section',
      { class: 'block', 'aria-labelledby': 'titulo-historico' },
      h('h2', { id: 'titulo-historico' }, 'Histórico de títulos assistidos'),
      h(
        'ul',
        { class: 'watched-list', role: 'list' },
        items.map((item) =>
          h(
            'li',
            { class: 'watched-item' },
            h(
              'div',
              { class: 'watched-item__info' },
              h('a', { href: detailsHref(item.media, item.id), class: 'watched-item__title' }, item.title),
              h(
                'span',
                { class: 'muted' },
                ` · ${mediaLabel(item.media)} · ${formatRuntime(item.runtime)} · Assistido em ${formatDate(item.watchedAt)}`,
              ),
            ),
            onUnmarkWatched &&
              h(
                'button',
                {
                  type: 'button',
                  class: 'button button--small',
                  'aria-label': `Remover ${item.title} dos assistidos`,
                  onclick: () => onUnmarkWatched(item),
                },
                'Desmarcar',
              ),
          ),
        ),
      ),
    );
  } else {
    historySec = message({
      title: 'Nenhum título assistido ainda',
      text: 'Abra os detalhes de um filme ou série e clique em "Marcar como assistido" para começar a registrar seu tempo.',
      actions: [h('a', { class: 'button button--primary', href: '#/filmes' }, 'Explorar filmes')],
    });
  }

  return h(
    'div',
    {},
    h('h1', { id: 'titulo-watchtime', tabindex: -1 }, 'Tempo assistido e métricas'),
    h('p', { class: 'muted' }, 'Acompanhe seu consumo de filmes e séries com métricas detalhadas em tempo real.'),
    cards,
    genresSection,
    historySec,
    backupSec,
  );
}
