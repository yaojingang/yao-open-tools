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
  trash:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path></svg>',
  restore:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-15-6.7L3 13"></path></svg>',
  cloudUpload:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 13v8"></path><path d="m16 17-4-4-4 4"></path><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"></path><path d="M16 16h2a4 4 0 0 0 0-8h-.2"></path></svg>',
};

let pages = [];
let watchDirectories = [];
let settings = { trackingCode: '', authUsername: 'admin', remoteSyncEnabled: false, remoteSyncUrl: '', remoteSyncHasToken: false };
let session = { authenticated: false, username: '' };
let activeFilter = 'all';
let currentPageId = null;
let toastTimer = null;
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
  watchList: document.querySelector('#watchList'),
  search: document.querySelector('#searchInput'),
  fileInput: document.querySelector('#fileInput'),
  directoryInput: document.querySelector('#directoryInput'),
  dropZone: document.querySelector('#dropZone'),
  settingsBackdrop: document.querySelector('#settingsBackdrop'),
  previewBackdrop: document.querySelector('#previewBackdrop'),
  previewFrame: document.querySelector('#previewFrame'),
  trackingCodeInput: document.querySelector('#trackingCodeInput'),
  remoteSyncEnabledInput: document.querySelector('#remoteSyncEnabledInput'),
  remoteSyncUrlInput: document.querySelector('#remoteSyncUrlInput'),
  remoteSyncTokenInput: document.querySelector('#remoteSyncTokenInput'),
  authUsernameInput: document.querySelector('#authUsernameInput'),
  authPasswordInput: document.querySelector('#authPasswordInput'),
  authUserLabel: document.querySelector('#authUserLabel'),
  logoutButton: document.querySelector('#logoutButton'),
  loginBackdrop: document.querySelector('#loginBackdrop'),
  loginForm: document.querySelector('#loginForm'),
  loginUsername: document.querySelector('#loginUsername'),
  loginPassword: document.querySelector('#loginPassword'),
  loginError: document.querySelector('#loginError'),
  toast: document.querySelector('#toast'),
};

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
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

function fileTypeLabel(page) {
  const type = fileType(page);
  if (type === 'pdf') return 'PDF';
  if (type === 'word') return 'Word';
  return 'HTML';
}

function fileTypeBadgeClass(page) {
  const type = fileType(page);
  if (type === 'pdf') return 'badge-warning';
  if (type === 'word') return 'badge-violet';
  return 'badge-success';
}

function pageUrl(page) {
  return page.url || `/${page.slug}`;
}

function editUrl(page) {
  if (!isHtmlPage(page)) return '';
  return page.editUrl || `${pageUrl(page)}?edit=1`;
}

function findPage(id) {
  return pages.find((page) => page.id === id);
}

async function loadData() {
  if (!session.authenticated) return;
  const params = new URLSearchParams({
    page: String(pagination.page),
    pageSize: String(pagination.pageSize),
  });
  const keyword = els.search.value.trim();
  if (keyword) params.set('q', keyword);
  if (activeFilter === 'trash') {
    params.set('scope', 'trash');
  } else if (activeFilter !== 'all') {
    params.set('status', activeFilter);
  }
  const [pageData, watchData, settingsData] = await Promise.all([
    api(`/api/pages?${params.toString()}`),
    api('/api/watch-dirs'),
    api('/api/settings'),
  ]);
  pages = pageData.pages || [];
  pagination = { ...pagination, ...(pageData.pagination || {}) };
  watchDirectories = watchData.watchDirs || [];
  settings = settingsData.settings || { trackingCode: '', authUsername: 'admin', remoteSyncEnabled: false, remoteSyncUrl: '', remoteSyncHasToken: false };
  render();
}

function setPage(nextPage) {
  pagination.page = Math.min(Math.max(Number(nextPage) || 1, 1), pagination.totalPages || 1);
  return loadData();
}

