const CaptureStore = (() => {
  const DB_NAME = "tokscr-captures";
  const DB_VERSION = 1;
  const STORE_NAME = "captures";
  const MAX_ITEMS = 12;

  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB 打开失败"));
    });
  }

  async function withStore(mode, callback) {
    const db = await openDB();

    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        const result = callback(store);

        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error || new Error("IndexedDB 事务失败"));
        transaction.onabort = () => reject(transaction.error || new Error("IndexedDB 事务中断"));
      });
    } finally {
      db.close();
    }
  }

  async function put(record) {
    await withStore("readwrite", (store) => {
      store.put(record);
    });
    await prune();
    return record.id;
  }

  async function get(id) {
    return await withStore("readonly", (store) => {
      return new Promise((resolve, reject) => {
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error("读取截图失败"));
      });
    });
  }

  async function remove(id) {
    return await withStore("readwrite", (store) => {
      store.delete(id);
    });
  }

  async function list() {
    return await withStore("readonly", (store) => {
      return new Promise((resolve, reject) => {
        const request = store.index("createdAt").getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error || new Error("读取截图列表失败"));
      });
    });
  }

  async function prune() {
    const records = await list();
    const sorted = records.sort((a, b) => b.createdAt - a.createdAt);
    const stale = sorted.slice(MAX_ITEMS);

    if (!stale.length) {
      return;
    }

    await withStore("readwrite", (store) => {
      for (const record of stale) {
        store.delete(record.id);
      }
    });
  }

  return {
    get,
    put,
    remove,
    list
  };
})();
