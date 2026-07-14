const icons = {
  folder:
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path></svg>',
  eye:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2.1 12.4a11 11 0 0 1 19.8 0 11 11 0 0 1-19.8 0"></path><circle cx="12" cy="12" r="3"></circle></svg>',
  edit:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>',
  copy:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>',
  external:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path></svg>',
  download:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>',
  trash:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path></svg>',
  restore:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-15-6.7L3 13"></path></svg>',
  cloudUpload:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 13v8"></path><path d="m16 17-4-4-4 4"></path><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"></path><path d="M16 16h2a4 4 0 0 0 0-8h-.2"></path></svg>',
};

let pages = [];
let watchDirectories = [];
const defaultSettings = {
  trackingCode: '',
  authUsername: 'admin',
  adminPath: '/admin',
  siteName: 'TokDoc 文档索引',
  adminName: 'TokDoc',
  publicSeoTitle: 'TokDoc 文档索引',
  publicSeoDescription: '公开文档索引，集中阅读 HTML、Markdown、PDF、Word、PPT、Keynote 与 Excel 文档。',
  publicSeoKeywords: 'TokDoc,文档索引,HTML,Markdown,PDF,Word,PPT,Keynote,Excel',
  publicHomepageEnabled: true,
  remoteSyncEnabled: false,
  remoteSyncUrl: '',
  remoteSyncHasToken: false,
};

const managedTypeMeta = {
  html: { label: 'HTML', badge: 'badge-success' },
  markdown: { label: 'Markdown', badge: 'badge-slate' },
  pdf: { label: 'PDF', badge: 'badge-warning' },
  word: { label: 'Word', badge: 'badge-violet' },
  presentation: { label: '演示', badge: 'badge-blue' },
  keynote: { label: 'Keynote', badge: 'badge-indigo' },
  spreadsheet: { label: '表格', badge: 'badge-teal' },
};

const supportedFilePattern = /\.(html?|md|markdown|pdf|docx?|pptx?|pptm|ppsx?|key|xlsx?|xlsm|xlsb)$/i;

let settings = { ...defaultSettings };
const initialPath = normalizedPath(window.location.pathname || defaultSettings.adminPath);
const isSettingsPage = initialPath.endsWith('/settings');
let adminBasePath = normalizeAdminPath(isSettingsPage ? initialPath.replace(/\/settings$/u, '') : initialPath);
let session = { authenticated: false, username: '' };
let activeFilter = 'all';
let activeType = 'all';
let currentPageId = null;
let toastTimer = null;
let stagedUpload = null;
let activeUploadRequest = null;
let uploadCancelRequested = false;
let loadDataRequestId = 0;
let pagination = {
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1,
  offset: 0,
  hasPrev: false,
  hasNext: false,
};

const els = {
  rows: document.querySelector('#pageRows'),
  paginationBar: document.querySelector('#paginationBar'),
  tableWrap: document.querySelector('.table-wrap'),
  watchList: document.querySelector('#watchList'),
  search: document.querySelector('#searchInput'),
  typeTabs: document.querySelector('#typeTabs'),
  fileInput: document.querySelector('#fileInput'),
  directoryInput: document.querySelector('#directoryInput'),
  dropZone: document.querySelector('#dropZone'),
  uploadBackdrop: document.querySelector('#uploadBackdrop'),
  uploadProgressCard: document.querySelector('#uploadProgressCard'),
  uploadProgressText: document.querySelector('#uploadProgressText'),
  uploadProgressDetail: document.querySelector('#uploadProgressDetail'),
  uploadProgressBadge: document.querySelector('#uploadProgressBadge'),
  uploadProgressBar: document.querySelector('#uploadProgressBar'),
  uploadReview: document.querySelector('#uploadReview'),
  uploadReviewRows: document.querySelector('#uploadReviewRows'),
  uploadReviewSummary: document.querySelector('#uploadReviewSummary'),
  uploadReviewCount: document.querySelector('#uploadReviewCount'),
  uploadFooterNote: document.querySelector('#uploadFooterNote'),
  confirmUpload: document.querySelector('#confirmUpload'),
  cancelUpload: document.querySelector('#cancelUpload'),
  previewBackdrop: document.querySelector('#previewBackdrop'),
  previewFrame: document.querySelector('#previewFrame'),
  trackingCodeInput: document.querySelector('#trackingCodeInput'),
  remoteSyncEnabledInput: document.querySelector('#remoteSyncEnabledInput'),
  remoteSyncUrlInput: document.querySelector('#remoteSyncUrlInput'),
  remoteSyncTokenInput: document.querySelector('#remoteSyncTokenInput'),
  authUsernameInput: document.querySelector('#authUsernameInput'),
  authPasswordInput: document.querySelector('#authPasswordInput'),
  adminPathInput: document.querySelector('#adminPathInput'),
  publicHomepageEnabledInput: document.querySelector('#publicHomepageEnabledInput'),
  currentPasswordInput: document.querySelector('#currentPasswordInput'),
  authUserLabel: document.querySelector('#authUserLabel'),
  logoutButton: document.querySelector('#logoutButton'),
  loginBackdrop: document.querySelector('#loginBackdrop'),
  loginForm: document.querySelector('#loginForm'),
  loginUsername: document.querySelector('#loginUsername'),
  loginPassword: document.querySelector('#loginPassword'),
  loginError: document.querySelector('#loginError'),
  toast: document.querySelector('#toast'),
  managerView: document.querySelector('#managerView'),
  settingsPage: document.querySelector('#settingsPage'),
  adminHomeLink: document.querySelector('#adminHomeLink'),
  adminBrandTitle: document.querySelector('#adminBrandTitle'),
  adminBrandSubtitle: document.querySelector('#adminBrandSubtitle'),
  openSettings: document.querySelector('#openSettings'),
  settingsBackLink: document.querySelector('#settingsBackLink'),
  saveSettingsTop: document.querySelector('#saveSettingsTop'),
  siteNameInput: document.querySelector('#siteNameInput'),
  adminNameInput: document.querySelector('#adminNameInput'),
  publicSeoTitleInput: document.querySelector('#publicSeoTitleInput'),
  publicSeoDescriptionInput: document.querySelector('#publicSeoDescriptionInput'),
  publicSeoKeywordsInput: document.querySelector('#publicSeoKeywordsInput'),
};