function resetToFirstPage() {
  pagination.page = 1;
  return loadData();
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
  if (els.trackingCodeInput && document.activeElement !== els.trackingCodeInput) {
    els.trackingCodeInput.value = settings.trackingCode || '';
  }
  if (els.authUsernameInput && document.activeElement !== els.authUsernameInput) {
    els.authUsernameInput.value = settings.authUsername || 'admin';
  }
  if (els.authPasswordInput && document.activeElement !== els.authPasswordInput) {
    els.authPasswordInput.value = '';
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

function render() {
  renderWatchDirectories();
  renderSettings();
  els.rows.innerHTML = pages
    .map((page, index) => {
      const trashed = Boolean(page.deletedAt);
      const missing = page.status === 'missing';
      const statusClass = trashed || missing ? 'badge-warning' : page.edited ? 'badge-violet' : 'badge-success';
      const statusText = trashed ? '回收站' : missing ? '源文件缺失' : page.edited ? '已编辑' : '已生成';
      const editButton = isHtmlPage(page)
        ? `<button class="btn icon-btn" type="button" title="直接编辑" aria-label="直接编辑" data-action="edit" data-id="${page.id}">${icons.edit}</button>`
        : '';
      const syncButton = isHtmlPage(page)
        ? `<button class="btn icon-btn" type="button" title="上传线上" aria-label="上传线上" data-action="sync" data-id="${page.id}">${icons.cloudUpload}</button>`
        : '';
      const rowActions = trashed
        ? `<button class="btn" type="button" title="恢复展示" aria-label="恢复展示" data-action="restore" data-id="${page.id}">${icons.restore} 恢复</button>`
        : `<button class="btn icon-btn" type="button" title="${isHtmlPage(page) ? '预览' : '阅读'}" aria-label="${isHtmlPage(page) ? '预览' : '阅读'}" data-action="preview" data-id="${page.id}">${icons.eye}</button>
            ${editButton}
            <button class="btn icon-btn" type="button" title="复制 URL" aria-label="复制 URL" data-action="copy" data-id="${page.id}">${icons.copy}</button>
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
        <td><span class="badge ${fileTypeBadgeClass(page)}">${fileTypeLabel(page)}</span></td>
        <td>${escapeHtml(page.uploadTime || page.updatedTime || '-')}</td>
        <td><span class="size-cell">${escapeHtml(formatSize(page.size))}</span></td>
        <td><span class="directory-cell" title="${escapeHtml(page.directoryName || '无目录')}">${escapeHtml(page.directoryName || '-')}</span></td>
        <td><span class="access-cell">${Number(page.accessCount || 0)}</span></td>
        <td><span class="badge ${statusClass}"><span class="status-dot"></span>${statusText}</span></td>
        <td>
          <div class="actions">
            ${rowActions}
          </div>
        </td>
      </tr>`;
    })
    .join('');

  if (!pages.length) {
    const emptyText = activeFilter === 'trash' ? '回收站为空' : '暂无匹配页面';
    els.rows.innerHTML = `<tr><td colspan="9" style="height:120px;text-align:center;color:var(--muted)">${emptyText}</td></tr>`;
  }

  renderPagination();
  document.querySelector('#metricPages').textContent = pagination.total;
  document.querySelector('#metricEditable').textContent = pages.filter((page) => isHtmlPage(page) && page.status !== 'missing').length;
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

async function uploadFiles(files) {
  const fileList = Array.from(files || []);
  const hasDirectoryContext = fileList.some((file) => file.webkitRelativePath);
  const supportedPattern = /\.(html?|pdf|docx?)$/i;
  const uploadableFiles = hasDirectoryContext ? fileList : fileList.filter((file) => supportedPattern.test(file.name));
  const supportedFiles = uploadableFiles.filter((file) => supportedPattern.test(file.webkitRelativePath || file.name));
  const htmlCount = supportedFiles.filter((file) => /\.html?$/i.test(file.webkitRelativePath || file.name)).length;
  const pdfCount = supportedFiles.filter((file) => /\.pdf$/i.test(file.webkitRelativePath || file.name)).length;
  const wordCount = supportedFiles.filter((file) => /\.(doc|docx)$/i.test(file.webkitRelativePath || file.name)).length;
  if (!supportedFiles.length) {
    showToast('没有检测到 HTML、PDF 或 Word 文件');
    return;
  }
  const form = new FormData();
  uploadableFiles.forEach((file) => {
    form.append('relativePath', file.webkitRelativePath || file.name);
    form.append('files', file, file.name);
  });
  const result = await api('/api/pages/upload', { method: 'POST', body: form });
  pages = [...(result.pages || []), ...pages];
  await resetToFirstPage();
  const assetCount = Math.max(0, uploadableFiles.length - supportedFiles.length);
  const typeParts = [
    htmlCount ? `${htmlCount} 个 HTML` : '',
    pdfCount ? `${pdfCount} 个 PDF` : '',
    wordCount ? `${wordCount} 个 Word` : '',
  ].filter(Boolean);
  showToast(assetCount ? `已导入 ${result.pages.length} 个文档，并同步 ${assetCount} 个附件` : `已导入 ${result.pages.length} 个文档：${typeParts.join('、')}`);
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
  document.querySelector('#metaUploadTime').textContent = page.uploadTime || page.updatedTime || '-';
  document.querySelector('#metaUrl').textContent = pageUrl(page);
  document.querySelector('#editFromPreview').hidden = !isHtmlPage(page);
  els.previewFrame.title = isHtmlPage(page) ? 'HTML 页面预览' : '文档阅读器';
  els.previewFrame.removeAttribute('srcdoc');
  els.previewFrame.src = pageUrl(page);
  openLayer(els.previewBackdrop);
}

function openEditor(id) {
  const page = findPage(id);
  if (!page) return;
  const url = editUrl(page);
  if (!url) {
    showToast('PDF 和 Word 文档暂不支持在线编辑');
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
    openLayer(els.settingsBackdrop);
    showToast('请先在设置里绑定线上程序');
    return;
  }
  await api(`/api/pages/${encodeURIComponent(id)}/sync`, { method: 'POST' });
  showToast('已上传到线上程序');
}

async function saveSettings() {
  const watchPath = document.querySelector('#watchDirInput').value.trim();
  const trackingCode = els.trackingCodeInput?.value || '';
  const remoteSyncEnabled = Boolean(els.remoteSyncEnabledInput?.checked);
  const remoteSyncUrl = els.remoteSyncUrlInput?.value.trim() || '';
  const remoteSyncToken = els.remoteSyncTokenInput?.value || '';
  const authUsername = els.authUsernameInput?.value.trim() || 'admin';
  const authPassword = els.authPasswordInput?.value || '';
  const settingsResult = await api('/api/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ trackingCode, authUsername, authPassword, remoteSyncEnabled, remoteSyncUrl, remoteSyncToken }),
  });
  settings = settingsResult.settings || settings;
  session = { authenticated: true, username: settings.authUsername || authUsername };
  if (watchPath) {
    await api('/api/watch-dirs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: watchPath, name: watchPath.split('/').filter(Boolean).at(-1) || 'html-inbox' }),
    });
  }
  await loadData();
  closeLayer(els.settingsBackdrop);
  if (els.authPasswordInput) els.authPasswordInput.value = '';
  if (els.remoteSyncTokenInput) els.remoteSyncTokenInput.value = '';
  showToast(watchPath ? '设置已保存，监听目录已扫描' : '设置已保存');
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
  const result = await api('/api/session');
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
document.querySelector('#addWatchDirectory')?.addEventListener('click', () => openLayer(els.settingsBackdrop));
document.querySelector('#addSample').addEventListener('click', () => addSamples().catch((error) => showToast(error.message)));
document.querySelector('#refreshList').addEventListener('click', () => loadData().then(() => showToast('列表已刷新')));

els.fileInput.addEventListener('change', (event) => uploadFiles(event.target.files).catch((error) => showToast(error.message)));
els.directoryInput.addEventListener('change', (event) => {
  uploadFiles(event.target.files).catch((error) => showToast(error.message));
  event.target.value = '';
});
els.search.addEventListener('input', () => resetToFirstPage().catch((error) => showToast(error.message)));

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
    document.querySelectorAll('[data-filter]').forEach((item) => item.classList.remove('is-active'));
    button.classList.add('is-active');
    activeFilter = button.dataset.filter;
    resetToFirstPage().catch((error) => showToast(error.message));
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
  if (action === 'open') openGenerated(id);
  if (action === 'delete') deletePage(id).catch((error) => showToast(error.message));
  if (action === 'restore') restorePage(id).catch((error) => showToast(error.message));
  if (action === 'sync') syncPage(id).catch((error) => showToast(error.message));
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

document.querySelector('#openSettings').addEventListener('click', () => openLayer(els.settingsBackdrop));
document.querySelector('#openSettingsSide')?.addEventListener('click', () => openLayer(els.settingsBackdrop));
document.querySelector('#closeSettings').addEventListener('click', () => closeLayer(els.settingsBackdrop));
document.querySelector('#saveSettings').addEventListener('click', () => saveSettings().catch((error) => showToast(error.message)));
els.loginForm.addEventListener('submit', (event) => login(event));
els.logoutButton.addEventListener('click', () => logout().catch((error) => showToast(error.message)));

document.querySelector('#closePreview').addEventListener('click', () => closeLayer(els.previewBackdrop));
document.querySelector('#editFromPreview').addEventListener('click', () => openEditor(currentPageId));
document.querySelector('#copyFromPreview').addEventListener('click', () => copyUrl(currentPageId));

[els.settingsBackdrop, els.previewBackdrop].forEach((layer) => {
  layer.addEventListener('click', (event) => {
    if (event.target === layer) closeLayer(layer);
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  [els.settingsBackdrop, els.previewBackdrop].forEach(closeLayer);
});

bootstrap().catch((error) => showToast(error.message));
