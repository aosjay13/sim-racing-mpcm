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
            coll(cname).set(id, { ...prev, ...JSON.parse(JSON.stringify(patch)) });
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
                async commit() { for (const op of ops) await op(); }
            };
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
