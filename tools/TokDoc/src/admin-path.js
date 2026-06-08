export const defaultAdminPath = '/admin';

const reservedAdminPaths = new Set(['/api', '/assets', '/page-assets', '/pages', '/favicon.ico']);

export function normalizeAdminPath(value = defaultAdminPath) {
  const raw = String(value || defaultAdminPath).trim();
  const candidate = raw.startsWith('/') ? raw : `/${raw}`;
  const normalized = candidate.replace(/\/+$/g, '') || defaultAdminPath;

  if (!/^\/[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(normalized)) {
    const error = new Error('后台访问目录只能使用一层英文、数字、短横线或下划线，例如 /tok-ops');
    error.code = 'ADMIN_PATH_INVALID';
    throw error;
  }
  if (reservedAdminPaths.has(normalized.toLowerCase())) {
    const error = new Error('后台访问目录不能使用系统保留路径');
    error.code = 'ADMIN_PATH_RESERVED';
    throw error;
  }
  if (/^\/[a-z0-9]{6}$/i.test(normalized)) {
    const error = new Error('后台访问目录不能使用 6 位短链接格式，避免和公开文档 URL 冲突');
    error.code = 'ADMIN_PATH_CONFLICT';
    throw error;
  }
  return normalized;
}

export function safeAdminPath(value = defaultAdminPath) {
  try {
    return normalizeAdminPath(value);
  } catch {
    return defaultAdminPath;
  }
}
