import { escapeHtml } from './html.js';

export const editableElementSelector = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'td',
  'th',
  'blockquote',
  'figcaption',
  'caption',
  'dt',
  'dd',
  'summary',
  'label',
  'legend',
  'button',
  'a',
  'span',
  'strong',
  'em',
  'b',
  'i',
  'small',
  'div',
].join(',');

export const movableModuleSelector = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'blockquote',
  'figcaption',
  'caption',
  'dt',
  'dd',
  'summary',
  'label',
  'legend',
  'button',
  'a',
  'img',
  'picture',
  'video',
  'table',
  'section',
  'article',
  'header',
  'footer',
  'aside',
  'nav',
  'figure',
  'main > div',
  'body > div',
  '[data-section]',
  '[data-module]',
  '.section',
  '.module',
  '.card',
  '.panel',
  '.block',
  '.tile',
  '.feature',
  '.row',
  '.column',
].join(',');

function bridgeScript(page, adminPath = '/admin') {
  const adminBase = String(adminPath || '/admin').replace(/\/+$/g, '') || '/admin';
  return `
(function () {
  const adminBase = ${JSON.stringify(adminBase)};
  const saveEndpoint = ${JSON.stringify(`${adminBase}/api/pages/${encodeURIComponent(page.id)}/content`)};
  const sourceEndpoint = ${JSON.stringify(`${adminBase}/api/pages/${encodeURIComponent(page.id)}/source`)};
  const isMarkdownPage = ${JSON.stringify(page.fileType === 'markdown')};
  let revision = ${Number(page.revision)};
  let sourceRevision = revision;
  let saveTimer = null;
  let sourceSaveTimer = null;
  let sourceSaveInFlight = null;
  let sourceDirty = false;
  let sourceSaved = false;
  let freeDrag = null;
  let resizeDrag = null;
  let activeModule = null;
  const selectors = ${JSON.stringify(editableElementSelector)};
  const moduleSelectors = ${JSON.stringify(movableModuleSelector)};
  const ignoredSelector = '[data-tokdoc-bridge],[data-tokhtml-bridge],script,style,noscript,textarea,input,select,option,svg,canvas,iframe,video,audio';
  const moduleIgnoredSelector = '[data-tokdoc-bridge],[data-tokhtml-bridge],script,style,noscript,textarea,input,select,option';

  function setStatus(text, tone) {
    const status = document.querySelector('[data-tokdoc-status]');
    if (!status) return;
    status.textContent = text;
    status.dataset.tone = tone || 'idle';
  }

  function setSourceStatus(text, tone) {
    const status = document.querySelector('[data-tokdoc-source-status]');
    if (!status) return;
    status.textContent = text;
    status.dataset.tone = tone || 'idle';
  }

  function editableNodes() {
    const candidates = Array.from(document.body.querySelectorAll(selectors))
      .filter((node) => !node.closest('[data-tokdoc-bridge],[data-tokhtml-bridge]'))
      .filter((node) => !node.closest(ignoredSelector))
      .filter((node) => Array.from(node.childNodes).some((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim()));
    return candidates.reduce((selected, node) => {
      if (!selected.some((parent) => parent.contains(node))) selected.push(node);
      return selected;
    }, []);
  }

  function enableEditing() {
    editableNodes().forEach((node) => {
      node.setAttribute('contenteditable', 'true');
      node.setAttribute('data-tokdoc-editable', 'true');
      node.classList.add('tokdoc-editable');
    });
  }

  function ensurePositioningParent(node) {
    const parent = node.parentElement || document.body;
    const style = window.getComputedStyle(parent);
    if (style.position === 'static') parent.style.position = 'relative';
    return parent;
  }

  function relativePosition(node) {
    const parent = ensurePositioningParent(node);
    const rect = node.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    return {
      parent,
      left: rect.left - parentRect.left + parent.scrollLeft,
      top: rect.top - parentRect.top + parent.scrollTop,
      width: rect.width,
      height: rect.height,
    };
  }

  function placeNodeAt(node, left, top) {
    node.style.left = Math.round(left) + 'px';
    node.style.top = Math.round(top) + 'px';
  }

  function numericCssValue(value) {
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : 0;
  }

  function contentBoxAdjustment(node, axis) {
    const style = window.getComputedStyle(node);
    if (style.boxSizing === 'border-box') return 0;
    if (axis === 'x') {
      return numericCssValue(style.paddingLeft) + numericCssValue(style.paddingRight) + numericCssValue(style.borderLeftWidth) + numericCssValue(style.borderRightWidth);
    }
    return numericCssValue(style.paddingTop) + numericCssValue(style.paddingBottom) + numericCssValue(style.borderTopWidth) + numericCssValue(style.borderBottomWidth);
  }

  function styleWidthFromBorderBox(node, width) {
    return Math.max(0, Math.round(width - contentBoxAdjustment(node, 'x')));
  }

  function styleHeightFromBorderBox(node, height) {
    return Math.max(0, Math.round(height - contentBoxAdjustment(node, 'y')));
  }

  function startFreeDrag(node, handle, event) {
    event.preventDefault();
    event.stopPropagation();
    const position = relativePosition(node);
    node.style.position = 'absolute';
    node.style.right = 'auto';
    node.style.bottom = 'auto';
    if (!node.style.width) node.style.width = styleWidthFromBorderBox(node, position.width) + 'px';
    if (!node.style.zIndex) node.style.zIndex = '10';
    placeNodeAt(node, position.left, position.top);
    node.setAttribute('data-tokdoc-free-positioned', 'true');
    node.classList.add('tokdoc-module--free-positioned', 'tokdoc-module--free-dragging');
    freeDrag = {
      node,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: position.left,
      startTop: position.top,
      pointerId: event.pointerId,
      moved: false,
    };
    if (handle.setPointerCapture) handle.setPointerCapture(event.pointerId);
    setStatus('自由定位中', 'saving');
  }

  function prepareAbsoluteEdit(node) {
    const position = relativePosition(node);
    node.style.position = 'absolute';
    node.style.right = 'auto';
    node.style.bottom = 'auto';
    placeNodeAt(node, position.left, position.top);
    node.style.width = styleWidthFromBorderBox(node, position.width) + 'px';
    node.setAttribute('data-tokdoc-module', 'true');
    node.setAttribute('data-tokdoc-free-positioned', 'true');
    node.classList.add('tokdoc-draggable-module', 'tokdoc-module--free-positioned');
    return {
      left: position.left,
      top: position.top,
      width: position.width,
      height: position.height,
    };
  }

  function handleFreeDragMove(event) {
    if (!freeDrag) return;
    event.preventDefault();
    const left = freeDrag.startLeft + event.clientX - freeDrag.startX;
    const top = freeDrag.startTop + event.clientY - freeDrag.startY;
    placeNodeAt(freeDrag.node, left, top);
    freeDrag.moved = true;
  }

  function finishFreeDrag() {
    if (!freeDrag) return;
    const current = freeDrag;
    current.node.classList.remove('tokdoc-module--free-dragging');
    if (current.handle.releasePointerCapture && current.pointerId !== undefined) {
      try {
        current.handle.releasePointerCapture(current.pointerId);
      } catch {
        // Pointer capture can already be released by the browser.
      }
    }
    freeDrag = null;
    if (current.moved) scheduleSave();
  }

  function startResizeDrag(node, handle, event) {
    event.preventDefault();
    event.stopPropagation();
    const position = prepareAbsoluteEdit(node);
    node.style.height = styleHeightFromBorderBox(node, position.height) + 'px';
    node.classList.add('tokdoc-module--resizing');
    resizeDrag = {
      node,
      handle,
      direction: handle.dataset.tokdocResizeHandle,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: position.left,
      startTop: position.top,
      startWidth: position.width,
      startHeight: position.height,
      pointerId: event.pointerId,
      moved: false,
    };
    if (handle.setPointerCapture) handle.setPointerCapture(event.pointerId);
    setStatus('调整尺寸中', 'saving');
  }

  function handleResizeMove(event) {
    if (!resizeDrag) return;
    event.preventDefault();
    const minWidth = 24;
    const minHeight = 18;
    const direction = resizeDrag.direction || '';
    const dx = event.clientX - resizeDrag.startX;
    const dy = event.clientY - resizeDrag.startY;
    let left = resizeDrag.startLeft;
    let top = resizeDrag.startTop;
    let width = resizeDrag.startWidth;
    let height = resizeDrag.startHeight;
    if (direction.includes('right')) width = resizeDrag.startWidth + dx;
    if (direction.includes('bottom')) height = resizeDrag.startHeight + dy;
    if (direction.includes('left')) {
      width = resizeDrag.startWidth - dx;
      left = resizeDrag.startLeft + dx;
      if (width < minWidth) {
        left = resizeDrag.startLeft + resizeDrag.startWidth - minWidth;
        width = minWidth;
      }
    }
    if (direction.includes('top')) {
      height = resizeDrag.startHeight - dy;
      top = resizeDrag.startTop + dy;
      if (height < minHeight) {
        top = resizeDrag.startTop + resizeDrag.startHeight - minHeight;
        height = minHeight;
      }
    }
    width = Math.max(width, minWidth);
    height = Math.max(height, minHeight);
    placeNodeAt(resizeDrag.node, left, top);
    resizeDrag.node.style.width = styleWidthFromBorderBox(resizeDrag.node, width) + 'px';
    resizeDrag.node.style.height = styleHeightFromBorderBox(resizeDrag.node, height) + 'px';
    resizeDrag.moved = true;
    repositionModuleControls();
  }

  function finishResizeDrag() {
    if (!resizeDrag) return;
    const current = resizeDrag;
    current.node.classList.remove('tokdoc-module--resizing');
    if (current.handle.releasePointerCapture && current.pointerId !== undefined) {
      try {
        current.handle.releasePointerCapture(current.pointerId);
      } catch {
        // Pointer capture can already be released by the browser.
      }
    }
    resizeDrag = null;
    if (current.moved) scheduleSave();
  }

  function resetFreePosition(node) {
    node.removeAttribute('data-tokdoc-free-positioned');
    node.classList.remove('tokdoc-module--free-positioned', 'tokdoc-module--free-dragging', 'tokdoc-module--resizing');
    ['position', 'left', 'top', 'right', 'bottom', 'width', 'height', 'zIndex'].forEach((property) => {
      node.style[property] = '';
    });
    scheduleSave();
  }

  function validModule(node) {
    if (!node || node === document.body || node === document.documentElement) return false;
    if (!node.matches || !node.matches(moduleSelectors)) return false;
    if (node.closest('[data-tokdoc-bridge],[data-tokhtml-bridge]') || node.closest(moduleIgnoredSelector)) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width < 12 || rect.height < 12) return false;
    return !!(
      node.textContent.trim() ||
      node.matches('img,picture,video,canvas,svg,iframe,table') ||
      node.querySelector('img,picture,video,canvas,svg,iframe,table')
    );
  }

  function smallestModuleAt(x, y) {
    return (document.elementsFromPoint ? document.elementsFromPoint(x, y) : [])
      .filter(validModule)[0] || null;
  }

  function clearActiveModule() {
    if (activeModule) activeModule.classList.remove('tokdoc-adjustable-active');
    activeModule = null;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function positionModuleControls(node) {
    const handle = document.querySelector('[data-tokdoc-free-handle]');
    const resizeHandles = Array.from(document.querySelectorAll('[data-tokdoc-resize-handle]'));
    if (!handle || !node) return;
    const rect = node.getBoundingClientRect();
    const inset = 6;
    const margin = 8;
    const size = 30;
    const top = clamp(rect.top + inset, margin, window.innerHeight - size - margin);
    let left = rect.right - size - inset;
    let placement = 'inside-right';
    if (rect.width < size + inset * 2 || left < margin) {
      left = rect.left + inset;
      placement = 'inside-left';
    }
    if (rect.width < size + inset * 2 && rect.left + rect.width / 2 - size / 2 >= margin) {
      left = rect.left + rect.width / 2 - size / 2;
      placement = 'inside-center';
    }
    left = clamp(left, margin, window.innerWidth - size - margin);
    handle.style.left = Math.round(left) + 'px';
    handle.style.top = Math.round(top) + 'px';
    handle.dataset.placement = placement;
    resizeHandles.forEach((resizeHandle) => {
      const edge = 6;
      const direction = resizeHandle.dataset.tokdocResizeHandle;
      resizeHandle.hidden = false;
      if (direction === 'right') {
        resizeHandle.style.left = Math.round(clamp(rect.right - edge - inset, margin, window.innerWidth - edge - margin)) + 'px';
        resizeHandle.style.top = Math.round(clamp(rect.top + inset, margin, window.innerHeight - margin)) + 'px';
        resizeHandle.style.width = edge + 'px';
        resizeHandle.style.height = Math.max(14, Math.round(rect.height - inset * 2)) + 'px';
      }
      if (direction === 'left') {
        resizeHandle.style.left = Math.round(clamp(rect.left + inset, margin, window.innerWidth - edge - margin)) + 'px';
        resizeHandle.style.top = Math.round(clamp(rect.top + inset, margin, window.innerHeight - margin)) + 'px';
        resizeHandle.style.width = edge + 'px';
        resizeHandle.style.height = Math.max(14, Math.round(rect.height - inset * 2)) + 'px';
      }
      if (direction === 'bottom') {
        resizeHandle.style.left = Math.round(clamp(rect.left + inset, margin, window.innerWidth - margin)) + 'px';
        resizeHandle.style.top = Math.round(clamp(rect.bottom - edge - inset, margin, window.innerHeight - edge - margin)) + 'px';
        resizeHandle.style.width = Math.max(14, Math.round(rect.width - inset * 2)) + 'px';
        resizeHandle.style.height = edge + 'px';
      }
      if (direction === 'top') {
        resizeHandle.style.left = Math.round(clamp(rect.left + inset, margin, window.innerWidth - margin)) + 'px';
        resizeHandle.style.top = Math.round(clamp(rect.top + inset, margin, window.innerHeight - edge - margin)) + 'px';
        resizeHandle.style.width = Math.max(14, Math.round(rect.width - inset * 2)) + 'px';
        resizeHandle.style.height = edge + 'px';
      }
    });
  }

  function showModuleHandle(node) {
    const handle = document.querySelector('[data-tokdoc-free-handle]');
    if (!handle || !node) return;
    if (activeModule !== node) {
      clearActiveModule();
      activeModule = node;
      activeModule.classList.add('tokdoc-adjustable-active');
    }
    positionModuleControls(node);
    handle.hidden = false;
  }

  function handleModuleHover(event) {
    if (freeDrag || resizeDrag || (event.target && event.target.closest('[data-tokdoc-bridge],[data-tokhtml-bridge]'))) return;
    const node = smallestModuleAt(event.clientX, event.clientY);
    const handle = document.querySelector('[data-tokdoc-free-handle]');
    if (!node) {
      if (handle) handle.hidden = true;
      document.querySelectorAll('[data-tokdoc-resize-handle]').forEach((resizeHandle) => { resizeHandle.hidden = true; });
      clearActiveModule();
      return;
    }
    showModuleHandle(node);
  }

  function repositionModuleControls() {
    const handle = document.querySelector('[data-tokdoc-free-handle]');
    if (!handle || handle.hidden || !activeModule) return;
    positionModuleControls(activeModule);
  }

  function insetParts(value) {
    const parts = String(value || '').trim().split(/\\s+/).filter(Boolean);
    if (!parts.length) return {};
    return {
      top: parts[0],
      left: parts[3] || parts[1] || parts[0],
    };
  }

  function normalizeFreePositionedStyle(node) {
    if (node.style.position !== 'absolute') return;
    const fallback = insetParts(node.style.inset);
    const left = node.style.left || fallback.left;
    const top = node.style.top || fallback.top;
    if (!left || !top) return;
    const declarations = String(node.getAttribute('style') || '')
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => !/^(position|inset|left|top|right|bottom)\\s*:/i.test(item));
    node.setAttribute('style', ['position:absolute', 'left:' + left, 'top:' + top, ...declarations].join(';'));
  }

  function mountModuleHandle() {
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.hidden = true;
    handle.contentEditable = 'false';
    handle.className = 'tokdoc-module-handle';
    handle.setAttribute('data-tokdoc-bridge', 'drag-handle');
    handle.setAttribute('data-tokdoc-free-handle', 'true');
    handle.setAttribute('aria-label', '拖动调整当前模块');
    handle.title = '拖动调整当前模块；双击还原定位';
    handle.textContent = '↔';
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !activeModule) return;
      activeModule.setAttribute('data-tokdoc-module', 'true');
      activeModule.classList.add('tokdoc-draggable-module');
      startFreeDrag(activeModule, handle, event);
    });
    handle.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (activeModule) resetFreePosition(activeModule);
    });
    document.body.append(handle);
    ['top', 'right', 'bottom', 'left'].forEach((direction) => {
      const resizeHandle = document.createElement('span');
      resizeHandle.hidden = true;
      resizeHandle.contentEditable = 'false';
      resizeHandle.className = 'tokdoc-resize-handle tokdoc-resize-handle--' + direction;
      resizeHandle.setAttribute('data-tokdoc-bridge', 'resize-handle');
      resizeHandle.setAttribute('data-tokdoc-resize-handle', direction);
      resizeHandle.setAttribute('aria-hidden', 'true');
      resizeHandle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || !activeModule) return;
        startResizeDrag(activeModule, resizeHandle, event);
      });
      document.body.append(resizeHandle);
    });
  }

  function cleanHtmlSnapshot() {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('[data-tokdoc-bridge],[data-tokhtml-bridge]').forEach((node) => node.remove());
    clone.querySelectorAll('.tokdoc-adjustable-active,.tokhtml-adjustable-active').forEach((node) => {
      node.classList.remove('tokdoc-adjustable-active', 'tokhtml-adjustable-active');
    });
    clone.querySelectorAll('[data-tokdoc-module],[data-tokhtml-module]').forEach((node) => {
      normalizeFreePositionedStyle(node);
      node.removeAttribute('data-tokdoc-module');
      node.removeAttribute('data-tokdoc-free-positioned');
      node.removeAttribute('data-tokhtml-module');
      node.removeAttribute('data-tokhtml-free-positioned');
      node.removeAttribute('draggable');
      node.classList.remove('tokdoc-draggable-module', 'tokhtml-draggable-module');
      node.classList.remove('tokdoc-module--dragging', 'tokhtml-module--dragging');
      node.classList.remove('tokdoc-module--drop-target', 'tokhtml-module--drop-target');
      node.classList.remove('tokdoc-module--free-positioned', 'tokhtml-module--free-positioned');
      node.classList.remove('tokdoc-module--free-dragging', 'tokhtml-module--free-dragging');
      node.classList.remove('tokdoc-module--resizing', 'tokhtml-module--resizing');
    });
    clone.querySelectorAll('[data-tokdoc-editable],[data-tokhtml-editable]').forEach((node) => {
      node.removeAttribute('contenteditable');
      node.removeAttribute('data-tokdoc-editable');
      node.removeAttribute('data-tokhtml-editable');
      node.classList.remove('tokdoc-editable', 'tokhtml-editable');
    });
    return '<!doctype html>\\n' + clone.outerHTML;
  }

  async function saveNow(manual) {
    window.clearTimeout(saveTimer);
    setStatus('保存中', 'saving');
    const response = await fetch(saveEndpoint, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html: cleanHtmlSnapshot(), revision, reason: manual ? 'manual' : 'autosave' }),
    });
    if (response.status === 409) {
      setStatus('版本冲突，刷新后再改', 'error');
      return;
    }
    if (!response.ok) {
      setStatus('保存失败', 'error');
      return;
    }
    const data = await response.json();
    revision = data.page.revision;
    setStatus('已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), 'saved');
  }

  function scheduleSave() {
    setStatus('保存中', 'saving');
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => saveNow(false), 600);
  }

  function sourceEditor() {
    return document.querySelector('[data-tokdoc-source-editor]');
  }

  function escapePreviewHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function safePreviewUrl(value) {
    const url = String(value || '').trim();
    if (!url) return '#';
    if (/^(https?:|mailto:|tel:|\\/|\\.\\/|\\.\\.\\/|#)/i.test(url)) return escapePreviewHtml(url);
    return '#';
  }

  function renderInlineMarkdown(value) {
    let html = escapePreviewHtml(value);
    html = html.replace(/!\\[([^\\]]*)\\]\\(([^)\\s]+)(?:\\s+"[^"]*")?\\)/g, (_, alt, url) => '<img src="' + safePreviewUrl(url) + '" alt="' + alt + '">');
    html = html.replace(/\\[([^\\]]+)\\]\\(([^)\\s]+)(?:\\s+"[^"]*")?\\)/g, (_, label, url) => '<a href="' + safePreviewUrl(url) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>');
    html = html.replace(/\\x60([^\\x60]+)\\x60/g, '<code>$1</code>');
    html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    html = html.replace(/(^|[^\\*])\\*([^*]+)\\*/g, '$1<em>$2</em>');
    html = html.replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>');
    return html;
  }

  function renderMarkdownTable(lines, startIndex) {
    const header = lines[startIndex] || '';
    const divider = lines[startIndex + 1] || '';
    if (!/^\\s*\\|?[\\s:|-]+\\|[\\s:| -]*$/.test(divider)) return null;
    const parseRow = (line) => line.trim().replace(/^\\||\\|$/g, '').split('|').map((cell) => cell.trim());
    const headers = parseRow(header);
    const rows = [];
    let index = startIndex + 2;
    while (index < lines.length && /\\|/.test(lines[index] || '')) {
      rows.push(parseRow(lines[index]));
      index += 1;
    }
    if (!headers.length || !rows.length) return null;
    const thead = '<thead><tr>' + headers.map((cell) => '<th>' + renderInlineMarkdown(cell) + '</th>').join('') + '</tr></thead>';
    const tbody = '<tbody>' + rows.map((row) => '<tr>' + headers.map((_, cellIndex) => '<td>' + renderInlineMarkdown(row[cellIndex] || '') + '</td>').join('') + '</tr>').join('') + '</tbody>';
    return { html: '<table>' + thead + tbody + '</table>', nextIndex: index };
  }

  function flushMarkdownList(buffer, ordered) {
    if (!buffer.length) return '';
    const tag = ordered ? 'ol' : 'ul';
    const body = buffer.map((item) => '<li>' + renderInlineMarkdown(item) + '</li>').join('');
    buffer.length = 0;
    return '<' + tag + '>' + body + '</' + tag + '>';
  }

  function renderMarkdownPreview(markdown) {
    const lines = String(markdown || '').replace(/^\\uFEFF/, '').split(/\\r?\\n/);
    let html = '';
    let paragraph = [];
    let unorderedList = [];
    let orderedList = [];
    let inCode = false;
    let codeLines = [];
    const flushParagraph = () => {
      if (!paragraph.length) return;
      html += '<p>' + renderInlineMarkdown(paragraph.join(' ')) + '</p>';
      paragraph = [];
    };
    const flushLists = () => {
      html += flushMarkdownList(unorderedList, false);
      html += flushMarkdownList(orderedList, true);
    };
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^\\s*\\x60\\x60\\x60/.test(line)) {
        if (inCode) {
          html += '<pre><code>' + escapePreviewHtml(codeLines.join('\\n')) + '</code></pre>';
          codeLines = [];
          inCode = false;
        } else {
          flushParagraph();
          flushLists();
          inCode = true;
        }
        continue;
      }
      if (inCode) {
        codeLines.push(line);
        continue;
      }
      if (!line.trim()) {
        flushParagraph();
        flushLists();
        continue;
      }
      const table = /\\|/.test(line) ? renderMarkdownTable(lines, index) : null;
      if (table) {
        flushParagraph();
        flushLists();
        html += table.html;
        index = table.nextIndex - 1;
        continue;
      }
      const heading = line.match(/^\\s{0,3}(#{1,6})\\s+(.+?)\\s*#*\\s*$/);
      if (heading) {
        flushParagraph();
        flushLists();
        html += '<h' + heading[1].length + '>' + renderInlineMarkdown(heading[2]) + '</h' + heading[1].length + '>';
        continue;
      }
      const quote = line.match(/^\\s{0,3}>\\s?(.*)$/);
      if (quote) {
        flushParagraph();
        flushLists();
        html += '<blockquote>' + renderInlineMarkdown(quote[1]) + '</blockquote>';
        continue;
      }
      const unordered = line.match(/^\\s*[-*+]\\s+(.+)$/);
      if (unordered) {
        flushParagraph();
        html += flushMarkdownList(orderedList, true);
        unorderedList.push(unordered[1]);
        continue;
      }
      const ordered = line.match(/^\\s*\\d+\\.\\s+(.+)$/);
      if (ordered) {
        flushParagraph();
        html += flushMarkdownList(unorderedList, false);
        orderedList.push(ordered[1]);
        continue;
      }
      paragraph.push(line.trim());
    }
    if (inCode) html += '<pre><code>' + escapePreviewHtml(codeLines.join('\\n')) + '</code></pre>';
    flushParagraph();
    flushLists();
    return html || '<p class="tokdoc-source-preview__empty">暂无预览内容</p>';
  }

  function updateMarkdownPreview() {
    const panel = sourceEditor();
    if (!panel) return;
    const input = panel.querySelector('[data-tokdoc-source-input]');
    const preview = panel.querySelector('[data-tokdoc-source-preview]');
    if (!input || !preview) return;
    preview.innerHTML = renderMarkdownPreview(input.value);
  }

  function setSourceViewMode(mode) {
    const panel = mountSourceEditor();
    const normalized = ['edit', 'preview', 'split'].includes(mode) ? mode : 'edit';
    panel.dataset.viewMode = normalized;
    panel.querySelectorAll('[data-tokdoc-source-view]').forEach((button) => {
      button.dataset.active = button.dataset.tokdocSourceView === normalized ? 'true' : 'false';
    });
    if (normalized !== 'edit') updateMarkdownPreview();
  }

  function replaceMarkdownSelection(input, before, after, placeholder) {
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? start;
    const selected = input.value.slice(start, end) || placeholder;
    const next = before + selected + after;
    input.setRangeText(next, start, end, 'select');
    input.selectionStart = start + before.length;
    input.selectionEnd = start + before.length + selected.length;
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function replaceCurrentLines(input, transform) {
    const value = input.value;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? start;
    const lineStart = value.lastIndexOf('\\n', Math.max(0, start - 1)) + 1;
    const lineEndIndex = value.indexOf('\\n', end);
    const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
    const block = value.slice(lineStart, lineEnd) || '';
    const next = transform(block);
    input.setRangeText(next, lineStart, lineEnd, 'select');
    input.selectionStart = lineStart;
    input.selectionEnd = lineStart + next.length;
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function applyMarkdownFormat(action) {
    const panel = mountSourceEditor();
    const input = panel.querySelector('[data-tokdoc-source-input]');
    if (!input) return;
    const lineTransform = (prefix, fallback) => replaceCurrentLines(input, (block) => {
      const lines = (block || fallback).split('\\n');
      return lines.map((line) => {
        const clean = line.replace(/^\\s{0,3}(#{1,6}\\s+|>\\s+|[-*+]\\s+|\\d+\\.\\s+)/, '');
        return prefix + clean;
      }).join('\\n');
    });
    if (action === 'h1') lineTransform('# ', '标题');
    if (action === 'h2') lineTransform('## ', '小标题');
    if (action === 'bold') replaceMarkdownSelection(input, '**', '**', '加粗文字');
    if (action === 'italic') replaceMarkdownSelection(input, '*', '*', '斜体文字');
    if (action === 'quote') lineTransform('> ', '引用内容');
    if (action === 'ul') lineTransform('- ', '列表项');
    if (action === 'ol') replaceCurrentLines(input, (block) => (block || '列表项').split('\\n').map((line, index) => (index + 1) + '. ' + line.replace(/^\\s*(\\d+\\.\\s+|[-*+]\\s+)/, '')).join('\\n'));
    if (action === 'code') replaceMarkdownSelection(input, '\\x60', '\\x60', 'code');
    if (action === 'codeblock') replaceMarkdownSelection(input, '\\x60\\x60\\x60\\n', '\\n\\x60\\x60\\x60', '代码内容');
    if (action === 'link') replaceMarkdownSelection(input, '[', '](https://example.com)', '链接文字');
    if (action === 'table') replaceMarkdownSelection(input, '', '', '| 字段 | 说明 |\\n| --- | --- |\\n| 示例 | 内容 |');
    updateMarkdownPreview();
  }

  function mountSourceEditor() {
    let panel = sourceEditor();
    if (panel) return panel;
    panel = document.createElement('section');
    panel.hidden = true;
    panel.className = 'tokdoc-source-editor';
    panel.setAttribute('data-tokdoc-bridge', 'source-editor');
    panel.setAttribute('data-tokdoc-source-editor', 'true');
    panel.setAttribute('aria-label', 'Markdown 编辑器修改');
    panel.dataset.viewMode = 'edit';
    panel.innerHTML = '<header class="tokdoc-source-editor__bar"><div class="tokdoc-source-editor__title"><strong>Markdown 编辑器</strong><span>直接修改源码，支持工具栏和实时预览</span></div><span class="tokdoc-edit-panel__status" data-tokdoc-source-status data-tone="saved">等待载入</span><div class="tokdoc-source-editor__actions"><button type="button" data-tokdoc-source-save>保存源码</button><button type="button" data-tokdoc-source-close>回到页面修改</button></div></header><div class="tokdoc-source-editor__tools" aria-label="Markdown 工具栏"><div class="tokdoc-source-editor__toolset"><button type="button" data-tokdoc-md-format="h1">H1</button><button type="button" data-tokdoc-md-format="h2">H2</button><button type="button" data-tokdoc-md-format="bold">B</button><button type="button" data-tokdoc-md-format="italic"><em>I</em></button><button type="button" data-tokdoc-md-format="quote">引用</button><button type="button" data-tokdoc-md-format="ul">列表</button><button type="button" data-tokdoc-md-format="ol">编号</button><button type="button" data-tokdoc-md-format="code">代码</button><button type="button" data-tokdoc-md-format="codeblock">代码块</button><button type="button" data-tokdoc-md-format="link">链接</button><button type="button" data-tokdoc-md-format="table">表格</button></div><div class="tokdoc-source-editor__views" aria-label="预览模式"><button type="button" data-tokdoc-source-view="edit" data-active="true">编辑</button><button type="button" data-tokdoc-source-view="preview" data-active="false">预览</button><button type="button" data-tokdoc-source-view="split" data-active="false">分栏</button></div></div><div class="tokdoc-source-editor__body"><div class="tokdoc-source-editor__pane tokdoc-source-editor__pane--edit"><textarea data-tokdoc-source-input spellcheck="false" aria-label="Markdown 源码"></textarea></div><div class="tokdoc-source-editor__pane tokdoc-source-editor__pane--preview"><div class="tokdoc-source-preview" data-tokdoc-source-preview aria-label="Markdown 实时预览"></div></div><p class="tokdoc-source-editor__note" data-tokdoc-source-note hidden>当前页面做过页面内编辑，源码保存后会以 Markdown 内容重新生成页面。</p></div>';
    document.body.append(panel);
    panel.querySelector('[data-tokdoc-source-save]').addEventListener('click', () => saveMarkdownSourceNow(true));
    panel.querySelector('[data-tokdoc-source-close]').addEventListener('click', () => closeMarkdownSourceEditor());
    panel.querySelectorAll('[data-tokdoc-md-format]').forEach((button) => {
      button.addEventListener('click', () => applyMarkdownFormat(button.dataset.tokdocMdFormat));
    });
    panel.querySelectorAll('[data-tokdoc-source-view]').forEach((button) => {
      button.addEventListener('click', () => setSourceViewMode(button.dataset.tokdocSourceView));
    });
    panel.querySelector('[data-tokdoc-source-input]').addEventListener('input', () => {
      sourceDirty = true;
      updateMarkdownPreview();
      scheduleMarkdownSourceSave();
    });
    panel.querySelector('[data-tokdoc-source-input]').addEventListener('scroll', (event) => {
      const preview = panel.querySelector('[data-tokdoc-source-preview]');
      if (!preview) return;
      const input = event.currentTarget;
      const ratio = input.scrollTop / Math.max(1, input.scrollHeight - input.clientHeight);
      preview.scrollTop = ratio * Math.max(0, preview.scrollHeight - preview.clientHeight);
    });
    return panel;
  }

  async function loadMarkdownSource() {
    const panel = mountSourceEditor();
    const input = panel.querySelector('[data-tokdoc-source-input]');
    const note = panel.querySelector('[data-tokdoc-source-note]');
    setSourceStatus('读取中', 'saving');
    const response = await fetch(sourceEndpoint);
    if (!response.ok) {
      setSourceStatus('源码读取失败', 'error');
      return false;
    }
    const data = await response.json();
    input.value = data.markdown || '';
    sourceRevision = data.page.revision;
    revision = data.page.revision;
    sourceDirty = false;
    sourceSaved = false;
    panel.dataset.loaded = 'true';
    note.hidden = !data.sourceOutOfSync;
    updateMarkdownPreview();
    setSourceStatus('已载入', 'saved');
    return true;
  }

  async function saveMarkdownSourceNow(manual) {
    window.clearTimeout(sourceSaveTimer);
    if (sourceSaveInFlight) {
      const previousSaved = await sourceSaveInFlight;
      if (!previousSaved || !sourceDirty) return previousSaved;
    }
    const saveTask = saveMarkdownSourcePayload(manual);
    sourceSaveInFlight = saveTask;
    try {
      return await saveTask;
    } finally {
      if (sourceSaveInFlight === saveTask) sourceSaveInFlight = null;
    }
  }

  async function saveMarkdownSourcePayload(manual) {
    const panel = mountSourceEditor();
    const input = panel.querySelector('[data-tokdoc-source-input]');
    const nextMarkdown = input.value;
    setSourceStatus('保存中', 'saving');
    const response = await fetch(sourceEndpoint, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ markdown: nextMarkdown, revision: sourceRevision, reason: manual ? 'manual-source' : 'autosave-source' }),
    });
    if (response.status === 409) {
      setSourceStatus('版本冲突，刷新后再改', 'error');
      return false;
    }
    if (!response.ok) {
      setSourceStatus('源码保存失败', 'error');
      return false;
    }
    const data = await response.json();
    sourceRevision = data.page.revision;
    revision = data.page.revision;
    sourceDirty = input.value !== nextMarkdown;
    sourceSaved = true;
    const note = panel.querySelector('[data-tokdoc-source-note]');
    if (note) note.hidden = true;
    setSourceStatus('已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), 'saved');
    if (sourceDirty) scheduleMarkdownSourceSave();
    return true;
  }

  function scheduleMarkdownSourceSave() {
    setSourceStatus('保存中', 'saving');
    window.clearTimeout(sourceSaveTimer);
    sourceSaveTimer = window.setTimeout(() => saveMarkdownSourceNow(false), 900);
  }

  async function openMarkdownSourceEditor() {
    if (!isMarkdownPage) return;
    const panel = mountSourceEditor();
    panel.hidden = false;
    document.body.classList.add('tokdoc-source-open');
    if (panel.dataset.loaded !== 'true') {
      await loadMarkdownSource();
    }
    panel.querySelector('[data-tokdoc-source-input]').focus();
  }

  async function closeMarkdownSourceEditor() {
    const panel = sourceEditor();
    if (!panel) return;
    if (sourceDirty) {
      const saved = await saveMarkdownSourceNow(true);
      if (!saved) return;
    }
    if (sourceSaved) {
      window.location.href = '/${escapeHtml(page.slug)}?edit=1';
      return;
    }
    panel.hidden = true;
    document.body.classList.remove('tokdoc-source-open');
  }

  function mountToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'tokdoc-edit-panel' + (isMarkdownPage ? ' tokdoc-edit-panel--markdown' : '');
    toolbar.setAttribute('data-tokdoc-bridge', 'toolbar');
    const sourceButton = isMarkdownPage ? '<button type="button" data-tokdoc-source>编辑器修改</button>' : '';
    toolbar.innerHTML = '<div class="tokdoc-edit-panel__brand"><strong>TokDoc</strong><span>页面内编辑</span></div><span class="tokdoc-edit-panel__status" data-tokdoc-status data-tone="saved">已保存</span><div class="tokdoc-edit-panel__actions"><button type="button" data-tokdoc-save>保存</button>' + sourceButton + '<a href="/${escapeHtml(page.slug)}">退出编辑</a><a href="${escapeHtml(adminBase)}">管理器</a></div>';
    document.body.append(toolbar);
    toolbar.querySelector('[data-tokdoc-save]').addEventListener('click', () => saveNow(true));
    const sourceTrigger = toolbar.querySelector('[data-tokdoc-source]');
    if (sourceTrigger) sourceTrigger.addEventListener('click', () => openMarkdownSourceEditor());
  }

  mountToolbar();
  mountModuleHandle();
  enableEditing();
  if (isMarkdownPage) {
    window.setTimeout(() => openMarkdownSourceEditor(), 0);
  }
  document.addEventListener('pointermove', handleModuleHover);
  document.addEventListener('pointermove', handleFreeDragMove);
  document.addEventListener('pointermove', handleResizeMove);
  document.addEventListener('pointerup', finishFreeDrag);
  document.addEventListener('pointerup', finishResizeDrag);
  document.addEventListener('pointercancel', finishFreeDrag);
  document.addEventListener('pointercancel', finishResizeDrag);
  window.addEventListener('scroll', repositionModuleControls, true);
  window.addEventListener('resize', repositionModuleControls);
  document.addEventListener('input', (event) => {
    if (event.target && event.target.closest('[data-tokdoc-editable]')) scheduleSave();
  });
})();
`;
}