function normalizedPath(pathname) {
  if (pathname === '/') return '/';
  return String(pathname || '').replace(/\/+$/g, '') || '/';
}

function normalizeAdminPath(value) {
  const raw = String(value || defaultSettings.adminPath).trim();
  const candidate = raw.startsWith('/') ? raw : `/${raw}`;
  return candidate.replace(/\/+$/g, '') || defaultSettings.adminPath;
}

function settingsUrl() {
  return `${adminBasePath}/settings`;
}

function managerUrl() {
  return adminBasePath;
}

function normalizeWatchPath(value) {
  const text = String(value || '').trim();
  if (text === '/') return text;
  return text.replace(/[\\/]+$/g, '');
}

function hasWatchDirectory(watchPath) {
  const normalized = normalizeWatchPath(watchPath);
  return Boolean(normalized) && watchDirectories.some((item) => normalizeWatchPath(item.path) === normalized);
}

function applySettings(nextSettings = {}) {
  const hasAdminPath = Object.prototype.hasOwnProperty.call(nextSettings, 'adminPath');
  settings = { ...settings, ...nextSettings };
  if (hasAdminPath) adminBasePath = normalizeAdminPath(settings.adminPath || adminBasePath);
}

function renderShell() {
  const adminName = settings.adminName || defaultSettings.adminName;
  if (els.adminHomeLink) els.adminHomeLink.href = managerUrl();
  if (els.adminBrandTitle) els.adminBrandTitle.textContent = adminName;
  if (els.adminBrandSubtitle) els.adminBrandSubtitle.textContent = '本地文档管理器 · Docker 运行 · 即开即读';
  if (els.loginError && document.querySelector('#loginTitle')) document.querySelector('#loginTitle').textContent = `${adminName} 登录`;
  if (els.openSettings) {
    els.openSettings.href = settingsUrl();
    els.openSettings.classList.toggle('btn-blue', isSettingsPage);
  }
  if (els.settingsBackLink) els.settingsBackLink.href = managerUrl();
  document.title = isSettingsPage ? `${adminName} 系统设置` : `${adminName} 本地文档管理器`;
}

function applyView() {
  if (els.managerView) els.managerView.hidden = isSettingsPage;
  if (els.settingsPage) els.settingsPage.hidden = !isSettingsPage;
  document.body.dataset.view = isSettingsPage ? 'settings' : 'manager';
  renderShell();
}

function apiUrl(path) {
  if (String(path).startsWith('/api/')) return `${adminBasePath}${path}`;
  return path;
}

async function api(path, options = {}) {
  const response = await fetch(apiUrl(path), { credentials: 'same-origin', ...options });
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof data === 'object' ? data.error : data;
    const error = new Error(message || `请求失败：${response.status}`);
    error.status = response.status;
    if (response.status === 401 && path !== '/api/login') showLogin();
    throw error;
  }
  return data;
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
  if (!Number.isFinite(bytes) || bytes <= 0) return '1 KB';
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function displayId(page, index = pages.findIndex((item) => item.id === page.id)) {
  const number = (pagination.offset || 0) + index + 1;
  return `H-${String(Math.max(number, 1)).padStart(3, '0')}`;
}

function fileType(page) {
  return page.fileType || 'html';
}

function isHtmlPage(page) {
  return fileType(page) === 'html';
}

function isEditablePage(page) {
  return Boolean(page?.canEdit || page?.editUrl);
}

function fileTypeLabel(page) {
  const type = fileType(page);
  return managedTypeMeta[type]?.label || type.toUpperCase();
}

function fileTypeBadgeClass(page) {
  const type = fileType(page);
  return managedTypeMeta[type]?.badge || 'badge-success';
}

function fileTypeLabelFromType(type) {
  return fileTypeLabel({ fileType: type || 'html' });
}

function fileTypeBadgeClassFromType(type) {
  return fileTypeBadgeClass({ fileType: type || 'html' });
}

function isPrivatePage(page) {
  return page?.visibility === 'private';
}

function visibilityLabel(page) {
  return isPrivatePage(page) ? '仅自己' : '公开';
}

function visibilityBadgeClass(page) {
  return isPrivatePage(page) ? 'badge-warning' : 'badge-success';
}

function pageUrl(page) {
  return page.url || `/${page.slug}`;
}

function editUrl(page) {
  if (!isEditablePage(page)) return '';
  return page.editUrl || `${pageUrl(page)}?edit=1`;
}

function findPage(id) {
  return pages.find((page) => page.id === id);
}

function filenameFromDisposition(value) {
  const header = String(value || '');
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return header.match(/filename="([^"]+)"/i)?.[1] || '';
}

function scrollingElement() {
  return document.scrollingElement || document.documentElement;
}

function captureListViewport() {
  const tableHeight = els.tableWrap?.getBoundingClientRect().height || 0;
  return {
    x: window.scrollX || scrollingElement().scrollLeft || 0,
    y: window.scrollY || scrollingElement().scrollTop || 0,
    tableHeight: Math.ceil(tableHeight),
  };
}

function lockListViewport(viewport) {
  if (!viewport || !els.tableWrap || viewport.tableHeight <= 0) return;
  els.tableWrap.style.minHeight = `${viewport.tableHeight}px`;
}

function clearListViewportLock() {
  if (els.tableWrap) els.tableWrap.style.minHeight = '';
}

