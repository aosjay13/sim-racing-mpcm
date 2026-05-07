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

    _saveSession(isAdmin, displayName) {
        const session = {
            isAdmin: Boolean(isAdmin),
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
            // If there's a stored admin session from a previous passcode, clear it
            // so the user is required to re-authenticate with the current passcode.
            const session = this._loadSession();
            if (session && session.isAdmin) {
                // Validate the stored admin session against the current passcode key.
                // We use a version stamp to invalidate sessions from old passcodes.
                const storedVersion = localStorage.getItem('srmpc_passcode_version');
                const currentVersion = 'v3';
                if (storedVersion !== currentVersion) {
                    localStorage.removeItem(this._SESSION_KEY);
                    localStorage.removeItem(this._PASSCODE_HASH_KEY);
                    localStorage.setItem('srmpc_passcode_version', currentVersion);
                } else {
                    this._isAuthenticated = true;
                    this._isAdmin = session.isAdmin;
                    this._displayName = session.displayName || '';
                }
            } else if (session) {
                this._isAuthenticated = true;
                this._isAdmin = false;
                this._displayName = session.displayName || '';
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
        // Notify immediately with current state
        Promise.resolve().then(() => {
            try {
                listener({
                    user: this._isAuthenticated ? { displayName: this._displayName, uid: 'local' } : null,
                    isAdmin: this._isAdmin,
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
        const payload = {
            user: this._isAuthenticated ? { displayName: this._displayName, uid: 'local' } : null,
            isAdmin: this._isAdmin,
            isAuthenticated: this._isAuthenticated
        };
        this._listeners.forEach(listener => {
            try {
                listener(payload);
            } catch (e) {
                console.error('Auth listener execution error:', e);
            }
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
            // Signal that a passcode needs to be set up first
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

    async signOut() {
        this._isAuthenticated = false;
        this._isAdmin = false;
        this._displayName = '';
        localStorage.removeItem(this._SESSION_KEY);
        this._notifyListeners();
    },

    getCurrentUser() {
        if (!this._isAuthenticated) return null;
        return { displayName: this._displayName, uid: 'local' };
    },

    isAuthenticated() {
        return this._isAuthenticated;
    },

    isAdmin() {
        return this._isAdmin;
    }
};

AuthService.init();
window.AuthService = AuthService;
