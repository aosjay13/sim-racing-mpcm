// In-memory Firebase compat shim — same surface the app uses, zero network.
(() => {
    const store = new Map(); // collection -> Map(id -> data)
    let idSeq = 1;
    const newId = () => 'doc' + (idSeq++);
    const coll = (name) => {
        if (!store.has(name)) store.set(name, new Map());
        return store.get(name);
    };
    const snapshotOf = (id, data) => ({
        id, exists: data !== undefined,
        data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined)
    });

    const docRef = (cname, id) => ({
        id,
        _cname: cname,
        async get() { return snapshotOf(id, coll(cname).get(id)); },
        async set(data, opts = {}) {
            const prev = (opts.merge && coll(cname).get(id)) || {};
            coll(cname).set(id, { ...prev, ...JSON.parse(JSON.stringify(data)) });
        },
        async update(patch) {
            const prev = coll(cname).get(id) || {};
            const next = { ...prev };
            // Real-SDK semantics: dotted keys are field paths into nested maps.
            for (const [k, v] of Object.entries(JSON.parse(JSON.stringify(patch)))) {
                if (k.includes('.')) {
                    const parts = k.split('.');
                    let node = next;
                    for (let i = 0; i < parts.length - 1; i++) {
                        node[parts[i]] = { ...(node[parts[i]] || {}) };
                        node = node[parts[i]];
                    }
                    node[parts[parts.length - 1]] = v;
                } else next[k] = v;
            }
            coll(cname).set(id, next);
        },
        async delete() { coll(cname).delete(id); }
    });

    const firestoreInstance = {
        collection(cname) {
            return {
                doc(id) { return docRef(cname, id || newId()); },
                async add(data) {
                    const ref = docRef(cname, newId());
                    await ref.set(data);
                    return ref;
                },
                async get() {
                    const docs = Array.from(coll(cname).entries()).map(([id, d]) => snapshotOf(id, d));
                    return { forEach: (cb) => docs.forEach(cb) };
                }
            };
        },
        batch() {
            const ops = [];
            return {
                set(ref, data) { ops.push(() => ref.set(data)); },
                update(ref, patch) { ops.push(() => ref.update(patch)); },
                delete(ref) { ops.push(() => ref.delete()); },
                async commit() { for (const op of ops) await op(); }
            };
        },
        // Reads happen immediately (in-memory, no real contention to guard
        // against); writes queue and apply after the update function
        // resolves — same get-before-write discipline the real SDK enforces,
        // enough to back Wallet.executeRoleTransaction's atomic transfers.
        async runTransaction(updateFn) {
            const ops = [];
            const tx = {
                async get(ref) { return ref.get(); },
                set(ref, data, opts) { ops.push(() => ref.set(data, opts)); },
                update(ref, patch) { ops.push(() => ref.update(patch)); },
                delete(ref) { ops.push(() => ref.delete()); }
            };
            const result = await updateFn(tx);
            for (const op of ops) await op();
            return result;
        }
    };

    // ---- Auth ----
    const listeners = [];
    const authInstance = {
        currentUser: null,
        onAuthStateChanged(cb) {
            listeners.push(cb);
            setTimeout(() => cb(authInstance.currentUser), 0);
        },
        // Real SDK fires listeners asynchronously — match that.
        _fire() { setTimeout(() => listeners.forEach(cb => cb(authInstance.currentUser)), 0); },
        async signInAnonymously() {
            authInstance.currentUser = { uid: 'anon-gm', isAnonymous: true };
            authInstance._fire();
            return { user: authInstance.currentUser };
        },
        async createUserWithEmailAndPassword(email) {
            authInstance.currentUser = {
                uid: 'user-' + email.replace(/\W/g, ''), email, isAnonymous: false,
                updateProfile: async () => {}
            };
            authInstance._fire();
            return { user: authInstance.currentUser };
        },
        async signInWithEmailAndPassword(email) {
            return authInstance.createUserWithEmailAndPassword(email);
        },
        async sendPasswordResetEmail() {},
        async signOut() { authInstance.currentUser = null; authInstance._fire(); }
    };

    const firestoreFn = () => firestoreInstance;
    firestoreFn.FieldValue = { serverTimestamp: () => ({ seconds: Math.floor(Date.now() / 1000) }) };

    window.firebase = {
        initializeApp: () => ({ name: 'shim' }),
        firestore: firestoreFn,
        auth: () => authInstance
    };
    window.__shimStore = store; // test introspection
})();
