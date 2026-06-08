import chokidar from 'chokidar';

export class WatchService {
  constructor(store) {
    this.store = store;
    this.watchers = new Map();
  }

  async start() {
    const dirs = this.store.listWatchDirs();
    for (const dir of dirs) {
      await this.watch(dir);
      await this.store.rescanWatchDir(dir.id);
    }
  }

  async stop() {
    await Promise.all(Array.from(this.watchers.values()).map((watcher) => watcher.close()));
    this.watchers.clear();
  }

  async refresh() {
    const activeIds = new Set(this.store.listWatchDirs().map((dir) => dir.id));
    for (const [id, watcher] of this.watchers) {
      if (!activeIds.has(id)) {
        await watcher.close();
        this.watchers.delete(id);
      }
    }
    for (const dir of this.store.listWatchDirs()) {
      if (!this.watchers.has(dir.id)) await this.watch(dir);
    }
  }

  async watch(dir) {
    if (this.watchers.has(dir.id)) return;
    const watcher = chokidar.watch(dir.path, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });
    watcher.on('add', (filePath) => this.handleFile(filePath));
    watcher.on('change', (filePath) => this.handleFile(filePath));
    watcher.on('unlink', (filePath) => this.store.markSourceDeleted(filePath).catch(() => {}));
    this.watchers.set(dir.id, watcher);
  }

  async handleFile(filePath) {
    try {
      await this.store.upsertWatchedFile(filePath);
    } catch {
      // Watch events should not crash the local service; manual rescan exposes persistent problems.
    }
  }
}
