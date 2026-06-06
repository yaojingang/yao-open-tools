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
  let dragNode = null;
  let dragMoved = false;
  let freeDrag = null;
  const selectors = ${JSON.stringify(editableElementSelector)};
  const moduleSelectors = ${JSON.stringify(movableModuleSelector)};
  const ignoredSelector = '[data-tokhtml-bridge],script,style,noscript,textarea,input,select,option,svg,canvas,iframe,video,audio';

  function setStatus(text, tone) {
    const status = document.querySelector('[data-tokhtml-status]');
    if (!status) return;
    status.textContent = text;
    status.dataset.tone = tone || 'idle';
  }

  function editableNodes() {
    const candidates = Array.from(document.body.querySelectorAll(selectors))
      .filter((node) => !node.closest('[data-tokhtml-bridge]'))
      .filter((node) => !node.closest(ignoredSelector))
      .filter((node) => Array.from(node.childNodes).some((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim()));
    return candidates.reduce((selected, node) => {
      if (!selected.some((parent) => parent.contains(node))) selected.push(node);
      return selected;
    }, []);
  }

  function siblingModules(parent) {
    if (!parent) return [];
    return Array.from(parent.children)
      .filter((node) => node.matches(moduleSelectors))
      .filter((node) => !node.closest('[data-tokhtml-bridge]'));
  }

  function movableNodes() {
    return Array.from(document.body.querySelectorAll(moduleSelectors))
      .filter((node) => !node.closest('[data-tokhtml-bridge]'))
      .filter((node) => !node.closest(ignoredSelector))
      .filter((node) => node.parentElement)
      .filter((node) => node.textContent.trim() || node.querySelector('img,video,canvas,svg,iframe'));
  }

  function directModuleTools(node) {
    return Array.from(node.children).find((child) => child.matches('[data-tokhtml-module-tools]'));
  }

  function enableEditing() {
    editableNodes().forEach((node) => {
      node.setAttribute('contenteditable', 'true');
      node.setAttribute('data-tokhtml-editable', 'true');
      node.classList.add('tokhtml-editable');
    });
  }

  function clearDropState() {
    document.querySelectorAll('.tokhtml-module--drop-target').forEach((node) => node.classList.remove('tokhtml-module--drop-target'));
  }

  function isFreePositioned(node) {
    return node.style.position === 'absolute' && node.style.left && node.style.top;
  }

  function parentPrefersHorizontal(parent) {
    const style = window.getComputedStyle(parent);
    if (style.display.includes('grid')) return true;
    if (style.display.includes('flex')) return style.flexDirection.startsWith('row');
    return false;
  }

  function shouldInsertBefore(target, event) {
    const rect = target.getBoundingClientRect();
    if (parentPrefersHorizontal(target.parentElement)) {
      return event.clientX < rect.left + rect.width / 2;
    }
    return event.clientY < rect.top + rect.height / 2;
  }

  function handleModuleDragOver(event) {
    if (!dragNode || freeDrag) return;
    const target = event.currentTarget;
    if (!target || target === dragNode || target.parentElement !== dragNode.parentElement) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    clearDropState();
    target.classList.add('tokhtml-module--drop-target');
    const before = shouldInsertBefore(target, event);
    if (before && target.previousElementSibling !== dragNode) {
      target.parentElement.insertBefore(dragNode, target);
      dragMoved = true;
    }
    if (!before && target.nextElementSibling !== dragNode) {
      target.parentElement.insertBefore(dragNode, target.nextSibling);
      dragMoved = true;
    }
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
    };
  }

  function placeNodeAt(node, left, top) {
    node.style.left = Math.round(left) + 'px';
    node.style.top = Math.round(top) + 'px';
  }

  function startFreeDrag(node, handle, event) {
    event.preventDefault();
    event.stopPropagation();
    const position = relativePosition(node);
    node.style.position = 'absolute';
    node.style.right = 'auto';
    node.style.bottom = 'auto';
    if (!node.style.width) node.style.width = Math.round(position.width) + 'px';
    if (!node.style.zIndex) node.style.zIndex = '10';
    placeNodeAt(node, position.left, position.top);
    node.setAttribute('data-tokhtml-free-positioned', 'true');
    node.classList.add('tokhtml-module--free-positioned', 'tokhtml-module--free-dragging');
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
    current.node.classList.remove('tokhtml-module--free-dragging');
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

  function resetFreePosition(node) {
    node.removeAttribute('data-tokhtml-free-positioned');
    node.classList.remove('tokhtml-module--free-positioned', 'tokhtml-module--free-dragging');
    ['position', 'left', 'top', 'right', 'bottom', 'width', 'zIndex'].forEach((property) => {
      node.style[property] = '';
    });
    scheduleSave();
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

  function mountModuleHandles() {
    movableNodes().forEach((node) => {
      node.setAttribute('data-tokhtml-module', 'true');
      node.classList.add('tokhtml-draggable-module');
      if (!directModuleTools(node)) {
        const tools = document.createElement('div');
        tools.contentEditable = 'false';
        tools.className = 'tokhtml-module-tools';
        tools.setAttribute('data-tokhtml-bridge', 'drag-handle');
        tools.setAttribute('data-tokhtml-module-tools', 'true');

        const freeHandle = document.createElement('button');
        freeHandle.type = 'button';
        freeHandle.contentEditable = 'false';
        freeHandle.className = 'tokhtml-module-tool tokhtml-module-handle';
        freeHandle.setAttribute('data-tokhtml-free-handle', 'true');
        freeHandle.setAttribute('aria-label', '自由拖动模块');
        freeHandle.title = '自由拖动定位；双击还原定位';
        freeHandle.textContent = '↔';

        const sortHandle = document.createElement('button');
        sortHandle.type = 'button';
        sortHandle.draggable = true;
        sortHandle.contentEditable = 'false';
        sortHandle.className = 'tokhtml-module-tool tokhtml-module-sort-handle';
        sortHandle.setAttribute('data-tokhtml-drag-handle', 'true');
        sortHandle.setAttribute('aria-label', '拖动排序模块');
        sortHandle.title = '同级模块拖动排序';
        sortHandle.textContent = '↕';

        tools.append(freeHandle, sortHandle);
        node.prepend(tools);

        freeHandle.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          startFreeDrag(node, freeHandle, event);
        });
        sortHandle.addEventListener('dragstart', (event) => {
          if (freeDrag || isFreePositioned(node)) {
            event.preventDefault();
            return;
          }
          dragNode = node;
          dragMoved = false;
          node.classList.add('tokhtml-module--dragging');
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', 'tokhtml-module');
        });
        sortHandle.addEventListener('dragend', () => {
          node.classList.remove('tokhtml-module--dragging');
          clearDropState();
          dragNode = null;
          if (dragMoved) scheduleSave();
          dragMoved = false;
        });
        freeHandle.addEventListener('dblclick', (event) => {
          event.preventDefault();
          event.stopPropagation();
          resetFreePosition(node);
        });
      }
      node.addEventListener('dragover', handleModuleDragOver);
      node.addEventListener('drop', (event) => {
        if (!dragNode) return;
        event.preventDefault();
        clearDropState();
      });
    });
  }

  function cleanHtmlSnapshot() {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('[data-tokhtml-bridge]').forEach((node) => node.remove());
    clone.querySelectorAll('[data-tokhtml-module]').forEach((node) => {
      normalizeFreePositionedStyle(node);
      node.removeAttribute('data-tokhtml-module');
      node.removeAttribute('data-tokhtml-free-positioned');
      node.removeAttribute('draggable');
      node.classList.remove('tokhtml-draggable-module');
      node.classList.remove('tokhtml-module--dragging');
      node.classList.remove('tokhtml-module--drop-target');
      node.classList.remove('tokhtml-module--free-positioned');
      node.classList.remove('tokhtml-module--free-dragging');
    });
    clone.querySelectorAll('[data-tokhtml-editable]').forEach((node) => {
      node.removeAttribute('contenteditable');
      node.removeAttribute('data-tokhtml-editable');
      node.classList.remove('tokhtml-editable');
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
    toolbar.className = 'tokhtml-edit-panel';
    toolbar.setAttribute('data-tokhtml-bridge', 'toolbar');
    toolbar.innerHTML = '<div class="tokhtml-edit-panel__brand"><strong>tokhtml</strong><span>页面内编辑</span></div><span class="tokhtml-edit-panel__status" data-tokhtml-status data-tone="saved">已保存</span><div class="tokhtml-edit-panel__actions"><button type="button" data-tokhtml-save>保存</button><a href="/${escapeHtml(page.slug)}">退出编辑</a><a href="/admin">管理器</a></div>';
    document.body.append(toolbar);
    toolbar.querySelector('[data-tokhtml-save]').addEventListener('click', () => saveNow(true));
  }

  mountToolbar();
  mountModuleHandles();
  enableEditing();
  document.addEventListener('pointermove', handleFreeDragMove);
  document.addEventListener('pointerup', finishFreeDrag);
  document.addEventListener('pointercancel', finishFreeDrag);
  document.addEventListener('input', (event) => {
    if (event.target && event.target.closest('[data-tokhtml-editable]')) scheduleSave();
  });
})();
`;
}

export function injectEditBridge(page, html) {
  const bridge = `