function restoreListViewport(viewport) {
  if (!viewport) return;
  window.requestAnimationFrame(() => {
    const scrollRoot = scrollingElement();
    const lockedMinHeight = els.tableWrap?.style.minHeight || '';
    const minDocumentHeight = viewport.y + window.innerHeight;

    if (els.tableWrap && lockedMinHeight) {
      els.tableWrap.style.minHeight = '';
      if (scrollRoot.scrollHeight < minDocumentHeight) {
        els.tableWrap.style.minHeight = lockedMinHeight;
      }
    }

    window.scrollTo({
      left: viewport.x,
      top: Math.min(viewport.y, Math.max(0, scrollRoot.scrollHeight - window.innerHeight)),
      behavior: 'auto',
    });
  });
}

async function loadData({ preserveScroll = false } = {}) {
  if (!session.authenticated) return;
  const requestId = ++loadDataRequestId;
  const viewport = preserveScroll ? captureListViewport() : null;
  if (viewport) {
    lockListViewport(viewport);
  } else {
    clearListViewportLock();
  }
  const params = new URLSearchParams({
    page: String(pagination.page),
    pageSize: String(pagination.pageSize),
  });
  const keyword = els.search.value.trim();
  if (keyword) params.set('q', keyword);
  if (activeType !== 'all') params.set('type', activeType);
  if (activeFilter === 'trash') {
    params.set('scope', 'trash');
  } else if (activeFilter !== 'all') {
    params.set('status', activeFilter);
  }
  try {
    const [pageData, watchData, settingsData] = await Promise.all([
      api(`/api/pages?${params.toString()}`),
      api('/api/watch-dirs'),
      api('/api/settings'),
    ]);
    if (requestId !== loadDataRequestId) return;
    pages = pageData.pages || [];
    pagination = { ...pagination, ...(pageData.pagination || {}) };
    watchDirectories = watchData.watchDirs || [];
    applySettings(settingsData.settings);
    render();
    restoreListViewport(viewport);
  } catch (error) {
    if (requestId === loadDataRequestId) restoreListViewport(viewport);
    throw error;
  }
}

function setPage(nextPage, options = {}) {
  pagination.page = Math.min(Math.max(Number(nextPage) || 1, 1), pagination.totalPages || 1);
  return loadData(options);
}

function resetToFirstPage(options = {}) {
  pagination.page = 1;
  return loadData(options);
}

function visiblePageNumbers() {
  const total = pagination.totalPages || 1;
  const current = pagination.page || 1;
  const pages = new Set([1, total, current, current - 1, current + 1]);
  return Array.from(pages)
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => a - b);
}

function renderWatchDirectories() {
  els.watchList.innerHTML = watchDirectories
    .map((item) => {
      const statusText = item.status === 'updated' ? '已更新' : item.status === 'active' ? '自动监听' : item.status === 'error' ? '无法访问' : item.status;
      const statusClass = item.status === 'error' ? 'badge-warning' : 'badge-success';
      return `<div class="watch-item" data-watch-id="${escapeHtml(item.id)}">
        <div class="watch-item-main">
          ${icons.folder}
          <div>
            <span class="watch-path" title="${escapeHtml(item.path)}">${escapeHtml(item.path)}</span>
            <div class="watch-meta">
              <span>${escapeHtml(item.name || item.source || '-')}</span>
              <span>${item.htmlCount || 0} 个 HTML</span>
              <span>${escapeHtml(item.lastScan || '等待扫描')}</span>
            </div>
          </div>
          <span class="badge ${statusClass}">${escapeHtml(statusText)}</span>
        </div>
        <div class="watch-actions">
          <button class="btn" type="button" data-watch-action="rescan" data-id="${escapeHtml(item.id)}">重新扫描</button>
          <button class="btn icon-btn" type="button" title="移除目录" aria-label="移除目录" data-watch-action="remove" data-id="${escapeHtml(item.id)}">${icons.trash}</button>
        </div>
      </div>`;
    })
    .join('');

  document.querySelector('#metricWatchDirs').textContent = watchDirectories.length;
  if (watchDirectories[0]) document.querySelector('#watchDirInput').value = watchDirectories[0].path;
}

function renderSettings() {
  renderShell();
  if (els.siteNameInput && document.activeElement !== els.siteNameInput) {
    els.siteNameInput.value = settings.siteName || defaultSettings.siteName;
  }
  if (els.adminNameInput && document.activeElement !== els.adminNameInput) {
    els.adminNameInput.value = settings.adminName || defaultSettings.adminName;
  }
  if (els.publicSeoTitleInput && document.activeElement !== els.publicSeoTitleInput) {
    els.publicSeoTitleInput.value = settings.publicSeoTitle || settings.siteName || defaultSettings.publicSeoTitle;
  }
  if (els.publicSeoDescriptionInput && document.activeElement !== els.publicSeoDescriptionInput) {
    els.publicSeoDescriptionInput.value = settings.publicSeoDescription || defaultSettings.publicSeoDescription;
  }
  if (els.publicSeoKeywordsInput && document.activeElement !== els.publicSeoKeywordsInput) {
    els.publicSeoKeywordsInput.value = settings.publicSeoKeywords || defaultSettings.publicSeoKeywords;
  }
  if (els.trackingCodeInput && document.activeElement !== els.trackingCodeInput) {
    els.trackingCodeInput.value = settings.trackingCode || '';
  }
  if (els.authUsernameInput && document.activeElement !== els.authUsernameInput) {
    els.authUsernameInput.value = settings.authUsername || 'admin';
  }
  if (els.authPasswordInput && document.activeElement !== els.authPasswordInput) {
    els.authPasswordInput.value = '';
  }
  if (els.adminPathInput && document.activeElement !== els.adminPathInput) {
    els.adminPathInput.value = settings.adminPath || '/admin';
  }
  if (els.publicHomepageEnabledInput) {
    els.publicHomepageEnabledInput.checked = settings.publicHomepageEnabled !== false;
  }
  if (els.currentPasswordInput && document.activeElement !== els.currentPasswordInput) {
    els.currentPasswordInput.value = '';
  }
  if (els.remoteSyncEnabledInput) {
    els.remoteSyncEnabledInput.checked = Boolean(settings.remoteSyncEnabled);
  }
  if (els.remoteSyncUrlInput && document.activeElement !== els.remoteSyncUrlInput) {
    els.remoteSyncUrlInput.value = settings.remoteSyncUrl || '';
  }
  if (els.remoteSyncTokenInput && document.activeElement !== els.remoteSyncTokenInput) {
    els.remoteSyncTokenInput.value = '';
    els.remoteSyncTokenInput.placeholder = settings.remoteSyncHasToken ? '已保存 Token，留空不修改' : '留空则不修改当前 Token';
  }
  if (els.authUserLabel) els.authUserLabel.textContent = session.username ? `已登录：${session.username}` : '未登录';
}

