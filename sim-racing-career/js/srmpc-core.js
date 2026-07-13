/* ============================================================
   Phoenix SRMPC — Core
   Firebase initialization, authentication, shared helpers.
   ============================================================ */
'use strict';

// ----- Firebase configuration (project: sim-racing-career-228a3) -----
const SRMPC_FIREBASE_CONFIG = {
    apiKey: "AIzaSyAcpomoHaYuSEVCBi_FzzDT9rARmCC6--8",
    authDomain: "sim-racing-career-228a3.firebaseapp.com",
    projectId: "sim-racing-career-228a3",
    storageBucket: "sim-racing-career-228a3.appspot.com",
    messagingSenderId: "349016304868",
    appId: "1:349016304868:web:79f80e44da0342372ad0f1"
};

// ----- Firebase init -----
let fbApp = null;
let fbDb = null;
let fbAuth = null;
let fbInitError = null;

try {
    fbApp = firebase.initializeApp(SRMPC_FIREBASE_CONFIG);
    fbDb = firebase.firestore(fbApp);
    fbAuth = firebase.auth(fbApp);
    // Offline persistence is intentionally NOT enabled.
    // It previously masked failed writes (permission errors looked like
    // successful saves that later vanished). Online-first is honest.
} catch (err) {
    fbInitError = err;
    console.error('Firebase initialization failed:', err);
}

window.SRMPC = window.SRMPC || {};
SRMPC.db = fbDb;
SRMPC.firebaseError = fbInitError;

/* ============================================================
   Helpers
   ============================================================ */