<style data-tokhtml-bridge="style">
  .tokhtml-edit-panel,.tokhtml-edit-panel *{box-sizing:border-box}
  .tokhtml-edit-panel{position:fixed;right:22px;bottom:22px;z-index:2147483647;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;width:min(386px,calc(100vw - 32px));padding:14px;border:1px solid #d1cfc5;border-radius:8px;background:#faf9f5;color:#141413;box-shadow:0 18px 46px rgba(20,20,19,.18),inset 0 1px 0 #fff;font:13px/1.35 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:0}
  .tokhtml-edit-panel__brand{min-width:0;padding-left:10px;border-left:3px solid #1B365D}
  .tokhtml-edit-panel__brand strong{display:block;overflow:hidden;color:#1B365D;font-family:"Songti SC","STSong",Georgia,serif;font-size:18px;font-weight:600;line-height:1.15;text-overflow:ellipsis;white-space:nowrap}
  .tokhtml-edit-panel__brand span{display:block;margin-top:3px;color:#5e5d59;font-size:12px;line-height:1.35}
  .tokhtml-edit-panel__status{align-self:start;min-height:28px;padding:5px 10px;border-radius:999px;background:#edf3ea;color:#365f45;font-size:12px;font-weight:600;white-space:nowrap}
  .tokhtml-edit-panel__status[data-tone="saving"]{background:#f4ead8;color:#805a23}
  .tokhtml-edit-panel__status[data-tone="error"]{background:#f3e1dc;color:#9f3430}
  .tokhtml-edit-panel__actions{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
  .tokhtml-edit-panel__actions button,.tokhtml-edit-panel__actions a{display:inline-flex;align-items:center;justify-content:center;height:34px;min-width:0;padding:0 10px;border:1px solid #e8e5da;border-radius:7px;background:#fffefa;color:#1B365D;text-decoration:none;cursor:pointer;font:600 13px/1 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;white-space:nowrap}
  .tokhtml-edit-panel__actions button:hover,.tokhtml-edit-panel__actions a:hover{border-color:#d1cfc5;background:#f2f0e7}
  @media (max-width:520px){.tokhtml-edit-panel{right:12px;bottom:12px;width:calc(100vw - 24px)}.tokhtml-edit-panel__actions{grid-template-columns:1fr}.tokhtml-edit-panel__actions button,.tokhtml-edit-panel__actions a{height:36px}}
  .tokhtml-editable{outline:1px dashed transparent;outline-offset:3px;transition:outline-color .15s ease,background .15s ease}
  .tokhtml-editable:hover{outline-color:#9db4d0;background:rgba(238,242,247,.55)}
  .tokhtml-editable:focus{outline:2px solid #1B365D;background:rgba(238,242,247,.85)}
  .tokhtml-draggable-module{position:relative}
  .tokhtml-module-tools{position:absolute;left:6px;top:6px;z-index:2147483646;display:inline-flex;align-items:center;gap:4px;padding:3px;border:1px solid #d1cfc5;border-radius:7px;background:#faf9f5;box-shadow:0 10px 24px rgba(20,20,19,.16);opacity:0;transition:opacity .15s ease,transform .15s ease}
  .tokhtml-module-tool{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:5px;background:#fffefa;color:#1B365D;cursor:pointer;font:700 15px/1 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
  .tokhtml-module-handle{cursor:move}
  .tokhtml-module-sort-handle{cursor:grab}
  .tokhtml-draggable-module:hover>.tokhtml-module-tools,.tokhtml-module-tools:focus-within{opacity:1}
  .tokhtml-module-tool:active{transform:scale(.96)}
  .tokhtml-module-sort-handle:active{cursor:grabbing}
  .tokhtml-module--dragging{opacity:.62;outline:2px solid #1B365D!important;outline-offset:4px}
  .tokhtml-module--drop-target{outline:2px dashed #1B365D!important;outline-offset:6px;background-image:linear-gradient(rgba(238,242,247,.58),rgba(238,242,247,.58))}
  .tokhtml-module--free-positioned{outline:1px solid rgba(27,54,93,.28);outline-offset:4px}
  .tokhtml-module--free-dragging{outline:2px solid #1B365D!important;box-shadow:0 18px 42px rgba(20,20,19,.18)}
</style>
<script data-tokhtml-bridge="script">${bridgeScript(page)}</script>`;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${bridge}</body>`);
  }
  return `${html}${bridge}`;
}
