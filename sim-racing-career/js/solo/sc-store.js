/* ============================================================
   Phoenix SRMPC — Solo Career: local save store
   Careers live in this browser (IndexedDB, with a localStorage
   fallback) — no account, works offline, nothing to deploy.
   Stores:
     saves  full career objects            (key: id)
     meta   small summaries for the slots  (key: id)
     hof    Hall of Fame (retired careers) (key: id)
     kv     misc: one-step undo snapshots, prefs
   Export/import turns a save into a JSON file you can back up
   or move to another device.
   ============================================================ */
'use strict';

(function (root) {
    const SC = root.SC = root.SC || {};
    const DB_NAME = 'srmpc-solo';
    const DB_VERSION = 1;
    const LS = 'srmpc_solo_';

    let dbp = null;
    let fallback = false;

    function open() {
        if (dbp) return dbp;
        dbp = new Promise((resolve) => {
            try {
                if (!root.indexedDB) { fallback = true; resolve(null); return; }
                const req = root.indexedDB.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    ['saves', 'meta', 'hof'].forEach(n => { if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath: 'id' }); });
                    if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => { fallback = true; resolve(null); };
                req.onblocked = () => { fallback = true; resolve(null); };
            } catch (e) { fallback = true; resolve(null); }
        });
        return dbp;
    }

    function tx(store, mode, fn) {
        return open().then(db => new Promise((resolve, reject) => {
            if (!db) { resolve(fn(null)); return; }
            const t = db.transaction(store, mode);
            const os = t.objectStore(store);
            let result;
            const r = fn(os);
            if (r && typeof r.onsuccess !== 'undefined') r.onsuccess = () => { result = r.result; };
            t.oncomplete = () => resolve(result);
            t.onerror = () => reject(t.error || new Error('Storage error'));
            t.onabort = () => reject(t.error || new Error('Storage aborted — the browser may be out of space.'));
        }));
    }

    // localStorage fallback (small quota — fine for a couple of careers)
    const lsGet = (k) => { try { const v = localStorage.getItem(LS + k); return v ? JSON.parse(v) : null; } catch (e) { return null; } };
    const lsSet = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) { throw new Error('Browser storage is full — export and delete an old career to make room.'); } };
    const lsDel = (k) => { try { localStorage.removeItem(LS + k); } catch (e) { /* */ } };
    const lsList = (prefix) => {
        const out = [];
        try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(LS + prefix)) out.push(JSON.parse(localStorage.getItem(k))); } } catch (e) { /* */ }
        return out;
    };

    const Store = {
        get usingFallback() { return fallback; },

        async init() {
            await open();
            try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* optional */ }
        },

        async list() {
            await open();
            const rows = fallback ? lsList('meta:') : (await tx('meta', 'readonly', os => os.getAll())) || [];
            return rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        },

        async load(id) {
            await open();
            return fallback ? lsGet('save:' + id) : tx('saves', 'readonly', os => os.get(id));
        },

        async save(S) {
            await open();
            S.updatedAt = new Date().toISOString();
            const meta = SC.Engine.summary(S);
            if (fallback) { lsSet('save:' + S.id, S); lsSet('meta:' + S.id, meta); return; }
            await tx('saves', 'readwrite', os => os.put(S));
            await tx('meta', 'readwrite', os => os.put(meta));
        },

        async remove(id) {
            await open();
            if (fallback) { lsDel('save:' + id); lsDel('meta:' + id); lsDel('kv:undo:' + id); return; }
            await tx('saves', 'readwrite', os => os.delete(id));
            await tx('meta', 'readwrite', os => os.delete(id));
            await tx('kv', 'readwrite', os => os.delete('undo:' + id));
        },

        /* ---- one-step undo (the state before the last logged race) ---- */
        async setUndo(id, json, label) {
            await open();
            const v = { k: 'undo:' + id, json, label, at: new Date().toISOString() };
            if (fallback) { try { lsSet('kv:undo:' + id, v); } catch (e) { /* undo is best-effort */ } return; }
            await tx('kv', 'readwrite', os => os.put(v));
        },
        async getUndo(id) {
            await open();
            return fallback ? lsGet('kv:undo:' + id) : tx('kv', 'readonly', os => os.get('undo:' + id));
        },
        async clearUndo(id) {
            await open();
            if (fallback) { lsDel('kv:undo:' + id); return; }
            await tx('kv', 'readwrite', os => os.delete('undo:' + id));
        },

        /* ---- Hall of Fame ---- */
        async hof() {
            await open();
            const rows = fallback ? lsList('hof:') : (await tx('hof', 'readonly', os => os.getAll())) || [];
            return rows.sort((a, b) => (b.legacy || 0) - (a.legacy || 0));
        },
        async addHof(entry) {
            await open();
            if (fallback) { lsSet('hof:' + entry.id, entry); return; }
            await tx('hof', 'readwrite', os => os.put(entry));
        },
        async removeHof(id) {
            await open();
            if (fallback) { lsDel('hof:' + id); return; }
            await tx('hof', 'readwrite', os => os.delete(id));
        },

        /* ---- backup files ---- */
        exportBlob(S) {
            const payload = { format: 'srmpc-solo-career', v: SC.Engine.SAVE_VERSION, exportedAt: new Date().toISOString(), save: S };
            return new Blob([JSON.stringify(payload)], { type: 'application/json' });
        },
        async importText(text) {
            let data;
            try { data = JSON.parse(text); } catch (e) { throw new Error('That file is not valid JSON.'); }
            const S = data && data.format === 'srmpc-solo-career' ? data.save : (data && data.player && data.teams ? data : null);
            if (!S || !S.player || !S.teams || !S.season) throw new Error('That file is not a Solo Career save.');
            if ((S.v || 1) > SC.Engine.SAVE_VERSION) throw new Error('That save comes from a newer version of the app — update first.');
            const existing = await this.load(S.id);
            if (existing) S.id = S.id + '-' + Date.now().toString(36);
            await this.save(S);
            if (S.hof) await this.addHof(S.hof);
            return S;
        }
    };

    SC.Store = Store;
})(typeof window !== 'undefined' ? window : globalThis);