const Util = {
    $(sel, root) { return (root || document).querySelector(sel); },
    $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); },

    esc(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    // Attribute-safe id (ids come from Firestore and are safe, but be defensive)
    attr(value) { return String(value ?? '').replace(/[^\w-]/g, ''); },

    todayISO() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    // Parse 'YYYY-MM-DD' as LOCAL date (new Date('YYYY-MM-DD') is UTC and
    // shifts the day for US timezones — a classic source of off-by-one races).
    parseISODate(iso) {
        if (!iso || typeof iso !== 'string') return null;
        const [y, m, d] = iso.split('-').map(Number);
        if (!y || !m || !d) return null;
        return new Date(y, m - 1, d);
    },

    fmtDate(iso) {
        const d = this.parseISODate(iso);
        if (!d) return 'TBD';
        return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    },

    fmtDateShort(iso) {
        const d = this.parseISODate(iso);
        if (!d) return 'TBD';
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    },

    fmtTime(hhmm) {
        if (!hhmm) return '';
        const [h, m] = hhmm.split(':').map(Number);
        if (Number.isNaN(h)) return '';
        const d = new Date();
        d.setHours(h, m || 0);
        return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    },

    isPast(iso) {
        const d = this.parseISODate(iso);
        if (!d) return false;
        const today = this.parseISODate(this.todayISO());
        return d < today;
    },

    ordinal(n) {
        n = Number(n);
        if (!n) return '—';
        const s = ['th', 'st', 'nd', 'rd'];
        const v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    },

    plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; },

    async sha256(text) {
        const data = new TextEncoder().encode(text);
        const buf = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    },

    // Compress an image File to a data URL small enough to live in a
    // Firestore document (used for series logos, team logos, avatars).
    compressImage(file, maxDim = 320, quality = 0.82) {
        return new Promise((resolve, reject) => {
            if (!file || !file.type.startsWith('image/')) {
                reject(new Error('Please choose an image file.'));
                return;
            }
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Could not read the image file.'));
            reader.onload = () => {
                const img = new Image();
                img.onerror = () => reject(new Error('Could not load the image.'));
                img.onload = () => {
                    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(img.width * scale));
                    canvas.height = Math.max(1, Math.round(img.height * scale));
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    // PNG keeps transparency for logos; fall back to JPEG if huge.
                    let dataUrl = canvas.toDataURL('image/png');
                    if (dataUrl.length > 220000) dataUrl = canvas.toDataURL('image/jpeg', quality);
                    if (dataUrl.length > 400000) {
                        reject(new Error('Image is too large even after compression. Try a smaller image.'));
                        return;
                    }
                    resolve(dataUrl);
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    },

    notify(message, type = 'success') {
        let holder = document.getElementById('toast-holder');
        if (!holder) {
            holder = document.createElement('div');
            holder.id = 'toast-holder';
            document.body.appendChild(holder);
        }
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
        toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${Util.esc(message)}</span>`;
        holder.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 350);
        }, type === 'error' ? 6000 : 3500);
        if (type === 'error') console.error('[SRMPC]', message);
    },

    uid() { return Math.random().toString(36).slice(2, 10); }
};
window.Util = Util;

// Global error surface — nothing fails silently.
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled rejection:', event.reason);
    const msg = event.reason?.message || String(event.reason || 'Unexpected error');
    // Firestore permission errors get a friendlier explanation.
    if (/permission|insufficient/i.test(msg)) {
        Util.notify('Save blocked by database permissions. Make sure you are signed in.', 'error');
    } else {
        Util.notify(msg, 'error');
    }
});
window.addEventListener('error', (event) => {
    console.error('Uncaught error:', event.error || event.message);
});

/* ============================================================
   Auth
   Two doors:
   • Player  — Firebase email/password account.
   • Admin   — passcode unlock. CRITICAL FIX: unlocking admin also signs
     into Firebase anonymously so Firestore security rules
     (`request.auth != null`) accept admin writes. Previously admin had no
     Firebase session, so every admin write silently failed server-side.
   ============================================================ */
const Auth = {
    _HASH_KEY: 'srmpc2_admin_hash',
    _ADMIN_SESSION_KEY: 'srmpc2_admin_session',
    _ADMIN_TTL_MS: 12 * 60 * 60 * 1000,
    // Default passcode (hash of 'phoenix13!'). Change it in Admin → Settings.
    _DEFAULT_HASH: null,
    _DEFAULT_PASSCODE: 'phoenix13!',

    state: {
        ready: false,
        mode: 'guest',          // 'guest' | 'player' | 'admin'
        user: null,             // firebase user
        profile: null,          // users/{uid} doc for players
        adminLocalOnly: false,  // admin unlocked but Firebase anon auth unavailable
        owner: false            // GM unlocked via the default ("main") career passcode
                                // → the league owner, who approves new-career requests
    },
    _listeners: [],
    _readyResolve: null,

    onChange(fn) { this._listeners.push(fn); },
    _emit() { this._listeners.forEach(fn => { try { fn(this.state); } catch (e) { console.error(e); } }); },

    isAdmin() { return this.state.mode === 'admin'; },
    // The owner = a GM who unlocked with the default career's passcode. Only the
    // owner may approve requests to create new careers / GMs.
    isOwner() { return this.state.mode === 'admin' && this.state.owner; },
    isPlayer() { return this.state.mode === 'player'; },
    isSignedIn() { return this.state.mode !== 'guest'; },
    uid() { return this.state.user?.uid || null; },

    async init() {
        this._DEFAULT_HASH = await Util.sha256(this._DEFAULT_PASSCODE);

        if (!fbAuth) {
            this.state.ready = true;
            this._emit();
            return;
        }

        await new Promise((resolve) => {
            let first = true;
            fbAuth.onAuthStateChanged(async (user) => {
                this.state.user = user || null;

                // Live re-check (NOT a value captured at page load): unlocking
                // admin at the gate saves the session and THEN signs in
                // anonymously — a stale captured value made this listener treat
                // that fresh anon session as orphaned and sign the GM back out.
                const adminSession = this._loadAdminSession();
                if (adminSession) {
                    // Valid admin session — make sure we hold a Firebase session too.
                    this.state.mode = 'admin';
                    this.state.owner = !!adminSession.owner; // survives reloads
                    if (!user) await this._ensureAdminFirebaseAuth();
                } else if (user && user.isAnonymous) {
                    // Anonymous session without an admin unlock is stale — drop it.
                    this.state.mode = 'guest';
                    try { await fbAuth.signOut(); } catch (e) { /* ignore */ }
                } else if (user) {
                    this.state.mode = 'player';
                    await this._loadProfile(user);
                } else {
                    this.state.mode = 'guest';
                    this.state.profile = null;
                }

                if (first) { first = false; this.state.ready = true; resolve(); }
                this._emit();
            });
        });
    },

    async _loadProfile(user) {
        try {
            // Profiles are per-career: a player's role / driver / team / wallet
            // live in the ACTIVE career's members collection, so the same login
            // is a fresh, separate identity in every career.
            const coll = Careers.collName('users');
            const snap = await fbDb.collection(coll).doc(user.uid).get();
            if (snap.exists) {
                this.state.profile = { id: snap.id, ...snap.data() };
            } else if (user && !user.isAnonymous) {
                // First time this player has entered THIS career — seed a fresh,
                // roleless profile (named from their login) so they land on the
                // role picker instead of a nameless void.
                const seed = {
                    displayName: user.displayName || (user.email || '').split('@')[0] || 'Player',
                    email: user.email || '',
                    activeRole: null, driverId: null, teamId: null,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                try { await fbDb.collection(coll).doc(user.uid).set(seed, { merge: true }); } catch (e) { /* rules/offline — role picker still works */ }
                this.state.profile = { id: user.uid, ...seed };
            } else {
                this.state.profile = null;
            }
        } catch (e) {
            console.error('Could not load user profile:', e);
            this.state.profile = null;
        }
    },

    async reloadProfile() {
        if (this.state.user && !this.state.user.isAnonymous) {
            await this._loadProfile(this.state.user);
            this._emit();
        }
    },

    async updateProfile(patch) {
        const uid = this.uid();
        if (!uid) throw new Error('Not signed in.');
        await fbDb.collection(Careers.collName('users')).doc(uid).set({
            ...patch,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        await this.reloadProfile();
    },

    // ----- Player -----
    async playerSignUp(email, password, displayName) {
        if (!fbAuth) throw new Error('Firebase Auth is not available.');
        const cred = await fbAuth.createUserWithEmailAndPassword(email.trim(), password);
        if (displayName?.trim()) {
            try { await cred.user.updateProfile({ displayName: displayName.trim() }); } catch (e) { /* non-fatal */ }
        }
        await fbDb.collection(Careers.collName('users')).doc(cred.user.uid).set({
            displayName: displayName?.trim() || email.split('@')[0],
            email: email.trim(),
            activeRole: null,
            driverId: null,
            teamId: null,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        await this._loadProfile(cred.user);
        return cred.user;
    },

    async playerSignIn(email, password) {
        if (!fbAuth) throw new Error('Firebase Auth is not available.');
        const cred = await fbAuth.signInWithEmailAndPassword(email.trim(), password);
        return cred.user;
    },

    async sendPasswordReset(email) {
        if (!fbAuth) throw new Error('Firebase Auth is not available.');
        await fbAuth.sendPasswordResetEmail(email.trim());
    },

    // ----- Admin -----
    // The active passcode hash lives in Firestore (config/admin) so the Game
    // Master works on every device. localStorage is a per-device cache, and the
    // built-in default is the final fallback — so a failed cloud read can never
    // lock the admin out.
    async _remotePasscodeHash() {
        if (!fbDb) return null;
        try {
            const snap = await fbDb.collection('config').doc('admin').get();
            return snap.exists ? (snap.data().passcodeHash || null) : null;
        } catch (e) {
            console.warn('Could not read admin config; falling back to local hash.', e);
            return null;
        }
    },

    async _activeHash() {
        const remote = await this._remotePasscodeHash();
        return remote || localStorage.getItem(this._HASH_KEY) || this._DEFAULT_HASH;
    },

    // Verify against the ACTIVE career's passcode (each career has its own).
    async verifyPasscode(passcode) {
        const hash = await Util.sha256(String(passcode || '').trim());
        const target = await Careers.passcodeHashFor(Careers.activeId);
        return !!target && hash === target;
    },

    // Change the ACTIVE career's passcode. Careers.changePasscode keeps the
    // legacy config/admin hash in sync for the default ("main") career so old
    // fallbacks still agree.
    async changePasscode(currentPasscode, newPasscode) {
        await Careers.changePasscode(Careers.activeId, currentPasscode, newPasscode);
    },

    _saveAdminSession(owner = false) {
        localStorage.setItem(this._ADMIN_SESSION_KEY, JSON.stringify({ expiresAt: Date.now() + this._ADMIN_TTL_MS, owner: !!owner }));
    },

    _loadAdminSession() {
        try {
            const raw = localStorage.getItem(this._ADMIN_SESSION_KEY);
            if (!raw) return null;
            const s = JSON.parse(raw);
            if (!s?.expiresAt || s.expiresAt < Date.now()) {
                localStorage.removeItem(this._ADMIN_SESSION_KEY);
                return null;
            }
            return s;
        } catch { return null; }
    },

    async _ensureAdminFirebaseAuth() {
        this.state.adminLocalOnly = false;
        if (fbAuth.currentUser) { this.state.user = fbAuth.currentUser; return; }
        try {
            const cred = await fbAuth.signInAnonymously();
            this.state.user = cred.user;
        } catch (e) {
            console.error('Anonymous sign-in failed:', e);
            this.state.adminLocalOnly = true;
            Util.notify('Admin unlocked, but Firebase anonymous sign-in is disabled — database saves will be rejected. Enable it: Firebase Console → Authentication → Sign-in method → Anonymous.', 'error');
        }
    },

    async unlockAdmin(passcode) {
        if (!(await this.verifyPasscode(passcode))) throw new Error('Incorrect passcode.');
        const owner = Careers.activeId === Careers.DEFAULT_ID;
        this._saveAdminSession(owner);
        this.state.mode = 'admin';
        this.state.owner = owner;
        await this._ensureAdminFirebaseAuth();
        this._registerGm();
        this._emit();
    },

    // Elevate a signed-in player to admin (keeps their player account signed in).
    async elevateToAdmin(passcode) {
        if (!(await this.verifyPasscode(passcode))) throw new Error('Incorrect passcode.');
        const owner = Careers.activeId === Careers.DEFAULT_ID;
        this._saveAdminSession(owner);
        this.state.mode = 'admin';
        this.state.owner = owner;
        this._registerGm();
        this._emit();
    },

    // Register this session's auth uid in config/admin.gmUids so the deployed
    // firestore.rules isGM() grants it the global override. Fire-and-forget:
    // if the write fails, only rules that key off isGM are affected, and the
    // GM sees it the moment such a write is rejected.
    async _registerGm() {
        try {
            const uid = this.uid();
            if (!uid || !fbDb) return;
            const snap = await fbDb.collection('config').doc('admin').get();
            const uids = (snap.exists && Array.isArray(snap.data().gmUids)) ? snap.data().gmUids : [];
            if (!uids.includes(uid)) {
                await fbDb.collection('config').doc('admin').set({ gmUids: [...uids, uid] }, { merge: true });
            }
        } catch (e) { console.warn('GM registry update failed (rules override may not apply):', e); }
    },

    // Drop Game Master powers without a full sign-out: an elevated player
    // returns to their player career; a passcode-only (anonymous Firebase)
    // session has no player account underneath, so it signs out to the gate.
    async dropAdmin() {
        localStorage.removeItem(this._ADMIN_SESSION_KEY);
        this.state.owner = false;
        const user = fbAuth?.currentUser;
        if (user && !user.isAnonymous) {
            this.state.mode = 'player';
            this.state.adminLocalOnly = false;
            await this._loadProfile(user);
            this._emit();
        } else {
            await this.signOut();
        }
    },

    async signOut() {
        localStorage.removeItem(this._ADMIN_SESSION_KEY);
        this.state.mode = 'guest';
        this.state.profile = null;
        this.state.adminLocalOnly = false;
        this.state.owner = false;
        if (fbAuth?.currentUser) {
            try { await fbAuth.signOut(); } catch (e) { console.warn('Sign-out error:', e); }
        } else {
            this._emit();
        }
    }
};
window.Auth = Auth;

/* ============================================================
   Careers — multiple isolated career modes.

   Each career is a fully separate world: series, races, teams, drivers,
   members (roles/wallets), deals, ledger — everything. Isolation is by
   COLLECTION-NAME NAMESPACING, so the whole app keeps funnelling through
   DB._fs().collection(name):

     • the default career ("main") uses UNPREFIXED names (`series`, `races`…)
       — the existing live world simply IS career "main", no migration.
     • every other career `cid` uses `c__{cid}__{name}` (cid is base36, no
       underscores, so the firestore.rules prefix regex is unambiguous).

   The `careers` registry (global, unprefixed) holds one doc per career:
   { name, passcodeHash, createdAt, updatedAt }. "main" is VIRTUAL until the
   GM renames it or changes its passcode — that way nothing is written to
   Firestore at boot (guests can't write) and the current passcode keeps
   working via the legacy config/admin fallback chain.

   GM security is intentionally SHARED (see firestore.rules isGM()): unlocking
   any career's passcode registers the uid globally and grants the wildcard
   override across all careers. Per-career passcodes gate who can UNLOCK GM for
   a career; the app only ever shows one career's data at a time.
   ============================================================ */
const Careers = {
    KEY: 'srmpc_active_career',
    DEFAULT_ID: 'main',
    DEFAULT_NAME: 'Phoenix SRMPC',
    activeId: 'main',
    activeName: 'Phoenix SRMPC',
    _list: null,

    // Physical collection name for a given career + logical name.
    collNameFor(id, name) {
        return (!id || id === this.DEFAULT_ID) ? name : `c__${id}__${name}`;
    },
    // Physical collection name for the ACTIVE career.
    collName(name) { return this.collNameFor(this.activeId, name); },

    async init() {
        try {
            const saved = localStorage.getItem(this.KEY);
            if (saved) this.activeId = saved;
        } catch (e) { /* private mode */ }
        await this.list({ force: true }).catch(() => {});
        // A saved career that no longer exists falls back to the default.
        if (!(this._list || []).some(c => c.id === this.activeId)) {
            this.activeId = this.DEFAULT_ID;
            try { localStorage.setItem(this.KEY, this.activeId); } catch (e) { /* */ }
        }
        this.activeName = this.nameFor(this.activeId);
    },

    async list({ force = false } = {}) {
        if (this._list && !force) return this._list;
        const docs = [];
        try {
            if (fbDb) {
                const snap = await fbDb.collection('careers').get();
                snap.forEach(d => docs.push({ id: d.id, ...d.data() }));
            }
        } catch (e) { console.warn('Could not load careers registry:', e); }
        // "main" always exists — virtual until persisted.
        if (!docs.some(c => c.id === this.DEFAULT_ID)) {
            docs.push({ id: this.DEFAULT_ID, name: this.DEFAULT_NAME, virtual: true });
        }
        // Default career first, then alphabetical.
        docs.sort((a, b) =>
            a.id === this.DEFAULT_ID ? -1 : b.id === this.DEFAULT_ID ? 1
            : (a.name || '').localeCompare(b.name || ''));
        this._list = docs;
        return docs;
    },

    nameFor(id) {
        const c = (this._list || []).find(x => x.id === id);
        return c?.name || (id === this.DEFAULT_ID ? this.DEFAULT_NAME : id);
    },

    setActive(id, name) {
        this.activeId = id;
        this.activeName = name || this.nameFor(id);
        try { localStorage.setItem(this.KEY, id); } catch (e) { /* */ }
        if (window.DB) DB.invalidate(); // never let one career's cache bleed into another
    },

    // The passcode hash that unlocks GM for a career. "main" with no persisted
    // doc falls back to the legacy config/admin → localStorage → default chain,
    // so the current league passcode keeps working untouched.
    async passcodeHashFor(id) {
        const c = (this._list || []).find(x => x.id === id);
        if (c && c.passcodeHash) return c.passcodeHash;
        if (id === this.DEFAULT_ID) return await Auth._activeHash();
        return null;
    },

    // Write a career registry doc from an already-hashed passcode. Shared by
    // create() (owner, direct) and approveRequest() (owner approving a request).
    async _persistCareer(name, passcodeHash) {
        if (!fbDb) throw new Error('Database is not connected.');
        const id = Util.uid();
        await fbDb.collection('careers').doc(id).set({
            name,
            passcodeHash,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await this.list({ force: true });
        return id;
    },

    _validateNewCareer(name, passcode) {
        const nm = String(name || '').trim();
        if (!nm) throw new Error('Give the career mode a name.');
        const pass = String(passcode || '').trim();
        if (pass.length < 6) throw new Error('The GM passcode must be at least 6 characters.');
        return { nm, pass };
    },

    // Owner-only direct create.
    async create(name, passcode) {
        const { nm, pass } = this._validateNewCareer(name, passcode);
        return this._persistCareer(nm, await Util.sha256(pass));
    },

    /* ---- New-career REQUEST queue (owner approval) ----
       Anyone signed in can request a new career/GM; it does not exist until the
       owner approves. Requests live in the global `careerRequests` collection:
       { name, passcodeHash, requestedBy, requestedByLabel, status, createdAt }. */
    async requestCreate(name, passcode) {
        const { nm, pass } = this._validateNewCareer(name, passcode);
        if (!fbDb) throw new Error('Database is not connected.');
        await fbDb.collection('careerRequests').add({
            name: nm,
            passcodeHash: await Util.sha256(pass),
            requestedBy: Auth.uid() || null,
            requestedByLabel: Auth.state.profile?.displayName || Auth.state.user?.email || 'A league member',
            status: 'pending',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    },

    async listRequests() {
        if (!fbDb) return [];
        const snap = await fbDb.collection('careerRequests').get();
        const docs = [];
        snap.forEach(d => docs.push({ id: d.id, ...d.data() }));
        docs.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        return docs;
    },

    async approveRequest(reqId) {
        if (!fbDb) throw new Error('Database is not connected.');
        const snap = await fbDb.collection('careerRequests').doc(reqId).get();
        if (!snap.exists) throw new Error('Request not found.');
        const req = snap.data();
        if (req.status !== 'pending') throw new Error('This request has already been decided.');
        const id = await this._persistCareer(req.name, req.passcodeHash);
        await fbDb.collection('careerRequests').doc(reqId).set(
            { status: 'approved', careerId: id, decidedAt: firebase.firestore.FieldValue.serverTimestamp() },
            { merge: true });
        return id;
    },

    async denyRequest(reqId) {
        if (!fbDb) throw new Error('Database is not connected.');
        await fbDb.collection('careerRequests').doc(reqId).set(
            { status: 'denied', decidedAt: firebase.firestore.FieldValue.serverTimestamp() },
            { merge: true });
    },

    async rename(id, name) {
        const nm = String(name || '').trim();
        if (!nm) throw new Error('Enter a name.');
        if (!fbDb) throw new Error('Database is not connected.');
        const patch = { name: nm, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
        // First time we persist "main", carry its passcode + createdAt so nothing regresses.
        const existing = (this._list || []).find(c => c.id === id);
        if (id === this.DEFAULT_ID && (!existing || existing.virtual)) {
            patch.passcodeHash = await Auth._activeHash();
            patch.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        }
        await fbDb.collection('careers').doc(id).set(patch, { merge: true });
        await this.list({ force: true });
        if (id === this.activeId) this.activeName = nm;
    },

    async changePasscode(id, currentPasscode, newPasscode) {
        const activeHash = await this.passcodeHashFor(id);
        const currentHash = await Util.sha256(String(currentPasscode || '').trim());
        if (activeHash && currentHash !== activeHash) throw new Error('Current passcode is incorrect.');
        const trimmed = String(newPasscode || '').trim();
        if (trimmed.length < 6) throw new Error('New passcode must be at least 6 characters.');
        const newHash = await Util.sha256(trimmed);
        if (!fbDb) throw new Error('Database is not connected.');
        const patch = { passcodeHash: newHash, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
        const existing = (this._list || []).find(c => c.id === id);
        if (id === this.DEFAULT_ID && (!existing || existing.virtual)) {
            patch.name = existing?.name || this.DEFAULT_NAME;
            patch.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        }
        await fbDb.collection('careers').doc(id).set(patch, { merge: true });
        // Keep the legacy admin hash in sync for the default career.
        if (id === this.DEFAULT_ID) {
            try { localStorage.setItem(Auth._HASH_KEY, newHash); } catch (e) { /* */ }
            try {
                await fbDb.collection('config').doc('admin').set(
                    { passcodeHash: newHash, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
                    { merge: true });
            } catch (e) { /* non-fatal: registry doc is the source of truth now */ }
        }
        await this.list({ force: true });
    },

    // Remove the registry doc only. Call DB.wipeCareer(id) first to clear the
    // career's world data. The default career cannot be deleted.
    async deleteCareer(id) {
        if (id === this.DEFAULT_ID) throw new Error('The default career cannot be deleted.');
        if (!fbDb) throw new Error('Database is not connected.');
        await fbDb.collection('careers').doc(id).delete();
        await this.list({ force: true });
    }
};
window.Careers = Careers;
