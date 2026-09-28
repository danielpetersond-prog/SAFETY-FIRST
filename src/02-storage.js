// ---------------------------------------------------------------------------
// 02 · Armazenamento local (IndexedDB, com fallback para localStorage/memória)
//      Tudo fica no navegador do usuário — nada é enviado para servidores.
// ---------------------------------------------------------------------------
const DB_NAME = 'ops360ia_v3';
const DB_STORES = ['kv', 'chats', 'files', 'tabs', 'docs'];
const LS_PREFIX = 'ops360ia3:';

const db = {
  _idb: null,
  _mode: 'memory',
  _mem: Object.fromEntries(DB_STORES.map((s) => [s, new Map()])),
  _ready: null,

  open() {
    if (this._ready) return this._ready;
    this._ready = new Promise((resolve) => {
      let idb;
      try {
        idb = PAGE.indexedDB || window.indexedDB;
      } catch (e) {
        idb = null;
      }
      if (!idb) return resolve(this._fallback());
      let req;
      try {
        req = idb.open(DB_NAME, 1);
      } catch (e) {
        return resolve(this._fallback());
      }
      const timer = setTimeout(() => resolve(this._fallback()), 4000);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const s of DB_STORES) {
          if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, s === 'kv' ? undefined : { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        clearTimeout(timer);
        this._idb = req.result;
        this._mode = 'idb';
        this._idb.onversionchange = () => this._idb.close();
        resolve('idb');
      };
      req.onerror = req.onblocked = () => {
        clearTimeout(timer);
        resolve(this._fallback());
      };
    });
    return this._ready;
  },

  _fallback() {
    try {
      const k = LS_PREFIX + 'probe';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      this._mode = 'ls';
      for (const s of DB_STORES) {
        const raw = localStorage.getItem(LS_PREFIX + s);
        if (raw) {
          const obj = JSON.parse(raw);
          this._mem[s] = new Map(Object.entries(obj));
        }
      }
    } catch (e) {
      this._mode = 'memory';
    }
    return this._mode;
  },
  _dirty: new Set(),
  _persistLS(store) {
    this._dirty.add(store);
    this._flushLS();
  },
  _flushLS: debounce(() => {
    if (db._mode !== 'ls') return;
    for (const store of db._dirty) {
      try {
        localStorage.setItem(LS_PREFIX + store, JSON.stringify(Object.fromEntries(db._mem[store])));
      } catch (e) {
        console.warn('[OPS360IA] armazenamento cheio — ', store, e);
      }
    }
    db._dirty.clear();
  }, 400),

  _tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this._idb.transaction(store, mode);
      const os = tx.objectStore(store);
      let result;
      const r = fn(os);
      if (r) r.onsuccess = () => (result = r.result);
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  },

  async get(store, key) {
    await this.open();
    if (this._mode === 'idb') {
      try {
        return await this._tx(store, 'readonly', (os) => os.get(key));
      } catch (e) {
        return undefined;
      }
    }
    return deepClone(this._mem[store].get(key));
  },
  async put(store, value, key) {
    await this.open();
    if (this._mode === 'idb') {
      try {
        return await this._tx(store, 'readwrite', (os) => (store === 'kv' ? os.put(value, key) : os.put(value)));
      } catch (e) {
        console.warn('[OPS360IA] falha ao salvar', store, e);
        return;
      }
    }
    this._mem[store].set(store === 'kv' ? key : value.id, deepClone(value));
    if (this._mode === 'ls' && store !== 'files') this._persistLS(store);
  },
  async del(store, key) {
    await this.open();
    if (this._mode === 'idb') {
      try {
        return await this._tx(store, 'readwrite', (os) => os.delete(key));
      } catch (e) {
        return;
      }
    }
    this._mem[store].delete(key);
    if (this._mode === 'ls') this._persistLS(store);
  },
  async all(store) {
    await this.open();
    if (this._mode === 'idb') {
      try {
        return (await this._tx(store, 'readonly', (os) => os.getAll())) || [];
      } catch (e) {
        return [];
      }
    }
    return [...this._mem[store].values()].map(deepClone);
  },
  async clear(store) {
    await this.open();
    if (this._mode === 'idb') {
      try {
        return await this._tx(store, 'readwrite', (os) => os.clear());
      } catch (e) {
        return;
      }
    }
    this._mem[store].clear();
    if (this._mode === 'ls') this._persistLS(store);
  },
};

// Chave/valor com cache síncrono (preferências da interface)
const kv = {
  _cache: new Map(),
  async load(keys) {
    for (const k of keys) {
      const v = await db.get('kv', k);
      if (v !== undefined) this._cache.set(k, v);
    }
  },
  get(k, def) {
    return this._cache.has(k) ? this._cache.get(k) : def;
  },
  set(k, v) {
    this._cache.set(k, v);
    db.put('kv', deepClone(v), k);
  },
};