export function injectEditBridge(page, html, adminPath = '/admin') {
  const bridge = `
<style data-tokdoc-bridge="style">
  .tokdoc-edit-panel,.tokdoc-edit-panel *{box-sizing:border-box}
  .tokdoc-edit-panel{position:fixed;right:22px;bottom:22px;z-index:2147483647;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;width:min(386px,calc(100vw - 32px));padding:14px;border:1px solid #d1cfc5;border-radius:8px;background:#faf9f5;color:#141413;box-shadow:0 18px 46px rgba(20,20,19,.18),inset 0 1px 0 #fff;font:13px/1.35 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:0}
  .tokdoc-edit-panel__brand{min-width:0;padding-left:10px;border-left:3px solid #1B365D}
  .tokdoc-edit-panel__brand strong{display:block;overflow:hidden;color:#1B365D;font-family:"Songti SC","STSong",Georgia,serif;font-size:18px;font-weight:600;line-height:1.15;text-overflow:ellipsis;white-space:nowrap}
  .tokdoc-edit-panel__brand span{display:block;margin-top:3px;color:#5e5d59;font-size:12px;line-height:1.35}
  .tokdoc-edit-panel__status{align-self:start;min-height:28px;padding:5px 10px;border-radius:999px;background:#edf3ea;color:#365f45;font-size:12px;font-weight:600;white-space:nowrap}
  .tokdoc-edit-panel__status[data-tone="saving"]{background:#f4ead8;color:#805a23}
  .tokdoc-edit-panel__status[data-tone="error"]{background:#f3e1dc;color:#9f3430}
  .tokdoc-edit-panel__actions{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
  .tokdoc-edit-panel--markdown .tokdoc-edit-panel__actions{grid-template-columns:repeat(4,minmax(0,1fr))}
  .tokdoc-edit-panel__actions button,.tokdoc-edit-panel__actions a{display:inline-flex;align-items:center;justify-content:center;height:34px;min-width:0;padding:0 10px;border:1px solid #e8e5da;border-radius:7px;background:#fffefa;color:#1B365D;text-decoration:none;cursor:pointer;font:600 13px/1 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;white-space:nowrap}
  .tokdoc-edit-panel__actions button:hover,.tokdoc-edit-panel__actions a:hover{border-color:#d1cfc5;background:#f2f0e7}
  body.tokdoc-source-open{overflow:hidden}
  .tokdoc-source-editor,.tokdoc-source-editor *{box-sizing:border-box}
  .tokdoc-source-editor{position:fixed;inset:0;z-index:2147483647;display:grid;grid-template-rows:auto auto minmax(0,1fr);background:#f7f6ef;color:#141413;font:14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
  .tokdoc-source-editor[hidden]{display:none}
  .tokdoc-source-editor__bar{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:14px;padding:18px 22px;border-bottom:1px solid #e5dfd2;background:#fffefa;box-shadow:0 1px 0 rgba(255,255,255,.72)}
  .tokdoc-source-editor__title{min-width:0;padding-left:12px;border-left:3px solid #1B365D}
  .tokdoc-source-editor__title strong{display:block;color:#1B365D;font-family:"Songti SC","STSong",Georgia,serif;font-size:22px;font-weight:600;line-height:1.15}
  .tokdoc-source-editor__title span{display:block;margin-top:5px;color:#66645f;font-size:13px;line-height:1.35}
  .tokdoc-source-editor__actions{display:flex;align-items:center;gap:8px}
  .tokdoc-source-editor__actions button{height:36px;padding:0 14px;border:1px solid #e8e5da;border-radius:7px;background:#fffefa;color:#1B365D;cursor:pointer;font:700 13px/1 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;white-space:nowrap}
  .tokdoc-source-editor__actions button:first-child{border-color:#1B365D;background:#1B365D;color:#fff}
  .tokdoc-source-editor__actions button:hover{border-color:#d1cfc5;background:#f2f0e7;color:#1B365D}
  .tokdoc-source-editor__actions button:first-child:hover{border-color:#132a49;background:#132a49;color:#fff}
  .tokdoc-source-editor__tools{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px 22px;border-bottom:1px solid #e8e2d6;background:#faf9f4}
  .tokdoc-source-editor__toolset,.tokdoc-source-editor__views{display:flex;align-items:center;gap:6px;min-width:0}
  .tokdoc-source-editor__toolset{flex-wrap:wrap}
  .tokdoc-source-editor__views{justify-self:end;padding:4px;border-radius:8px;background:#ebe8dd}
  .tokdoc-source-editor__toolset button,.tokdoc-source-editor__views button{display:inline-flex;align-items:center;justify-content:center;height:32px;min-width:34px;padding:0 10px;border:1px solid #e3ded2;border-radius:7px;background:#fffefa;color:#44413b;cursor:pointer;font:700 12px/1 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;white-space:nowrap}
  .tokdoc-source-editor__toolset button:hover,.tokdoc-source-editor__views button:hover{border-color:#cfc8b8;background:#f3f0e7;color:#1B365D}
  .tokdoc-source-editor__views button{border-color:transparent;background:transparent;color:#615f59}
  .tokdoc-source-editor__views button[data-active="true"]{border-color:#e8e3d8;background:#fffefa;color:#1B365D;box-shadow:0 1px 2px rgba(41,34,20,.08)}
  .tokdoc-source-editor__body{position:relative;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;min-height:0;padding:18px 22px 44px}
  .tokdoc-source-editor[data-view-mode="edit"] .tokdoc-source-editor__body,.tokdoc-source-editor[data-view-mode="preview"] .tokdoc-source-editor__body{grid-template-columns:minmax(0,1fr)}
  .tokdoc-source-editor[data-view-mode="edit"] .tokdoc-source-editor__pane--preview,.tokdoc-source-editor[data-view-mode="preview"] .tokdoc-source-editor__pane--edit{display:none}
  .tokdoc-source-editor__pane{min-width:0;min-height:0}
  .tokdoc-source-editor textarea{width:100%;height:100%;min-height:0;resize:none;padding:22px;border:1px solid #d8d2c3;border-radius:8px;background:#fffefa;color:#252522;box-shadow:0 14px 34px rgba(41,34,20,.08);font:14px/1.72 "SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace;tab-size:2;outline:none}
  .tokdoc-source-editor textarea:focus{border-color:#1B365D;box-shadow:0 0 0 3px rgba(27,54,93,.12),0 14px 34px rgba(41,34,20,.08)}
  .tokdoc-source-preview{height:100%;overflow:auto;padding:28px 34px;border:1px solid #e0dacd;border-radius:8px;background:#fffefa;color:#3f3f3b;box-shadow:0 14px 34px rgba(41,34,20,.08);font:15px/1.72 -apple-system,BlinkMacSystemFont,"Source Han Sans SC","PingFang SC",sans-serif}
  .tokdoc-source-preview h1,.tokdoc-source-preview h2,.tokdoc-source-preview h3,.tokdoc-source-preview h4,.tokdoc-source-preview h5,.tokdoc-source-preview h6{color:#141413;font-family:"Songti SC","STSong",Georgia,serif;font-weight:500;line-height:1.24;margin:1.35em 0 .55em}
  .tokdoc-source-preview h1{margin-top:0;font-size:32px}.tokdoc-source-preview h2{font-size:24px;border-bottom:1px solid #eee8dc;padding-bottom:9px}.tokdoc-source-preview h3{font-size:20px}
  .tokdoc-source-preview p,.tokdoc-source-preview ul,.tokdoc-source-preview ol,.tokdoc-source-preview blockquote,.tokdoc-source-preview pre,.tokdoc-source-preview table{margin:0 0 18px}
  .tokdoc-source-preview a{color:#1B365D;text-underline-offset:3px}.tokdoc-source-preview img{max-width:100%;height:auto;border-radius:6px}.tokdoc-source-preview blockquote{padding:12px 18px;border-left:4px solid #1B365D;background:#f6f3eb;color:#55524b}
  .tokdoc-source-preview code{font-family:"SFMono-Regular",Consolas,monospace;background:#f0ede4;border:1px solid #e3dccd;border-radius:4px;padding:1px 5px;font-size:.92em}.tokdoc-source-preview pre{overflow:auto;background:#171717;color:#f7f4ec;border-radius:6px;padding:18px}.tokdoc-source-preview pre code{background:transparent;border:0;color:inherit;padding:0}
  .tokdoc-source-preview table{width:100%;border-collapse:collapse;font-size:14px}.tokdoc-source-preview th,.tokdoc-source-preview td{border:1px solid #e5dfd2;padding:9px 11px;text-align:left;vertical-align:top}.tokdoc-source-preview th{background:#f4f1e8;color:#222}
  .tokdoc-source-preview__empty{color:#8b877e}
  .tokdoc-source-editor__note{position:absolute;left:38px;right:38px;bottom:16px;margin:0;padding:8px 10px;border:1px solid #edd9b8;border-radius:7px;background:#fff8ea;color:#7c5520;font-size:12px;line-height:1.45}
  .tokdoc-source-editor__note[hidden]{display:none}
  @media (max-width:780px){.tokdoc-source-editor__tools{grid-template-columns:1fr}.tokdoc-source-editor__views{justify-self:stretch}.tokdoc-source-editor__views button{flex:1}.tokdoc-source-editor[data-view-mode="split"] .tokdoc-source-editor__body{grid-template-columns:1fr;grid-template-rows:minmax(220px,1fr) minmax(220px,1fr)}}
  @media (max-width:520px){.tokdoc-edit-panel{right:12px;bottom:12px;width:calc(100vw - 24px)}.tokdoc-edit-panel__actions,.tokdoc-edit-panel--markdown .tokdoc-edit-panel__actions{grid-template-columns:1fr}.tokdoc-edit-panel__actions button,.tokdoc-edit-panel__actions a{height:36px}.tokdoc-source-editor__bar{grid-template-columns:1fr;align-items:start;padding:14px}.tokdoc-source-editor__actions{width:100%;display:grid;grid-template-columns:1fr 1fr}.tokdoc-source-editor__tools{padding:10px 12px}.tokdoc-source-editor__toolset{overflow:auto;flex-wrap:nowrap;padding-bottom:2px}.tokdoc-source-editor__body{padding:12px 12px 42px}.tokdoc-source-editor textarea{padding:16px;font-size:13px}.tokdoc-source-preview{padding:18px;font-size:14px}.tokdoc-source-editor__note{left:20px;right:20px;bottom:10px}}
  .tokdoc-editable{outline:1px dashed transparent;outline-offset:3px;transition:outline-color .15s ease,background .15s ease}
  .tokdoc-editable:hover{outline-color:#9db4d0;background:rgba(238,242,247,.55)}
  .tokdoc-editable:focus{outline:2px solid #1B365D;background:rgba(238,242,247,.85)}
  .tokdoc-module-handle{position:fixed;z-index:2147483646;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:1px solid #d1cfc5;border-radius:7px;background:#faf9f5;color:#1B365D;box-shadow:0 10px 24px rgba(20,20,19,.16);cursor:move;font:700 15px/1 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;transition:transform .12s ease,opacity .12s ease}
  .tokdoc-module-handle[hidden]{display:none}
  .tokdoc-module-handle:active{transform:scale(.96)}
  .tokdoc-resize-handle{position:fixed;z-index:2147483645;display:block;border-radius:999px;background:rgba(27,54,93,.26);box-shadow:0 0 0 1px rgba(250,249,245,.72);transition:background .12s ease,opacity .12s ease}
  .tokdoc-resize-handle[hidden]{display:none}
  .tokdoc-resize-handle:hover{background:rgba(27,54,93,.46)}
  .tokdoc-resize-handle--left,.tokdoc-resize-handle--right{cursor:ew-resize}
  .tokdoc-resize-handle--top,.tokdoc-resize-handle--bottom{cursor:ns-resize}
  .tokdoc-adjustable-active{outline:1px dashed rgba(27,54,93,.42)!important;outline-offset:4px}
  .tokdoc-module--free-positioned{outline:1px solid rgba(27,54,93,.28);outline-offset:4px}
  .tokdoc-module--free-dragging{outline:2px solid #1B365D!important;box-shadow:0 18px 42px rgba(20,20,19,.18)}
  .tokdoc-module--resizing{outline:2px solid #1B365D!important;box-shadow:0 18px 42px rgba(20,20,19,.18)}
</style>
<script data-tokdoc-bridge="script">${bridgeScript(page, adminPath)}</script>`;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${bridge}</body>`);
  }
  return `${html}${bridge}`;
}
