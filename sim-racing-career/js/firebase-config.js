// Firebase Configuration
// IMPORTANT: Replace these values with your own Firebase project credentials
// Get these from https://console.firebase.google.com

const firebaseConfig = {
    apiKey: "AIzaSyAcpomoHaYuSEVCBi_FzzDT9rARmCC6--8",
    authDomain: "sim-racing-career-228a3.firebaseapp.com",
    projectId: "sim-racing-career-228a3",
    storageBucket: "sim-racing-career-228a3.appspot.com",
    messagingSenderId: "349016304868",
    appId: "1:349016304868:web:79f80e44da0342372ad0f1",
    appCheckSiteKey: "",
    appCheckDebugToken: "",
    enableAnonymousAuth: true
};

const FIREBASE_CONFIG_STORAGE_KEY = 'srmpc_firebase_config';

function getStoredFirebaseConfig() {
    try {
        const raw = localStorage.getItem(FIREBASE_CONFIG_STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (error) {
        console.warn('Stored Firebase config is invalid JSON, ignoring it.');
        return null;
    }
}

function isValidFirebaseConfig(config) {
    if (!config || typeof config !== 'object') return false;

    const requiredKeys = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
    const hasAllKeys = requiredKeys.every((key) => typeof config[key] === 'string' && config[key].trim() !== '');

    if (!hasAllKeys) return false;

    const hasPlaceholderValues = Object.values(config).some((value) =>
        /YOUR_|your-project|YOUR_PROJECT/i.test(value)
    );

    return !hasPlaceholderValues;
}

function getFirebaseConfig() {
    // Highest priority: browser-stored config for quick updates without redeploy.
    const storedConfig = getStoredFirebaseConfig();
    if (isValidFirebaseConfig(storedConfig)) {
        return storedConfig;
    }

    // Default: hosted config committed with the app.
    return firebaseConfig;
}

function normalizeFirebaseConfig(config) {
    const normalized = { ...config };

    // Compat SDKs are more reliable with appspot buckets.
    if (typeof normalized.storageBucket === 'string' && normalized.storageBucket.endsWith('.firebasestorage.app')) {
        normalized.storageBucket = normalized.storageBucket.replace('.firebasestorage.app', '.appspot.com');
    }

    return normalized;
}

window.SRMPCFirebase = {
    setConfig(config) {
        if (!isValidFirebaseConfig(config)) {
            throw new Error('Invalid Firebase config. Include all required Firebase web app keys.');
        }
        localStorage.setItem(FIREBASE_CONFIG_STORAGE_KEY, JSON.stringify(config));
        console.log('Firebase config saved. Reloading app...');
        window.location.reload();
    },

    clearConfig() {
        localStorage.removeItem(FIREBASE_CONFIG_STORAGE_KEY);
        console.log('Stored Firebase config removed. Reloading app...');
        window.location.reload();
    },

    quickSetup() {
        const existing = getStoredFirebaseConfig() || {};
        const config = {
            apiKey: window.prompt('Firebase apiKey', existing.apiKey || ''),
            authDomain: window.prompt('Firebase authDomain', existing.authDomain || ''),
            projectId: window.prompt('Firebase projectId', existing.projectId || ''),
            storageBucket: window.prompt('Firebase storageBucket', existing.storageBucket || ''),
            messagingSenderId: window.prompt('Firebase messagingSenderId', existing.messagingSenderId || ''),
            appId: window.prompt('Firebase appId', existing.appId || ''),
            appCheckSiteKey: window.prompt('Firebase App Check site key (optional but recommended)', existing.appCheckSiteKey || ''),
            enableAnonymousAuth: true
        };

        this.setConfig(config);
    }
};

// Initialize Firebase (Firestore only — auth is handled locally via passcode)
let db;
let auth;
let storage;
let firebaseInitError;

try {
    const runtimeFirebaseConfig = normalizeFirebaseConfig(getFirebaseConfig());

    if (!isValidFirebaseConfig(runtimeFirebaseConfig)) {
        throw new Error('Firebase config is missing or still using placeholders.');
    }

    const app = firebase.initializeApp(runtimeFirebaseConfig);
    db = firebase.firestore(app);

    try {
        auth = firebase.auth(app);
    } catch (error) {
        console.warn('Firebase Auth init failed, continuing without member auth:', error);
    }

    try {
        storage = firebase.storage(app);
    } catch (error) {
        console.warn('Firebase Storage init failed, continuing without storage:', error);
    }

    if (!db) {
        throw new Error('Firestore failed to initialize.');
    }

    // Enable offline persistence
    db.enablePersistence().catch((err) => {
        if (err.code === 'failed-precondition') {
            console.warn('Multiple tabs open, persistence can only be enabled in one tab at a time.');
        } else if (err.code === 'unimplemented') {
            console.warn('The current browser does not support all of the features required to enable persistence');
        }
    });

    console.log('Firebase (Firestore) initialized successfully');
} catch (error) {
    firebaseInitError = error;
    console.error('Firebase initialization error:', error);
    console.warn('Firebase not yet configured. Please update firebase-config.js with your credentials.');
    console.warn('Or run this in the browser console to save config locally: SRMPCFirebase.setConfig({...})');
    console.warn('Quick option: SRMPCFirebase.quickSetup()');
    console.warn('Get your config from: https://console.firebase.google.com');
}

window.getFirebaseInitStatus = function getFirebaseInitStatus() {
    return {
        initialized: Boolean(db),
        hasStorage: Boolean(storage),
        error: firebaseInitError ? (firebaseInitError.message || String(firebaseInitError)) : null
    };
};

// Firebase Helper Functions
const DatabaseHelper = {
    ensureFirebaseReadySync() {
        if (db) return;
        const debugStatus = window.getFirebaseInitStatus ? window.getFirebaseInitStatus() : null;
        const initErrorMessage = debugStatus && debugStatus.error ? ` Root cause: ${debugStatus.error}` : '';
        throw new Error(`Firebase not initialized.${initErrorMessage} Run getFirebaseInitStatus() in the browser console for details.`);
    },

    async ensureFirebaseReady() {
        this.ensureFirebaseReadySync();
    },

    /**
     * Add a new document to a collection
     */
    async addDocument(collectionName, data) {
        try {
            await this.ensureFirebaseReady();
            const docRef = await db.collection(collectionName).add({
                ...data,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            return docRef.id;
        } catch (error) {
            console.error(`Error adding ${collectionName}:`, error);
            throw error;
        }
    },

    /**
     * Update a document
     */
    async updateDocument(collectionName, docId, data) {
        try {
            await this.ensureFirebaseReady();
            await db.collection(collectionName).doc(docId).update({
                ...data,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (error) {
            console.error(`Error updating ${collectionName}:`, error);
            throw error;
        }
    },

    /**
     * Delete a document
     */
    async deleteDocument(collectionName, docId) {
        try {
            await this.ensureFirebaseReady();
            await db.collection(collectionName).doc(docId).delete();
        } catch (error) {
            console.error(`Error deleting ${collectionName}:`, error);
            throw error;
        }
    },

    /**
     * Get a single document
     */
    async getDocument(collectionName, docId) {
        try {
            await this.ensureFirebaseReady();
            const doc = await db.collection(collectionName).doc(docId).get();
            if (doc.exists) {
                return { id: doc.id, ...doc.data() };
            }
            return null;
        } catch (error) {
            console.error(`Error getting ${collectionName}:`, error);
            throw error;
        }
    },

    /**
     * Get all documents from a collection
     */
    async getCollection(collectionName, constraints = []) {
        try {
            await this.ensureFirebaseReady();
            let query = db.collection(collectionName);

            // Apply constraints if provided
            for (const [field, operator, value] of constraints) {
                query = query.where(field, operator, value);
            }

            const snapshot = await query.get();
            const documents = [];
            snapshot.forEach(doc => {
                documents.push({ id: doc.id, ...doc.data() });
            });
            return documents;
        } catch (error) {
            console.error(`Error getting ${collectionName}:`, error);
            throw error;
        }
    },

    /**
     * Query collection with ordering and limiting
     */
    async queryCollection(collectionName, filters = [], orderBy = null, limit = null) {
        try {
            await this.ensureFirebaseReady();
            let query = db.collection(collectionName);

            // Apply filters
            for (const filter of filters) {
                query = query.where(filter.field, filter.operator, filter.value);
            }

            // Apply ordering
            if (orderBy) {
                query = query.orderBy(orderBy.field, orderBy.direction || 'asc');
            }

            // Apply limit
            if (limit) {
                query = query.limit(limit);
            }

            const snapshot = await query.get();
            const documents = [];
            snapshot.forEach(doc => {
                documents.push({ id: doc.id, ...doc.data() });
            });
            return documents;
        } catch (error) {
            console.error(`Error querying ${collectionName}:`, error);
            throw error;
        }
    },

    /**
     * Set up real-time listener
     */
    listenToCollection(collectionName, callback, constraints = []) {
        try {
            this.ensureFirebaseReadySync();
            let query = db.collection(collectionName);

            // Apply constraints if provided
            for (const [field, operator, value] of constraints) {
                query = query.where(field, operator, value);
            }

            const unsubscribe = query.onSnapshot((snapshot) => {
                const documents = [];
                snapshot.forEach(doc => {
                    documents.push({ id: doc.id, ...doc.data() });
                });
                callback(documents);
            }, (error) => {
                console.error(`Error listening to ${collectionName}:`, error);
            });

            return () => unsubscribe();
        } catch (error) {
            console.error(`Error setting up listener:`, error);
            return () => {};
        }
    },

    /**
     * Batch write operations
     */
    async batchWrite(operations) {
        try {
            await this.ensureFirebaseReady();
            const batch = db.batch();

            for (const op of operations) {
                const docRef = db.collection(op.collection).doc(op.id);
                if (op.type === 'set') {
                    batch.set(docRef, op.data);
                } else if (op.type === 'update') {
                    batch.update(docRef, op.data);
                } else if (op.type === 'delete') {
                    batch.delete(docRef);
                }
            }

            await batch.commit();
        } catch (error) {
            console.error('Error in batch write:', error);
            throw error;
        }
    }
};

// ===== PASSCODE-BASED AUTH (replaces Firebase Auth) =====
const AuthService = {
    _PASSCODE_HASH_KEY: 'srmpc_admin_passcode_hash',
    _SESSION_KEY: 'srmpc_session',
    _SESSION_TTL_MS: 8 * 60 * 60 * 1000, // 8 hours
    _listeners: [],
    _isAdmin: false,
    _isMember: false,
    _memberUid: null,
    _memberEmail: null,
    _auth: null,
    _displayName: '',
    _isAuthenticated: false,

    async _sha256(text) {
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    },

    hasAdminPasscode() {
        // A passcode is always defined via _DEFAULT_PASSCODE.
        return Boolean(this._DEFAULT_PASSCODE);
    },

    async setAdminPasscode(passcode) {
        const trimmed = String(passcode || '').trim();
        if (trimmed.length < 4) {
            throw new Error('Passcode must be at least 4 characters.');
        }
        const hash = await this._sha256(trimmed);
        localStorage.setItem(this._PASSCODE_HASH_KEY, hash);
        console.log('Admin passcode saved.');
    },

    async verifyAdminPasscode(passcode) {
        // Always verify against the hardcoded passcode — ignores any
        // previously stored localStorage hash to avoid stale-hash issues.
        const inputHash = await this._sha256(String(passcode || '').trim());
        const correctHash = await this._sha256(this._DEFAULT_PASSCODE);
        return inputHash === correctHash;
    },

    _saveSession(isAdmin, displayName, isMember = false, memberUid = null, memberEmail = null) {
        const session = {
            isAdmin: Boolean(isAdmin),
            isMember: Boolean(isMember),
            memberUid: memberUid || null,
            memberEmail: memberEmail || null,
            displayName: displayName || '',
            isAuthenticated: true,
            expiresAt: Date.now() + this._SESSION_TTL_MS
        };
        localStorage.setItem(this._SESSION_KEY, JSON.stringify(session));
    },

    _loadSession() {
        try {
            const raw = localStorage.getItem(this._SESSION_KEY);
            if (!raw) return null;
            const session = JSON.parse(raw);
            if (!session || !session.expiresAt || session.expiresAt < Date.now()) {
                localStorage.removeItem(this._SESSION_KEY);
                return null;
            }
            return session;
        } catch {
            return null;
        }
    },

    // Default admin passcode.
    // Verification hashes user input and compares against this value at runtime.
    _DEFAULT_PASSCODE: 'phoenix13!',

    init() {
        this._readyPromise = (async () => {
            // Restore session from localStorage
            const session = this._loadSession();
            if (session && session.isAdmin) {
                // Admin passcode session — validate version stamp
                const storedVersion = localStorage.getItem('srmpc_passcode_version');
                const currentVersion = 'v3';
                if (storedVersion !== currentVersion) {
                    localStorage.removeItem(this._SESSION_KEY);
                    localStorage.removeItem(this._PASSCODE_HASH_KEY);
                    localStorage.setItem('srmpc_passcode_version', currentVersion);
                } else {
                    this._isAuthenticated = true;
                    this._isAdmin = true;
                    this._displayName = session.displayName || '';
                }
            } else if (session && session.isMember) {
                // Member session placeholder — Firebase Auth listener below validates it
                this._displayName = session.displayName || '';
            } else if (session) {
                this._isAuthenticated = true;
                this._isAdmin = false;
                this._displayName = session.displayName || '';
            }

            // Subscribe to Firebase Auth for member accounts
            const fbAuth = auth || (window.firebase && typeof window.firebase.auth === 'function' ? window.firebase.auth() : null);
            if (fbAuth) {
                this._auth = fbAuth;
                // Wait for the initial auth state before resolving init
                await new Promise((resolve) => {
                    const unsub = fbAuth.onAuthStateChanged((user) => {
                        unsub();
                        if (user && !this._isAdmin) {
                            this._isAuthenticated = true;
                            this._isMember = true;
                            this._memberUid = user.uid;
                            this._memberEmail = user.email;
                            this._displayName = user.displayName || user.email?.split('@')[0] || 'Member';
                            this._saveSession(false, this._displayName, true, user.uid, user.email);
                        } else if (!user && session?.isMember) {
                            // Firebase says no user — clear stale member session
                            this._isAuthenticated = false;
                            this._isMember = false;
                            this._memberUid = null;
                            this._memberEmail = null;
                            this._displayName = '';
                            localStorage.removeItem(this._SESSION_KEY);
                        }
                        resolve();
                    });
                });

                // Ongoing watcher for sign-in / sign-out events
                fbAuth.onAuthStateChanged((user) => {
                    if (this._isAdmin) return; // Admin passcode takes priority
                    if (user) {
                        const changed = !this._isMember || this._memberUid !== user.uid;
                        this._isAuthenticated = true;
                        this._isMember = true;
                        this._memberUid = user.uid;
                        this._memberEmail = user.email;
                        this._displayName = user.displayName || user.email?.split('@')[0] || 'Member';
                        this._saveSession(false, this._displayName, true, user.uid, user.email);
                        if (changed) this._notifyListeners();
                    } else if (this._isMember) {
                        const wasAuth = this._isAuthenticated;
                        this._isAuthenticated = false;
                        this._isMember = false;
                        this._memberUid = null;
                        this._memberEmail = null;
                        this._displayName = '';
                        localStorage.removeItem(this._SESSION_KEY);
                        if (wasAuth) this._notifyListeners();
                    }
                });
            }

            // Defer listener notification so callers can register first
            Promise.resolve().then(() => this._notifyListeners());
        })();
        return this._readyPromise;
    },

    async waitUntilReady() {
        return this._readyPromise || Promise.resolve();
    },

    onAuthStateChanged(listener) {
        this._listeners.push(listener);
        Promise.resolve().then(() => {
            try {
                const uid = this._isMember ? this._memberUid : 'local';
                listener({
                    user: this._isAuthenticated ? {
                        displayName: this._displayName,
                        uid,
                        email: this._memberEmail || null
                    } : null,
                    isAdmin: this._isAdmin,
                    isMember: this._isMember,
                    isAuthenticated: this._isAuthenticated
                });
            } catch (e) {
                console.error('Auth listener error:', e);
            }
        });
        return () => {
            this._listeners = this._listeners.filter(cb => cb !== listener);
        };
    },

    _notifyListeners() {
        const uid = this._isMember ? this._memberUid : 'local';
        const payload = {
            user: this._isAuthenticated ? {
                displayName: this._displayName,
                uid,
                email: this._memberEmail || null
            } : null,
            isAdmin: this._isAdmin,
            isMember: this._isMember,
            isAuthenticated: this._isAuthenticated
        };
        this._listeners.forEach(listener => {
            try { listener(payload); } catch (e) { console.error('Auth listener execution error:', e); }
        });
    },

    async enterAsDriver(displayName) {
        this._isAuthenticated = true;
        this._isAdmin = false;
        this._displayName = (displayName || 'Driver').trim() || 'Driver';
        this._saveSession(false, this._displayName);
        this._notifyListeners();
        return { isAdmin: false, displayName: this._displayName };
    },

    async unlockAdmin(passcode) {
        if (!this.hasAdminPasscode()) {
            throw new Error('NO_PASSCODE_SET');
        }
        const valid = await this.verifyAdminPasscode(passcode);
        if (!valid) {
            throw new Error('Incorrect passcode.');
        }
        this._isAuthenticated = true;
        this._isAdmin = true;
        this._displayName = 'Game Master';
        this._saveSession(true, 'Game Master');
        this._notifyListeners();
        return { isAdmin: true };
    },

    async signInMember(email, password) {
        if (!this._auth) throw new Error('Member login is not available. Firebase Auth is not initialized.');
        const cred = await this._auth.signInWithEmailAndPassword(email.trim(), password);
        return cred.user;
    },

    async signUpMember(email, password, displayName) {
        if (!this._auth) throw new Error('Member registration is not available. Firebase Auth is not initialized.');
        const cred = await this._auth.createUserWithEmailAndPassword(email.trim(), password);
        if (displayName && displayName.trim()) {
            await cred.user.updateProfile({ displayName: displayName.trim() });
        }
        return cred.user;
    },

    async sendPasswordReset(email) {
        if (!this._auth) throw new Error('Firebase Auth is not initialized.');
        await this._auth.sendPasswordResetEmail(email.trim());
    },

    async signOut() {
        const wasMember = this._isMember;
        this._isAuthenticated = false;
        this._isAdmin = false;
        this._isMember = false;
        this._memberUid = null;
        this._memberEmail = null;
        this._displayName = '';
        localStorage.removeItem(this._SESSION_KEY);
        if (wasMember && this._auth) {
            try { await this._auth.signOut(); } catch (e) { console.warn('Firebase Auth sign-out error:', e); }
        }
        this._notifyListeners();
    },

    getCurrentUser() {
        if (!this._isAuthenticated) return null;
        const uid = this._isMember ? this._memberUid : 'local';
        return { displayName: this._displayName, uid, email: this._memberEmail || null };
    },

    isAuthenticated() {
        return this._isAuthenticated;
    },

    isAdmin() {
        return this._isAdmin;
    },

    isMember() {
        return this._isMember;
    },

    getMemberEmail() {
        return this._memberEmail;
    }
};

AuthService.init();
window.AuthService = AuthService;