function renderTypeTabs() {
  if (!els.typeTabs) return;
  els.typeTabs.querySelectorAll('[data-type]').forEach((button) => {
    const isActive = (button.dataset.type || 'all') === activeType;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function render() {
  renderWatchDirectories();
  renderSettings();
  renderTypeTabs();
  els.rows.innerHTML = pages
    .map((page, index) => {
      const trashed = Boolean(page.deletedAt);
      const missing = page.status === 'missing';
      const statusClass = trashed || missing ? 'badge-warning' : page.edited ? 'badge-violet' : 'badge-success';
      const statusText = trashed ? '回收站' : missing ? '源文件缺失' : page.edited ? '已编辑' : '已生成';
      const nextVisibility = isPrivatePage(page) ? 'public' : 'private';
      const editButton = isEditablePage(page)
        ? `<button class="btn icon-btn" type="button" title="直接编辑" aria-label="直接编辑" data-action="edit" data-id="${page.id}">${icons.edit}</button>`
        : '';
      const syncButton = isHtmlPage(page)
        ? `<button class="btn icon-btn" type="button" title="上传线上" aria-label="上传线上" data-action="sync" data-id="${page.id}">${icons.cloudUpload}</button>`
        : '';
      const rowActions = trashed
        ? `<button class="btn" type="button" title="恢复展示" aria-label="恢复展示" data-action="restore" data-id="${page.id}">${icons.restore} 恢复</button>`
        : `<button class="btn icon-btn" type="button" title="${isEditablePage(page) ? '预览' : '阅读'}" aria-label="${isEditablePage(page) ? '预览' : '阅读'}" data-action="preview" data-id="${page.id}">${icons.eye}</button>
            ${editButton}
            <button class="btn icon-btn" type="button" title="复制 URL" aria-label="复制 URL" data-action="copy" data-id="${page.id}">${icons.copy}</button>
            <button class="btn icon-btn" type="button" title="下载文件" aria-label="下载文件" data-action="download" data-id="${page.id}">${icons.download}</button>
            <button class="btn icon-btn" type="button" title="新窗口打开" aria-label="新窗口打开" data-action="open" data-id="${page.id}">${icons.external}</button>
            ${syncButton}
            <button class="btn icon-btn" type="button" title="移入回收站" aria-label="移入回收站" data-action="delete" data-id="${page.id}">${icons.trash}</button>`;
      return `<tr>
        <td><span class="id-chip">${escapeHtml(displayId(page, index))}</span></td>
        <td>
          <div class="title-cell">
            <span class="title-main" title="${escapeHtml(page.title)}">${escapeHtml(page.title)}</span>
            <span class="title-meta" title="${escapeHtml(page.fileName)}">${escapeHtml(page.fileName)}</span>
          </div>
        </td>
        <td class="type-cell"><span class="badge ${fileTypeBadgeClass(page)}">${fileTypeLabel(page)}</span></td>
        <td class="time-cell">${escapeHtml(page.uploadTime || page.updatedTime || '-')}</td>
        <td><span class="size-cell">${escapeHtml(formatSize(page.size))}</span></td>
        <td><span class="directory-cell" title="${escapeHtml(page.directoryName || '无目录')}">${escapeHtml(page.directoryName || '-')}</span></td>
        <td><span class="download-cell">${Number(page.downloadCount || 0)}</span></td>
        <td><span class="access-cell">${Number(page.accessCount || 0)}</span></td>
        <td>
          ${
            trashed
              ? `<span class="badge ${visibilityBadgeClass(page)}">${visibilityLabel(page)}</span>`
              : `<button class="badge visibility-toggle ${visibilityBadgeClass(page)}" type="button" title="点击切换为${nextVisibility === 'private' ? '仅自己可见' : '公开'}" data-action="visibility" data-id="${page.id}" data-visibility="${nextVisibility}">${visibilityLabel(page)}</button>`
          }
        </td>
        <td><span class="badge ${statusClass}"><span class="status-dot"></span>${statusText}</span></td>
        <td class="actions-cell">
          <div class="actions">
            ${rowActions}
          </div>
        </td>
      </tr>`;
    })
    .join('');

  if (!pages.length) {
    const emptyText = activeFilter === 'trash' ? '回收站为空' : '暂无匹配页面';
    els.rows.innerHTML = `<tr><td colspan="11" style="height:120px;text-align:center;color:var(--muted)">${emptyText}</td></tr>`;
  }

  renderPagination();
  document.querySelector('#metricPages').textContent = pagination.total;
  document.querySelector('#metricEditable').textContent = pages.filter((page) => isEditablePage(page) && page.status !== 'missing').length;
  document.querySelector('#metricToday').textContent = pagination.total;
}

function renderPagination() {
  const total = pagination.total || 0;
  const totalPages = pagination.totalPages || 1;
  const page = pagination.page || 1;
  const start = total ? pagination.offset + 1 : 0;
  const end = Math.min(pagination.offset + pages.length, total);
  const numbers = visiblePageNumbers();
  let previousNumber = 0;
  const numberButtons = numbers
    .map((number) => {
      const gap = number - previousNumber > 1 ? '<span class="pagination-ellipsis">...</span>' : '';
      previousNumber = number;
      return `${gap}<button type="button" class="${number === page ? 'is-active' : ''}" data-page="${number}" aria-label="第 ${number} 页">${number}</button>`;
    })
    .join('');

  els.paginationBar.innerHTML = `
    <div class="pagination-summary">共 ${total} 条，每页 ${pagination.pageSize} 条，当前 ${start}-${end} 条</div>
    <div class="pagination-actions">
      <button type="button" data-page="${page - 1}" ${pagination.hasPrev ? '' : 'disabled'}>上一页</button>
      ${numberButtons}
      <button type="button" data-page="${page + 1}" ${pagination.hasNext ? '' : 'disabled'}>下一页</button>
      <span class="pagination-summary">第 ${page} / ${totalPages} 页</span>
    </div>`;
}

function setUploadProgress({ text, detail, badge, percent, indeterminate = false }) {
  els.uploadProgressText.textContent = text;
  els.uploadProgressDetail.textContent = detail;
  els.uploadProgressBadge.textContent = badge;
  els.uploadProgressCard.classList.toggle('is-indeterminate', indeterminate);
  if (!indeterminate) els.uploadProgressBar.style.width = `${Math.min(Math.max(percent, 0), 100)}%`;
}

function setUploadActions({ confirmDisabled = true, cancelDisabled = false, confirmText = '确认入库' } = {}) {
  els.confirmUpload.disabled = confirmDisabled;
  els.confirmUpload.textContent = confirmText;
  els.cancelUpload.disabled = cancelDisabled;
}

function resetUploadDialog() {
  stagedUpload = null;
  els.uploadReview.hidden = true;
  els.uploadReviewRows.innerHTML = '';
  els.uploadFooterNote.textContent = '暂存文件不会出现在前台和列表里。';
  setUploadProgress({
    text: '等待上传',
    detail: '选择文件后开始上传和解析',
    badge: '准备',
    percent: 0,
  });
  setUploadActions();
}

function uploadSummary(upload) {
  const documents = upload.documents || [];
  return [
    ...Object.entries(managedTypeMeta).map(([type, meta]) => {
      const count = documents.filter((item) => item.fileType === type).length;
      return count ? `${count} 个 ${meta.label}` : '';
    }),
    upload.assetCount ? `${upload.assetCount} 个附件` : '',
  ]
    .filter(Boolean)
    .join('，');
}

function renderUploadReview(upload) {
  const documents = upload.documents || [];
  els.uploadReview.hidden = false;
  els.uploadReviewCount.textContent = `${documents.length} 个文档`;
  els.uploadReviewSummary.textContent = upload.assetCount
    ? `另有 ${upload.assetCount} 个附件会随目录同步，确认后生成正式 URL`
    : '确认后生成正式 URL，并写入文档列表和数据库';
  els.uploadReviewRows.innerHTML = documents
    .map(
      (item) => `<div class="upload-review-row" data-upload-doc-id="${escapeHtml(item.id)}">
        <div class="upload-review-type">
          <span class="badge ${fileTypeBadgeClassFromType(item.fileType)}">${fileTypeLabelFromType(item.fileType)}</span>
          <span title="${escapeHtml(item.relativePath || item.fileName)}">${escapeHtml(item.directoryName || '无目录')}</span>
        </div>
        <label class="field">
          <span>页面标题</span>
          <input data-upload-field="title" value="${escapeHtml(item.title || '')}" placeholder="展示在列表和前台的标题" />
        </label>
        <label class="field">
          <span>文件名称</span>
          <input data-upload-field="fileName" value="${escapeHtml(item.fileName || '')}" placeholder="生成文件名和列表副标题" />
        </label>
        <label class="field">
          <span>可见性</span>
          <select data-upload-field="visibility">
            <option value="public" ${(item.visibility || 'public') === 'public' ? 'selected' : ''}>公开</option>
            <option value="private" ${item.visibility === 'private' ? 'selected' : ''}>仅自己可见</option>
          </select>
        </label>
      </div>`,
    )
    .join('');
  els.uploadFooterNote.textContent = '确认后才会写入数据库；取消会清理本次暂存文件。';
  setUploadActions({ confirmDisabled: false });
}

function uploadReviewDocuments() {
  return Array.from(els.uploadReviewRows.querySelectorAll('[data-upload-doc-id]')).map((row) => ({
    id: row.dataset.uploadDocId,
    title: row.querySelector('[data-upload-field="title"]').value.trim(),
    fileName: row.querySelector('[data-upload-field="fileName"]').value.trim(),
    visibility: row.querySelector('[data-upload-field="visibility"]').value,
  }));
}

function uploadWithProgress(form) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    activeUploadRequest = xhr;
    xhr.open('POST', apiUrl('/api/pages/upload/prepare'));
    xhr.withCredentials = true;
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        const percent = Math.min(92, Math.max(8, Math.round((event.loaded / event.total) * 92)));
        setUploadProgress({
          text: '正在上传文件',
          detail: `${formatSize(event.loaded)} / ${formatSize(event.total)}`,
          badge: `${percent}%`,
          percent,
        });
      } else {
        setUploadProgress({
          text: '正在上传文件',
          detail: '浏览器未返回总大小，保持上传中状态',
          badge: '上传中',
          percent: 0,
          indeterminate: true,
        });
      }
    });
    xhr.addEventListener('load', () => {
      activeUploadRequest = null;
      let data = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = xhr.responseText;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data || {});
        return;
      }
      const message = typeof data === 'object' ? data.error : data;
      if (xhr.status === 401) showLogin();
      reject(new Error(message || `上传失败：${xhr.status}`));
    });
    xhr.addEventListener('error', () => {
      activeUploadRequest = null;
      reject(new Error('上传连接失败'));
    });
    xhr.addEventListener('abort', () => {
      activeUploadRequest = null;
      reject(new Error('上传已取消'));
    });
    xhr.send(form);
  });
}

