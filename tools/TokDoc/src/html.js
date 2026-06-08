import crypto from 'node:crypto';
import path from 'node:path';
import { parseHTML } from 'linkedom';

export function checksum(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function slugify(value) {
  return (
    String(value || 'page')
      .toLowerCase()
      .replace(/\.html?$/i, '')
      .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 72) || 'page'
  );
}

export function buildManagedSlug(options = {}) {
  const provided = String(options.code || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 6);
  if (provided.length === 6) return provided;

  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let slug = '';
  for (let index = 0; index < 6; index += 1) {
    slug += alphabet[crypto.randomInt(alphabet.length)];
  }
  return slug;
}

export function isHtmlFile(filePath) {
  return /\.html?$/i.test(filePath);
}

export function isPdfFile(filePath) {
  return /\.pdf$/i.test(filePath);
}

export function isWordFile(filePath) {
  return /\.(doc|docx)$/i.test(filePath);
}

export function managedFileType(filePath) {
  if (isHtmlFile(filePath)) return 'html';
  if (isPdfFile(filePath)) return 'pdf';
  if (isWordFile(filePath)) return 'word';
  return '';
}

export function isManagedFile(filePath) {
  return Boolean(managedFileType(filePath));
}

export function generatedMimeType(fileType) {
  if (fileType === 'html') return 'text/html; charset=utf-8';
  if (fileType === 'pdf' || fileType === 'word') return 'application/pdf';
  return 'application/octet-stream';
}

export function basenameWithoutExtension(fileName = 'page') {
  return path.basename(String(fileName || 'page')).replace(/\.[^.]+$/i, '') || 'page';
}

export function documentTitleFromFileName(fileName = 'page') {
  return basenameWithoutExtension(fileName).trim() || '未命名文档';
}

export function parentDirectoryNameFromRelative(relativePath) {
  const parts = String(relativePath || '').split(/[\\/]/).filter(Boolean);
  if (parts.length < 2) return '';
  return parts[parts.length - 2] || '';
}

export function parentDirectoryNameFromPath(filePath) {
  return path.basename(path.dirname(filePath || '')) || '';
}

export function parseHtmlMetadata(html, fileName = 'page.html') {
  const { document } = parseHTML(String(html || ''));
  const title =
    document.querySelector('title')?.textContent?.trim() ||
    document.querySelector('h1')?.textContent?.trim() ||
    basenameWithoutExtension(fileName) ||
    '未命名页面';
  const body = document.body?.innerHTML?.trim() || `<h1>${escapeHtml(title)}</h1>`;
  return { title, body };
}

export function stripTokdocAssetBase(html) {
  return String(html || '').replace(/\s*<base\b[^>]*\bdata-tok(?:doc|html)-base\b[^>]*>\s*/gi, '\n');
}

export function injectAssetBase(html, assetBaseUrl = '') {
  const cleanHtml = stripTokdocAssetBase(html);
  const normalized = String(assetBaseUrl || '').trim();
  if (!normalized) return cleanHtml;
  const href = normalized.endsWith('/') ? normalized : `${normalized}/`;
  const baseTag = `<base data-tokdoc-base href="${escapeHtml(href)}">`;
  if (/<head\b[^>]*>/i.test(cleanHtml)) {
    return cleanHtml.replace(/<head\b[^>]*>/i, (match) => `${match}\n${baseTag}`);
  }
  if (/<html\b[^>]*>/i.test(cleanHtml)) {
    return cleanHtml.replace(/<html\b[^>]*>/i, (match) => `${match}\n<head>\n${baseTag}\n</head>`);
  }
  return `<head>\n${baseTag}\n</head>\n${cleanHtml}`;
}

export function stripTrackingCode(html) {
  return String(html || '').replace(/\s*<!-- tok(?:doc|html)-tracking:start -->[\s\S]*?<!-- tok(?:doc|html)-tracking:end -->\s*/gi, '\n');
}

export function injectTrackingCode(html, trackingCode = '') {
  const cleanHtml = stripTrackingCode(html);
  const code = String(trackingCode || '').trim();
  if (!code) return cleanHtml;
  const block = `\n<!-- tokdoc-tracking:start -->\n${code}\n<!-- tokdoc-tracking:end -->\n`;
  if (/<\/head>/i.test(cleanHtml)) return cleanHtml.replace(/<\/head>/i, `${block}</head>`);
  if (/<\/body>/i.test(cleanHtml)) return cleanHtml.replace(/<\/body>/i, `${block}</body>`);
  return `${cleanHtml}${block}`;
}

export function composeDocument(title, body) {
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    '<style>body{max-width:860px;margin:48px auto;padding:0 24px;color:#4d4c48;background:#f5f4ed;font-family:-apple-system,BlinkMacSystemFont,"Source Han Sans SC","PingFang SC",sans-serif;line-height:1.6}h1,h2,h3{color:#141413;font-family:"Songti SC","STSong",Georgia,serif;font-weight:500;line-height:1.2}blockquote{margin:20px 0;padding:10px 16px;border-left:3px solid #1B365D;background:#faf9f5}</style>',
    '</head>',
    '<body>',
    body || `<h1>${escapeHtml(title)}</h1>`,
    '</body>',
    '</html>',
  ].join('');
}

function insetParts(value) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
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
    .filter((item) => !/^(position|inset|left|top|right|bottom)\s*:/i.test(item));
  node.setAttribute('style', ['position:absolute', `left:${left}`, `top:${top}`, ...declarations].join(';'));
}

export function removeEditBridge(html) {
  const { document } = parseHTML(String(html || ''));
  document.querySelectorAll('[data-tokdoc-bridge],[data-tokhtml-bridge]').forEach((node) => node.remove());
  document.querySelectorAll('.tokdoc-adjustable-active,.tokhtml-adjustable-active').forEach((node) => {
    node.classList.remove('tokdoc-adjustable-active', 'tokhtml-adjustable-active');
  });
  document.querySelectorAll('[data-tokdoc-module],[data-tokhtml-module]').forEach((node) => {
    normalizeFreePositionedStyle(node);
    node.removeAttribute('data-tokdoc-module');
    node.removeAttribute('data-tokdoc-free-positioned');
    node.removeAttribute('data-tokhtml-module');
    node.removeAttribute('data-tokhtml-free-positioned');
    node.removeAttribute('draggable');
    node.classList.remove('tokdoc-draggable-module');
    node.classList.remove('tokdoc-module--dragging');
    node.classList.remove('tokdoc-module--drop-target');
    node.classList.remove('tokdoc-module--free-positioned');
    node.classList.remove('tokdoc-module--free-dragging');
    node.classList.remove('tokdoc-module--resizing');
    node.classList.remove('tokhtml-draggable-module');
    node.classList.remove('tokhtml-module--dragging');
    node.classList.remove('tokhtml-module--drop-target');
    node.classList.remove('tokhtml-module--free-positioned');
    node.classList.remove('tokhtml-module--free-dragging');
    node.classList.remove('tokhtml-module--resizing');
  });
  document.querySelectorAll('[data-tokdoc-editable],[data-tokhtml-editable]').forEach((node) => {
    node.removeAttribute('contenteditable');
    node.removeAttribute('data-tokdoc-editable');
    node.removeAttribute('data-tokhtml-editable');
    node.classList.remove('tokdoc-editable');
    node.classList.remove('tokhtml-editable');
  });
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}
