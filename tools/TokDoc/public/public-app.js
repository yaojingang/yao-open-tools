const typeLabels = {
  all: '全部',
  html: 'HTML',
  pdf: 'PDF',
  word: 'Word',
};

const publicSorts = new Set(['updated_desc', 'created_desc']);

function normalizePublicSort(value) {
  const sort = String(value || 'updated_desc');
  return publicSorts.has(sort) ? sort : 'updated_desc';
}

const state = {
  type: typeFromPath(),
  q: new URLSearchParams(window.location.search).get('q') || '',
  sort: normalizePublicSort(new URLSearchParams(window.location.search).get('sort')),
  page: Number(new URLSearchParams(window.location.search).get('page') || 1),
  pageSize: 10,
  pages: [],
  stats: { all: 0, html: 0, pdf: 0, word: 0 },
  pagination: {
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
    hasPrev: false,
    hasNext: false,
  },
};

const els = {
  statsLine: document.querySelector('#statsLine'),
  search: document.querySelector('#searchInput'),
  sort: document.querySelector('#sortSelect'),
  tabs: document.querySelector('#typeTabs'),
  rows: document.querySelector('#docRows'),
  cards: document.querySelector('#docCards'),
  empty: document.querySelector('#emptyState'),
  pagination: document.querySelector('#pagination'),
};

let searchTimer = null;

function typeFromPath() {
  const match = window.location.pathname.match(/^\/type\/(html|pdf|word)\/?$/);
  return match ? match[1] : 'all';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '1 KB';
  if (value < 1024) return `${value} B`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function fileTypeClass(type) {
  if (type === 'pdf') return 'type-pdf';
  if (type === 'word') return 'type-word';
  return 'type-html';
}

function typeBadge(page) {
  const type = page.fileType || 'html';
  return `<span class="type-badge ${fileTypeClass(type)}">${escapeHtml(typeLabels[type] || type.toUpperCase())}</span>`;
}

function documentUrl(page) {
  return page.url || `/${page.slug}`;
}

function queryString() {
  const params = new URLSearchParams();
  state.sort = normalizePublicSort(state.sort);
  params.set('type', state.type);
  params.set('page', String(state.page || 1));
  params.set('pageSize', String(state.pageSize || 10));
  params.set('sort', state.sort || 'updated_desc');
  if (state.q) params.set('q', state.q);
  return params;
}

async function fetchPublicPages() {
  const response = await fetch(`/public/api/pages?${queryString().toString()}`, { credentials: 'same-origin' });
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof data === 'object' ? data.error : data;
    throw new Error(message || `请求失败：${response.status}`);
  }
  state.pages = data.pages || [];
  state.stats = data.stats || state.stats;
  state.pagination = data.pagination || state.pagination;
}

function updateUrl() {
  const params = new URLSearchParams();
  const sort = normalizePublicSort(state.sort);
  if (state.q) params.set('q', state.q);
  if (sort !== 'updated_desc') params.set('sort', sort);
  if (state.page && state.page > 1) params.set('page', String(state.page));
  const path = state.type === 'all' ? '/' : `/type/${state.type}`;
  const nextUrl = `${path}${params.toString() ? `?${params.toString()}` : ''}`;
  window.history.pushState({ ...state }, '', nextUrl);
}

function renderStats() {
  const stats = state.stats || {};
  els.statsLine.innerHTML = [
    ['全部', stats.all || 0],
    ['HTML', stats.html || 0],
    ['PDF', stats.pdf || 0],
    ['Word', stats.word || 0],
  ]
    .map(([label, value]) => `<span>${label} <strong>${Number(value) || 0}</strong></span>`)
    .join('');
}

function renderTabs() {
  els.tabs.querySelectorAll('[data-type]').forEach((tab) => {
    const type = tab.dataset.type || 'all';
    tab.classList.toggle('is-active', type === state.type);
    const count = state.stats?.[type] ?? 0;
    tab.textContent = type === 'all' ? `全部 ${count}` : `${typeLabels[type]} ${count}`;
  });
}

function renderRows() {
  els.rows.innerHTML = state.pages
    .map((page) => {
      const url = documentUrl(page);
      const directory = page.directoryName || '-';
      return `<tr data-url="${escapeHtml(url)}">
        <td>${typeBadge(page)}</td>
        <td class="title-cell">
          <span class="title-main">${escapeHtml(page.title || page.fileName || page.slug)}</span>
          <span class="title-meta mono">${escapeHtml(page.fileName || page.slug || '')}</span>
        </td>
        <td><span class="muted-cell">${escapeHtml(directory)}</span></td>
        <td>${escapeHtml(page.uploadTime || page.updatedTime || '-')}</td>
        <td>${escapeHtml(formatSize(page.size))}</td>
        <td>
          <a class="open-btn" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="打开 ${escapeHtml(page.title || page.fileName || page.slug)}">
            打开
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M15 3h6v6"></path>
              <path d="M10 14 21 3"></path>
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            </svg>
          </a>
        </td>
      </tr>`;
    })
    .join('');
}

