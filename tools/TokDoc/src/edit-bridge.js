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

function bridgeScript(page) {
  return `
(function () {
  const pageId = ${JSON.stringify(page.id)};
  let revision = ${Number(page.revision)};
  let saveTimer = null;
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
    const response = await fetch('/api/pages/' + encodeURIComponent(pageId) + '/content', {
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

  function mountToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'tokdoc-edit-panel';
    toolbar.setAttribute('data-tokdoc-bridge', 'toolbar');
    toolbar.innerHTML = '<div class="tokdoc-edit-panel__brand"><strong>TokDoc</strong><span>页面内编辑</span></div><span class="tokdoc-edit-panel__status" data-tokdoc-status data-tone="saved">已保存</span><div class="tokdoc-edit-panel__actions"><button type="button" data-tokdoc-save>保存</button><a href="/${escapeHtml(page.slug)}">退出编辑</a><a href="/admin">管理器</a></div>';
    document.body.append(toolbar);
    toolbar.querySelector('[data-tokdoc-save]').addEventListener('click', () => saveNow(true));
  }

  mountToolbar();
  mountModuleHandle();
  enableEditing();
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

export function injectEditBridge(page, html) {
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
  .tokdoc-edit-panel__actions button,.tokdoc-edit-panel__actions a{display:inline-flex;align-items:center;justify-content:center;height:34px;min-width:0;padding:0 10px;border:1px solid #e8e5da;border-radius:7px;background:#fffefa;color:#1B365D;text-decoration:none;cursor:pointer;font:600 13px/1 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;white-space:nowrap}
  .tokdoc-edit-panel__actions button:hover,.tokdoc-edit-panel__actions a:hover{border-color:#d1cfc5;background:#f2f0e7}
  @media (max-width:520px){.tokdoc-edit-panel{right:12px;bottom:12px;width:calc(100vw - 24px)}.tokdoc-edit-panel__actions{grid-template-columns:1fr}.tokdoc-edit-panel__actions button,.tokdoc-edit-panel__actions a{height:36px}}
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
<script data-tokdoc-bridge="script">${bridgeScript(page)}</script>`;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${bridge}</body>`);
  }
  return `${html}${bridge}`;
}
