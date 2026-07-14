import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function createDb(config) {
  const dbPath = config.dbPath || path.join(config.dataDir, 'tokdoc.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_path TEXT,
      directory_name TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'published',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      generated_path TEXT NOT NULL,
      file_type TEXT NOT NULL DEFAULT 'html',
      mime_type TEXT NOT NULL DEFAULT 'text/html; charset=utf-8',
      raw_mtime_ms INTEGER,
      checksum TEXT NOT NULL,
      edited INTEGER NOT NULL DEFAULT 0,
      access_count INTEGER NOT NULL DEFAULT 0,
      download_count INTEGER NOT NULL DEFAULT 0,
      visibility TEXT NOT NULL DEFAULT 'public',
      deleted_at TEXT,
      deleted_path TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pages_source_path ON pages(source_path);
    CREATE INDEX IF NOT EXISTS idx_pages_updated_at ON pages(updated_at);

    CREATE TABLE IF NOT EXISTS watch_dirs (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      allow_write INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      html_count INTEGER NOT NULL DEFAULT 0,
      last_scan_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS versions (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      title TEXT NOT NULL,
      content_path TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_versions_page_id ON versions(page_id);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const pageColumns = db.prepare('PRAGMA table_info(pages)').all().map((column) => column.name);
  if (!pageColumns.includes('access_count')) {
    db.exec('ALTER TABLE pages ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0;');
  }
  if (!pageColumns.includes('download_count')) {
    db.exec('ALTER TABLE pages ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0;');
  }
  if (!pageColumns.includes('deleted_at')) {
    db.exec('ALTER TABLE pages ADD COLUMN deleted_at TEXT;');
  }
  if (!pageColumns.includes('deleted_path')) {
    db.exec('ALTER TABLE pages ADD COLUMN deleted_path TEXT;');
  }
  if (!pageColumns.includes('file_type')) {
    db.exec("ALTER TABLE pages ADD COLUMN file_type TEXT NOT NULL DEFAULT 'html';");
  }
  if (!pageColumns.includes('mime_type')) {
    db.exec("ALTER TABLE pages ADD COLUMN mime_type TEXT NOT NULL DEFAULT 'text/html; charset=utf-8';");
  }
  if (!pageColumns.includes('visibility')) {
    db.exec("ALTER TABLE pages ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';");
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_pages_deleted_at ON pages(deleted_at);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_pages_visibility ON pages(visibility);');
  return db;
}