function renderCards() {
  els.cards.innerHTML = state.pages
    .map((page) => {
      const url = documentUrl(page);
      const directory = page.directoryName || '-';
      return `<article class="doc-card" data-url="${escapeHtml(url)}">
        <div class="card-head">
          <div class="card-title">
            <strong>${escapeHtml(page.title || page.fileName || page.slug)}</strong>
            <span class="title-meta mono">${escapeHtml(page.fileName || page.slug || '')}</span>
          </div>
          ${typeBadge(page)}
        </div>
        <div class="card-meta">${escapeHtml(directory)} · ${escapeHtml(formatSize(page.size))} · ${escapeHtml(page.uploadTime || page.updatedTime || '-')}</div>
        <a class="open-btn" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">打开文档</a>
      </article>`;
    })
    .join('');
}

function renderPagination() {
  const page = state.pagination.page || 1;
  const totalPages = state.pagination.totalPages || 1;
  const total = state.pagination.total || 0;
  els.pagination.innerHTML = `<div class="page-summary">共 ${total} 个文档，第 ${page} / ${totalPages} 页</div>
    <div class="page-actions">
      <button class="page-btn" type="button" data-page="prev" ${state.pagination.hasPrev ? '' : 'disabled'}>上一页</button>
      <button class="page-btn" type="button" data-page="next" ${state.pagination.hasNext ? '' : 'disabled'}>下一页</button>
    </div>`;
}

function renderEmptyState() {
  const hasPages = state.pages.length > 0;
  els.empty.style.display = hasPages ? 'none' : 'block';
  document.querySelector('.table-wrap').style.display = hasPages ? '' : 'none';
  els.cards.style.display = hasPages ? '' : 'none';
  els.pagination.style.display = hasPages ? '' : 'none';
}

function render() {
  if (els.search && document.activeElement !== els.search) els.search.value = state.q || '';
  if (els.sort) els.sort.value = normalizePublicSort(state.sort);
  renderStats();
  renderTabs();
  renderRows();
  renderCards();
  renderPagination();
  renderEmptyState();
}

function showLoadError(error) {
  state.pages = [];
  state.pagination = {
    page: 1,
    pageSize: state.pageSize,
    total: 0,
    totalPages: 1,
    hasPrev: false,
    hasNext: false,
  };
  els.empty.innerHTML = `<strong>列表加载失败</strong><span>${escapeHtml(error.message)}</span>`;
  renderRows();
  renderCards();
  renderPagination();
  renderEmptyState();
}

async function loadAndRender({ updateHistory = false } = {}) {
  await fetchPublicPages();
  if (updateHistory) updateUrl();
  render();
}

els.tabs.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-type]');
  if (!tab) return;
  event.preventDefault();
  state.type = tab.dataset.type || 'all';
  state.page = 1;
  loadAndRender({ updateHistory: true }).catch((error) => {
    showLoadError(error);
  });
});

els.search.addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    state.q = els.search.value.trim();
    state.page = 1;
    loadAndRender({ updateHistory: true }).catch((error) => {
      showLoadError(error);
    });
  }, 250);
});

els.sort.addEventListener('change', () => {
  state.sort = normalizePublicSort(els.sort.value);
  state.page = 1;
  loadAndRender({ updateHistory: true }).catch((error) => {
    showLoadError(error);
  });
});

els.pagination.addEventListener('click', (event) => {
  const button = event.target.closest('[data-page]');
  if (!button || button.disabled) return;
  if (button.dataset.page === 'prev') state.page = Math.max(1, state.page - 1);
  if (button.dataset.page === 'next') state.page = Math.min(state.pagination.totalPages || 1, state.page + 1);
  loadAndRender({ updateHistory: true }).catch((error) => {
    showLoadError(error);
  });
});

document.addEventListener('click', (event) => {
  if (event.target.closest('a,button,select,input')) return;
  const row = event.target.closest('[data-url]');
  if (!row) return;
  window.open(row.dataset.url, '_blank', 'noopener,noreferrer');
});

window.addEventListener('popstate', () => {
  const params = new URLSearchParams(window.location.search);
  state.type = typeFromPath();
  state.q = params.get('q') || '';
  state.sort = normalizePublicSort(params.get('sort'));
  state.page = Number(params.get('page') || 1);
  loadAndRender().catch((error) => {
    showLoadError(error);
  });
});

loadAndRender().catch((error) => {
  showLoadError(error);
});
