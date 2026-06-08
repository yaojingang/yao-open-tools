import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function boolEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function splitPaths(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(item));
}

function envValue(env, primaryName, legacyName, fallback) {
  if (env[primaryName] != null && env[primaryName] !== '') return env[primaryName];
  if (env[legacyName] != null && env[legacyName] !== '') return env[legacyName];
  return fallback;
}

function resolveDbPath(env, dataDir) {
  const explicitPath = envValue(env, 'TOKDOC_DB_PATH', 'TOKHTML_DB_PATH', '');
  if (explicitPath) return path.resolve(explicitPath);

  const tokdocDbPath = path.join(dataDir, 'tokdoc.db');
  const legacyDbPath = path.join(dataDir, 'tokhtml.db');
  if (fs.existsSync(legacyDbPath) && !fs.existsSync(tokdocDbPath)) return legacyDbPath;
  return tokdocDbPath;
}

export function loadConfig(env = process.env) {
  const dataDir = path.resolve(envValue(env, 'TOKDOC_DATA_DIR', 'TOKHTML_DATA_DIR', path.join(rootDir, 'data')));
  return {
    name: 'tokdoc',
    rootDir,
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || 8080),
    dataDir,
    dbPath: resolveDbPath(env, dataDir),
    uploadsDir: path.join(dataDir, 'uploads'),
    generatedDir: path.join(dataDir, 'pages'),
    trashDir: path.join(dataDir, 'trash'),
    versionsDir: path.join(dataDir, 'versions'),
    publicDir: path.join(rootDir, 'public'),
    watchDirs: splitPaths(envValue(env, 'TOKDOC_WATCH_DIRS', 'TOKHTML_WATCH_DIRS', path.join(rootDir, 'html-inbox'))),
    allowSourceWrite: boolEnv(envValue(env, 'TOKDOC_ALLOW_SOURCE_WRITE', 'TOKHTML_ALLOW_SOURCE_WRITE', ''), false),
    officeConverterBin: envValue(env, 'TOKDOC_SOFFICE_BIN', 'TOKHTML_SOFFICE_BIN', 'soffice'),
  };
}