async function uploadFiles(files) {
  const fileList = Array.from(files || []);
  const hasDirectoryContext = fileList.some((file) => file.webkitRelativePath);
  const uploadableFiles = hasDirectoryContext ? fileList : fileList.filter((file) => supportedFilePattern.test(file.name));
  const supportedFiles = uploadableFiles.filter((file) => supportedFilePattern.test(file.webkitRelativePath || file.name));
  if (!supportedFiles.length) {
    showToast('没有检测到 HTML、Markdown、PDF、Word、PPT、Keynote 或 Excel 文件');
    return;
  }
  uploadCancelRequested = false;
  resetUploadDialog();
  openLayer(els.uploadBackdrop);
  setUploadProgress({
    text: '正在准备上传',
    detail: `共 ${supportedFiles.length} 个可管理文档，${Math.max(0, uploadableFiles.length - supportedFiles.length)} 个附件`,
    badge: '准备',
    percent: 6,
  });
  const form = new FormData();
  uploadableFiles.forEach((file) => {
    form.append('relativePath', file.webkitRelativePath || file.name);
    form.append('files', file, file.name);
  });
  try {
    const result = await uploadWithProgress(form);
    stagedUpload = result;
    setUploadProgress({
      text: '上传解析完成',
      detail: uploadSummary(result) || `${supportedFiles.length} 个文档待确认`,
      badge: '待确认',
      percent: 100,
    });
    renderUploadReview(result);
    showToast('请确认文档名称后入库');
  } catch (error) {
    if (uploadCancelRequested) return;
    setUploadProgress({
      text: '上传失败',
      detail: error.message || '请重新选择文件上传',
      badge: '失败',
      percent: 100,
    });
    setUploadActions({ confirmDisabled: true });
    showToast(error.message);
  }
}

async function cancelUploadDialog() {
  uploadCancelRequested = true;
  if (activeUploadRequest) activeUploadRequest.abort();
  if (stagedUpload?.uploadId) {
    await api(`/api/pages/upload/${encodeURIComponent(stagedUpload.uploadId)}`, { method: 'DELETE' }).catch(() => {});
  }
  resetUploadDialog();
  closeLayer(els.uploadBackdrop);
}

async function confirmUploadDialog() {
  if (!stagedUpload?.uploadId) return;
  setUploadActions({ confirmDisabled: true, cancelDisabled: true, confirmText: '生成中' });
  setUploadProgress({
    text: '正在生成 URL',
    detail: '写入 pages 目录和数据库，Markdown、Word 和 Excel 会生成阅读页，PPT 与 Keynote 文档会同步转换为 PDF',
    badge: '生成中',
    percent: 0,
    indeterminate: true,
  });
  try {
    const result = await api(`/api/pages/upload/${encodeURIComponent(stagedUpload.uploadId)}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documents: uploadReviewDocuments() }),
    });
    stagedUpload = null;
    await resetToFirstPage();
    closeLayer(els.uploadBackdrop);
    resetUploadDialog();
    showToast(`已入库 ${result.pages?.length || 0} 个文档`);
  } catch (error) {
    setUploadProgress({
      text: '入库失败',
      detail: error.message || '请检查文件后重试',
      badge: '失败',
      percent: 100,
    });
    setUploadActions({ confirmDisabled: false });
    showToast(error.message);
  }
}

async function addSamples() {
  const result = await api('/api/pages/samples', { method: 'POST' });
  pages = [...(result.pages || []), ...pages];
  await resetToFirstPage();
  showToast('已添加示例页面');
}

function openPreview(id) {
  const page = findPage(id);
  if (!page) return;
  currentPageId = id;
  document.querySelector('#previewTitle').textContent = page.title;
  document.querySelector('#previewUrl').textContent = pageUrl(page);
  document.querySelector('#metaFileName').textContent = page.fileName;
  document.querySelector('#metaTitle').textContent = page.title;
  document.querySelector('#metaFileType').textContent = fileTypeLabel(page);
  document.querySelector('#metaVisibility').textContent = isPrivatePage(page) ? '仅自己可见' : '公开';
  document.querySelector('#metaUploadTime').textContent = page.uploadTime || page.updatedTime || '-';
  document.querySelector('#metaUrl').textContent = pageUrl(page);
  document.querySelector('#editFromPreview').hidden = !isEditablePage(page);
  els.previewFrame.title = isEditablePage(page) ? '可编辑文档预览' : '文档阅读器';
  els.previewFrame.removeAttribute('srcdoc');
  els.previewFrame.src = pageUrl(page);
  openLayer(els.previewBackdrop);
}

function openEditor(id) {
  const page = findPage(id);
  if (!page) return;
  const url = editUrl(page);
  if (!url) {
    showToast('只有 HTML、Markdown 和 Word 页面支持在线编辑');
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function copyUrl(id = currentPageId) {
  const page = findPage(id);
  if (!page) return;
  const url = `${window.location.origin}${pageUrl(page)}`;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(
      () => showToast('已复制本地 URL'),
      () => showToast(url),
    );
  } else {
    showToast(url);
  }
}

function openGenerated(id) {
  const page = findPage(id);
  if (!page) return;
  window.open(pageUrl(page), '_blank', 'noopener,noreferrer');
}

async function downloadPage(id) {
  const page = findPage(id);
  if (!page) return;
  const response = await fetch(apiUrl(`/api/pages/${encodeURIComponent(id)}/download`), { credentials: 'same-origin' });
  if (!response.ok) {
    if (response.status === 401) showLogin();
    throw new Error(`下载失败：${response.status}`);
  }
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filenameFromDisposition(response.headers.get('content-disposition')) || page.fileName || page.slug || 'document';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  pages = pages.map((item) =>
    item.id === id ? { ...item, downloadCount: Number(item.downloadCount || 0) + 1 } : item,
  );
  render();
  showToast('已开始下载');
}

async function deletePage(id) {
  await api(`/api/pages/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await loadData();
  showToast('已移入回收站');
}

async function restorePage(id) {
  await api(`/api/pages/${encodeURIComponent(id)}/restore`, { method: 'POST' });
  await loadData();
  showToast('已恢复展示');
}

async function syncPage(id) {
  const page = findPage(id);
  if (page && !isHtmlPage(page)) {
    showToast('只有 HTML 页面支持上传线上');
    return;
  }
  if (!settings.remoteSyncEnabled || !settings.remoteSyncUrl) {
    showToast('请先在设置里绑定线上程序');
    window.setTimeout(() => {
      window.location.href = settingsUrl();
    }, 500);
    return;
  }
  await api(`/api/pages/${encodeURIComponent(id)}/sync`, { method: 'POST' });
  showToast('已上传到线上程序');
}

async function updateVisibility(id, visibility) {
  const page = findPage(id);
  const nextVisibility = visibility === 'private' ? 'private' : 'public';
  await api(`/api/pages/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ visibility: nextVisibility }),
  });
  await loadData();
  showToast(`${page?.title || '文档'}已设为${nextVisibility === 'private' ? '仅自己可见' : '公开'}`);
}

async function saveSettings() {
  const previousAdminPath = adminBasePath;
  const watchPath = document.querySelector('#watchDirInput').value.trim();
  const shouldAddWatchPath = watchPath && !hasWatchDirectory(watchPath);
  const siteName = els.siteNameInput?.value.trim() || defaultSettings.siteName;
  const adminName = els.adminNameInput?.value.trim() || defaultSettings.adminName;
  const publicSeoTitle = els.publicSeoTitleInput?.value.trim() || siteName;
  const publicSeoDescription = els.publicSeoDescriptionInput?.value.trim() || defaultSettings.publicSeoDescription;
  const publicSeoKeywords = els.publicSeoKeywordsInput?.value.trim() || defaultSettings.publicSeoKeywords;
  const trackingCode = els.trackingCodeInput?.value || '';
  const remoteSyncEnabled = Boolean(els.remoteSyncEnabledInput?.checked);
  const remoteSyncUrl = els.remoteSyncUrlInput?.value.trim() || '';
  const remoteSyncToken = els.remoteSyncTokenInput?.value || '';
  const authUsername = els.authUsernameInput?.value.trim() || 'admin';
  const authPassword = els.authPasswordInput?.value || '';
  const adminPath = normalizeAdminPath(els.adminPathInput?.value || '/admin');
  const publicHomepageEnabled = els.publicHomepageEnabledInput ? els.publicHomepageEnabledInput.checked : true;
  const currentPassword = els.currentPasswordInput?.value || '';
  const settingsResult = await api('/api/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      siteName,
      adminName,
      publicSeoTitle,
      publicSeoDescription,
      publicSeoKeywords,
      trackingCode,
      authUsername,
      authPassword,
      adminPath,
      publicHomepageEnabled,
      currentPassword,
      remoteSyncEnabled,
      remoteSyncUrl,
      remoteSyncToken,
    }),
  });
  applySettings(settingsResult.settings || settings);
  renderShell();
  session = { authenticated: true, username: settings.authUsername || authUsername };
  if (shouldAddWatchPath) {
    await api('/api/watch-dirs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: watchPath, name: watchPath.split('/').filter(Boolean).at(-1) || 'html-inbox' }),
    });
  }
  await loadData();
  if (els.authPasswordInput) els.authPasswordInput.value = '';
  if (els.currentPasswordInput) els.currentPasswordInput.value = '';
  if (els.remoteSyncTokenInput) els.remoteSyncTokenInput.value = '';
  showToast(adminBasePath !== previousAdminPath ? `后台地址已更新：${adminBasePath}` : shouldAddWatchPath ? '设置已保存，监听目录已扫描' : '设置已保存');
  const nextPath = isSettingsPage ? settingsUrl() : managerUrl();
  if (adminBasePath !== previousAdminPath && normalizedPath(window.location.pathname) !== nextPath) {
    window.setTimeout(() => {
      window.location.href = nextPath;
    }, 700);
  }
}

function showLogin(message = '') {
  els.loginBackdrop.classList.add('is-open');
  els.loginBackdrop.setAttribute('aria-hidden', 'false');
  els.loginError.textContent = message;
  if (!els.loginUsername.value) els.loginUsername.value = settings.authUsername || 'admin';
  window.setTimeout(() => els.loginPassword.focus(), 50);
}

function hideLogin() {
  els.loginBackdrop.classList.remove('is-open');
  els.loginBackdrop.setAttribute('aria-hidden', 'true');
  els.loginError.textContent = '';
  els.loginPassword.value = '';
}

async function login(event) {
  event.preventDefault();
  const username = els.loginUsername.value.trim();
  const password = els.loginPassword.value;
  try {
    const result = await api('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    session = { authenticated: true, username: result.username || username };
    hideLogin();
    await loadData();
  } catch (error) {
    showLogin(error.message || '登录失败');
  }
}

async function logout() {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  session = { authenticated: false, username: '' };
  showLogin();
}

async function bootstrap() {
  applyView();
  const result = await api('/api/session');
  if (result.publicSettings) {
    applySettings(result.publicSettings);
    renderShell();
  }
  session = { authenticated: Boolean(result.authenticated), username: result.username || '' };
  if (!session.authenticated) {
    showLogin();
    return;
  }
  hideLogin();
  await loadData();
}

function openLayer(layer) {
  layer.classList.add('is-open');
  layer.setAttribute('aria-hidden', 'false');
}

function closeLayer(layer) {
  layer.classList.remove('is-open');
  layer.setAttribute('aria-hidden', 'true');
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  els.toast.innerHTML = `<span class="status-dot" style="color:var(--green)"></span><span>${escapeHtml(message)}</span>`;
  els.toast.classList.add('is-open');
  toastTimer = window.setTimeout(() => els.toast.classList.remove('is-open'), 2200);
}

document.querySelector('#pickFiles').addEventListener('click', () => els.fileInput.click());
document.querySelector('#pickDirectory').addEventListener('click', () => els.directoryInput.click());
document.querySelector('#addWatchDirectory')?.addEventListener('click', () => {
  document.querySelector('#watchDirInput')?.focus();
  showToast('填写目录后保存即可导入监听');
});
document.querySelector('#addSample').addEventListener('click', () => addSamples().catch((error) => showToast(error.message)));
document.querySelector('#refreshList').addEventListener('click', () => loadData().then(() => showToast('列表已刷新')));

els.fileInput.addEventListener('change', (event) => {
  uploadFiles(event.target.files).catch((error) => showToast(error.message));
  event.target.value = '';
});
els.directoryInput.addEventListener('change', (event) => {
  uploadFiles(event.target.files).catch((error) => showToast(error.message));
  event.target.value = '';
});
els.search.addEventListener('input', () => resetToFirstPage({ preserveScroll: true }).catch((error) => showToast(error.message)));

if (els.typeTabs) {
  els.typeTabs.querySelectorAll('[data-type]').forEach((button) => {
    button.addEventListener('click', () => {
      if (activeType === (button.dataset.type || 'all')) return;
      activeType = button.dataset.type || 'all';
      renderTypeTabs();
      resetToFirstPage({ preserveScroll: true }).catch((error) => showToast(error.message));
    });
  });
}

if (els.typeTabs) {
  els.typeTabs.addEventListener('keydown', (event) => {
    const current = event.target.closest('[data-type]');
    if (!current || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(els.typeTabs.querySelectorAll('[data-type]'));
    const currentIndex = buttons.indexOf(current);
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const next = buttons[(currentIndex + offset + buttons.length) % buttons.length];
    next.focus({ preventScroll: true });
    activeType = next.dataset.type || 'all';
    renderTypeTabs();
    resetToFirstPage({ preserveScroll: true }).catch((error) => showToast(error.message));
  });
}

els.dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  els.dropZone.classList.add('is-dragging');
});
els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('is-dragging'));
els.dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  els.dropZone.classList.remove('is-dragging');
  uploadFiles(event.dataTransfer.files).catch((error) => showToast(error.message));
});

document.querySelectorAll('[data-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    if (activeFilter === button.dataset.filter) return;
    document.querySelectorAll('[data-filter]').forEach((item) => item.classList.remove('is-active'));
    button.classList.add('is-active');
    activeFilter = button.dataset.filter;
    resetToFirstPage({ preserveScroll: true }).catch((error) => showToast(error.message));
  });
});

els.paginationBar.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-page]');
  if (!button || button.disabled) return;
  setPage(button.dataset.page).catch((error) => showToast(error.message));
});

els.rows.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === 'preview') openPreview(id);
  if (action === 'edit') openEditor(id);
  if (action === 'copy') copyUrl(id);
  if (action === 'download') downloadPage(id).catch((error) => showToast(error.message));
  if (action === 'open') openGenerated(id);
  if (action === 'delete') deletePage(id).catch((error) => showToast(error.message));
  if (action === 'restore') restorePage(id).catch((error) => showToast(error.message));
  if (action === 'sync') syncPage(id).catch((error) => showToast(error.message));
  if (action === 'visibility') updateVisibility(id, button.dataset.visibility).catch((error) => showToast(error.message));
});

els.watchList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-watch-action]');
  if (!button) return;
  const { watchAction, id } = button.dataset;
  try {
    if (watchAction === 'remove') {
      await api(`/api/watch-dirs/${encodeURIComponent(id)}`, { method: 'DELETE' });
      showToast('已移除监听目录');
    }
    if (watchAction === 'rescan') {
      await api(`/api/watch-dirs/${encodeURIComponent(id)}/rescan`, { method: 'POST' });
      showToast('已重新扫描目录');
    }
    await loadData();
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector('#openSettings').addEventListener('click', (event) => {
  event.preventDefault();
  window.location.href = settingsUrl();
});
document.querySelector('#openSettingsSide')?.addEventListener('click', () => {
  document.querySelector('#watchDirInput')?.focus();
  showToast('目录策略已在当前设置页');
});
document.querySelector('#saveSettings').addEventListener('click', () => saveSettings().catch((error) => showToast(error.message)));
els.saveSettingsTop?.addEventListener('click', () => saveSettings().catch((error) => showToast(error.message)));
els.loginForm.addEventListener('submit', (event) => login(event));
els.logoutButton.addEventListener('click', () => logout().catch((error) => showToast(error.message)));

document.querySelector('#closeUpload').addEventListener('click', () => cancelUploadDialog().catch((error) => showToast(error.message)));
els.cancelUpload.addEventListener('click', () => cancelUploadDialog().catch((error) => showToast(error.message)));
els.confirmUpload.addEventListener('click', () => confirmUploadDialog().catch((error) => showToast(error.message)));
document.querySelector('#closePreview').addEventListener('click', () => closeLayer(els.previewBackdrop));
document.querySelector('#editFromPreview').addEventListener('click', () => openEditor(currentPageId));
document.querySelector('#copyFromPreview').addEventListener('click', () => copyUrl(currentPageId));

[els.uploadBackdrop, els.previewBackdrop].forEach((layer) => {
  layer.addEventListener('click', (event) => {
    if (layer === els.uploadBackdrop && event.target === layer) {
      cancelUploadDialog().catch((error) => showToast(error.message));
      return;
    }
    if (event.target === layer) closeLayer(layer);
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (els.uploadBackdrop.classList.contains('is-open')) {
    cancelUploadDialog().catch((error) => showToast(error.message));
    return;
  }
  [els.previewBackdrop].forEach(closeLayer);
});

bootstrap().catch((error) => showToast(error.message));
