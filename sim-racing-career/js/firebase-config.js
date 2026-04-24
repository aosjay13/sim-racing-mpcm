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

// Initialize Firebase
let db;
let auth;
let storage;
let appCheck;
let firebaseInitError;
let authReadyPromise = Promise.resolve();
let authStateReady = null;

try {
    const runtimeFirebaseConfig = normalizeFirebaseConfig(getFirebaseConfig());

    if (!isValidFirebaseConfig(runtimeFirebaseConfig)) {
        throw new Error('Firebase config is missing or still using placeholders.');
    }

    const app = firebase.initializeApp(runtimeFirebaseConfig);
    db = firebase.firestore(app);

    // Optional App Check: strongly recommended in production.
    if (runtimeFirebaseConfig.appCheckSiteKey && typeof firebase.appCheck === 'function') {
        const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
        if (isLocalHost && runtimeFirebaseConfig.appCheckDebugToken) {
            self.FIREBASE_APPCHECK_DEBUG_TOKEN = runtimeFirebaseConfig.appCheckDebugToken;
        }

        appCheck = firebase.appCheck();
        appCheck.activate(runtimeFirebaseConfig.appCheckSiteKey, true);
        console.log('Firebase App Check enabled');
    } else {
        console.warn('Firebase App Check is not configured. Add appCheckSiteKey to strengthen abuse protection.');
    }

    try {
        auth = firebase.auth(app);

        authStateReady = new Promise((resolve) => {
            const unsubscribe = auth.onAuthStateChanged(() => {
                resolve();
                unsubscribe();
            });
        });

        // Sign in anonymously only when no real user is already present.
        // We wait for the first auth state event so that a user returning from a
        // Google redirect is never overwritten by a fresh anonymous session.
        if (runtimeFirebaseConfig.enableAnonymousAuth !== false) {
            authReadyPromise = new Promise((resolveAuthReady) => {
                const unsub = auth.onAuthStateChanged(async (firstUser) => {
                    unsub(); // fire once only

                    if (firstUser && !firstUser.isAnonymous) {
                        // Real user already present (e.g. returning from Google redirect).
                        // Do NOT overwrite with an anonymous session.
                        console.log('Real user detected on load, skipping anonymous sign-in.');
                        resolveAuthReady();
                        return;
                    }

                    if (!firstUser) {
                        // No session at all — create an anonymous one for Firestore access.
                        try {
                            await auth.signInAnonymously();
                            console.log('Signed in anonymously for Firestore access');
                        } catch (error) {
                            if (
                                error.code === 'auth/configuration-not-found' ||
                                error.code === 'auth/operation-not-allowed'
                            ) {
                                console.warn(
                                    'Anonymous Authentication is not enabled in your Firebase project. ' +
                                    'Go to Firebase Console > Authentication > Sign-in providers and enable Anonymous. ' +
                                    'Continuing without auth — open Firestore rules are required until this is done.'
                                );
                            } else {
                                console.error('Anonymous sign-in failed:', error);
                            }
                        }
                    }

                    resolveAuthReady();
                });
            });
        }
    } catch (error) {
        console.warn('Firebase Auth init failed, continuing without auth:', error);
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
        if (err.code == 'failed-precondition') {
            console.warn('Multiple tabs open, persistence can only be enabled in one tab at a time.');
        } else if (err.code == 'unimplemented') {
            console.warn('The current browser does not support all of the features required to enable persistence');
        }
    });

    console.log('Firebase initialized successfully');
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
        hasAuth: Boolean(auth),
        hasStorage: Boolean(storage),
        hasAppCheck: Boolean(appCheck),
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
            await authReadyPromise;
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
            await authReadyPromise;
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
            await authReadyPromise;
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
            await authReadyPromise;
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
            await authReadyPromise;
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
            await authReadyPromise;
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
            let unsubscribe = () => {};

            authReadyPromise
                .then(() => {
                    let query = db.collection(collectionName);

                    // Apply constraints if provided
                    for (const [field, operator, value] of constraints) {
                        query = query.where(field, operator, value);
                    }

                    unsubscribe = query.onSnapshot((snapshot) => {
                        const documents = [];
                        snapshot.forEach(doc => {
                            documents.push({ id: doc.id, ...doc.data() });
                        });
                        callback(documents);
                    }, (error) => {
                        console.error(`Error listening to ${collectionName}:`, error);
                    });
                })
                .catch((error) => {
                    console.error(`Auth not ready for ${collectionName} listener:`, error);
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
            await authReadyPromise;
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

const AuthService = {
    _listeners: [],
    _isAdmin: false,
    _user: null,
    _readyPromise: Promise.resolve(),

    isEmbeddedContext() {
        try {
            return window.self !== window.top;
        } catch (error) {
            // Accessing window.top can throw in cross-origin embeds.
            return true;
        }
    },

    init() {
        if (!auth) {
            this._readyPromise = Promise.resolve();
            return this._readyPromise;
        }

        auth.getRedirectResult().catch((error) => {
            // auth/no-auth-event fires on every normal page load with no pending redirect — safe to ignore.
            if (error.code !== 'auth/no-auth-event') {
                console.error('Google redirect sign-in failed:', error);
            }
        });

        this._readyPromise = new Promise((resolve) => {
            auth.onAuthStateChanged(async (user) => {
                this._user = user || null;
                this._isAdmin = await this.resolveAdminStatus(user);
                this._notifyListeners();
                resolve();
            });
        });

        return this._readyPromise;
    },

    async waitUntilReady() {
        await (authStateReady || Promise.resolve());
        await this._readyPromise;
    },

    async resolveAdminStatus(user) {
        if (!user || !db || user.isAnonymous) return false;
        try {
            const adminDoc = await db.collection('admins').doc(user.uid).get();
            return adminDoc.exists && adminDoc.data()?.isActive !== false;
        } catch (error) {
            console.error('Error resolving admin status:', error);
            return false;
        }
    },

    onAuthStateChanged(listener) {
        this._listeners.push(listener);
        try {
            Promise.resolve(listener({
                user: this._user,
                isAdmin: this._isAdmin,
                isAuthenticated: this.isAuthenticated()
            })).catch((error) => {
                console.error('Auth listener error:', error);
            });
        } catch (error) {
            console.error('Auth listener error:', error);
        }

        return () => {
            this._listeners = this._listeners.filter((cb) => cb !== listener);
        };
    },

    _notifyListeners() {
        const payload = {
            user: this._user,
            isAdmin: this._isAdmin,
            isAuthenticated: this.isAuthenticated()
        };

        this._listeners.forEach((listener) => {
            try {
                Promise.resolve(listener(payload)).catch((error) => {
                    console.error('Auth listener execution error:', error);
                });
            } catch (error) {
                console.error('Auth listener execution error:', error);
            }
        });
    },

    async signInWithGoogle() {
        if (!auth) {
            throw new Error('Authentication is not configured.');
        }

        const provider = new firebase.auth.GoogleAuthProvider();
        provider.addScope('email');
        provider.addScope('profile');
        provider.setCustomParameters({ prompt: 'select_account' });
        const currentUser = auth.currentUser;

        const startRedirectFlow = async (preferLinkForAnonymous = false) => {
            if (preferLinkForAnonymous && currentUser?.isAnonymous) {
                try {
                    await currentUser.linkWithRedirect(provider);
                    return { redirectStarted: true };
                } catch (linkRedirectError) {
                    if (
                        linkRedirectError.code === 'auth/provider-already-linked' ||
                        linkRedirectError.code === 'auth/credential-already-in-use' ||
                        linkRedirectError.code === 'auth/email-already-in-use'
                    ) {
                        await auth.signOut();
                        await auth.signInWithRedirect(provider);
                        return { redirectStarted: true };
                    }

                    throw linkRedirectError;
                }
            }

            await auth.signInWithRedirect(provider);
            return { redirectStarted: true };
        };

        const signInWithPopupFlow = async () => {
            await auth.signInWithPopup(provider);
            await this.waitUntilReady();
            return { redirectStarted: false, user: this._user };
        };

        try {
            // Embedded surfaces (for example Google Sites iframes) are less reliable with popup auth.
            // Redirect is more consistent in these contexts.
            if (this.isEmbeddedContext()) {
                return await startRedirectFlow(true);
            }

            if (currentUser?.isAnonymous) {
                try {
                    await currentUser.linkWithPopup(provider);
                    await this.waitUntilReady();
                    return { redirectStarted: false, user: this._user };
                } catch (linkError) {
                    if (
                        linkError.code === 'auth/provider-already-linked' ||
                        linkError.code === 'auth/credential-already-in-use' ||
                        linkError.code === 'auth/email-already-in-use'
                    ) {
                        await auth.signOut();
                        return await signInWithPopupFlow();
                    }

                    if (
                        linkError.code === 'auth/popup-blocked' ||
                        linkError.code === 'auth/cancelled-popup-request' ||
                        linkError.code === 'auth/popup-closed-by-user'
                    ) {
                        return await startRedirectFlow(true);
                    }

                    throw linkError;
                }
            }

            return await signInWithPopupFlow();
        } catch (error) {
            if (
                error.code === 'auth/popup-blocked' ||
                error.code === 'auth/cancelled-popup-request' ||
                error.code === 'auth/popup-closed-by-user'
            ) {
                return await startRedirectFlow(true);
            }

            if (error.code === 'auth/unauthorized-domain') {
                const hostname = window.location.hostname || 'this domain';
                throw new Error(
                    'Google sign-in is blocked for ' + hostname + '. Add this exact host in Firebase Authentication > Settings > Authorized domains (including preview hostnames).'
                );
            }

            if (error.code === 'auth/operation-not-allowed') {
                throw new Error('Google sign-in is disabled in Firebase Authentication. Enable the Google provider and try again.');
            }

            if (error.code === 'auth/operation-not-supported-in-this-environment') {
                throw new Error('Google popup sign-in is not supported in this preview environment. Open the app in a regular browser tab and try again.');
            }

            if (error.code === 'auth/network-request-failed') {
                throw new Error('Network request failed during Google sign-in. Check connectivity and try again.');
            }

            throw error;
        }
    },

    normalizeAuthError(error) {
        if (!error?.code) {
            return error?.message || 'Authentication failed.';
        }

        if (error.code === 'auth/invalid-email') {
            return 'Enter a valid email address.';
        }

        if (error.code === 'auth/missing-password' || error.code === 'auth/internal-error') {
            return 'Enter your email and password.';
        }

        if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
            return 'Email or password is incorrect.';
        }

        if (error.code === 'auth/email-already-in-use') {
            return 'That email is already in use. Sign in instead, or use password reset in Firebase Console.';
        }

        if (error.code === 'auth/weak-password') {
            return 'Password must be at least 6 characters.';
        }

        if (error.code === 'auth/operation-not-allowed') {
            return 'Email/password sign-in is disabled in Firebase Authentication. Enable the Email/Password provider and try again.';
        }

        if (error.code === 'auth/too-many-requests') {
            return 'Too many failed attempts. Wait a bit and try again.';
        }

        if (error.code === 'auth/invalid-email') {
            return 'Invalid username or password.';
        }

        return error.message || 'Authentication failed.';
    },

    normalizeUsername(username) {
        const normalized = String(username || '').trim().toLowerCase();
        if (!normalized) {
            throw new Error('Username is required.');
        }

        if (!/^[a-z0-9._-]{3,24}$/.test(normalized)) {
            throw new Error('Username must be 3-24 chars using letters, numbers, dot, underscore, or dash.');
        }

        return normalized;
    },

    usernameToInternalEmail(username) {
        const normalized = this.normalizeUsername(username);
        return `${normalized}@srmpc.local`;
    },

    async signInWithUsernamePassword(username, password) {
        const internalEmail = this.usernameToInternalEmail(username);
        return await this.signInWithEmailPassword(internalEmail, password);
    },

    async registerWithUsernamePassword({ username, password, displayName = '', requestedRole = 'driver' } = {}) {
        if (!auth) {
            throw new Error('Authentication is not configured.');
        }

        const normalizedUsername = this.normalizeUsername(username);
        const normalizedPassword = String(password || '');
        if (normalizedPassword.length < 6) {
            throw new Error('Password must be at least 6 characters.');
        }

        const role = requestedRole === 'admin' ? 'admin' : 'driver';
        const internalEmail = this.usernameToInternalEmail(normalizedUsername);

        try {
            await auth.createUserWithEmailAndPassword(internalEmail, normalizedPassword);
            await this.waitUntilReady();

            const uid = this._user?.uid;
            if (uid && window.Database?.users) {
                await window.Database.users.upsertProfile(uid, {
                    displayName: displayName || normalizedUsername,
                    email: '',
                    username: normalizedUsername,
                    requestedRole: role,
                    roleStatus: role === 'admin' ? 'pending' : 'approved'
                });
            }

            if (uid && window.Database?.accounts) {
                await window.Database.accounts.createRequest({
                    uid,
                    username: normalizedUsername,
                    displayName: displayName || normalizedUsername,
                    requestedRole: role
                });
            }

            return { user: this._user };
        } catch (error) {
            throw new Error(this.normalizeAuthError(error));
        }
    },

    async signInWithEmailPassword(email, password) {
        if (!auth) {
            throw new Error('Authentication is not configured.');
        }

        const normalizedEmail = String(email || '').trim();
        const normalizedPassword = String(password || '');

        try {
            await auth.signInWithEmailAndPassword(normalizedEmail, normalizedPassword);
            await this.waitUntilReady();
            return { user: this._user };
        } catch (error) {
            throw new Error(this.normalizeAuthError(error));
        }
    },

    async registerWithEmailPassword(email, password) {
        if (!auth) {
            throw new Error('Authentication is not configured.');
        }

        const normalizedEmail = String(email || '').trim();
        const normalizedPassword = String(password || '');

        try {
            await auth.createUserWithEmailAndPassword(normalizedEmail, normalizedPassword);

            await this.waitUntilReady();
            return { user: this._user };
        } catch (error) {
            throw new Error(this.normalizeAuthError(error));
        }
    },

    async signOut() {
        if (!auth) return;
        await auth.signOut();
    },

    getCurrentUser() {
        return this._user;
    },

    isAuthenticated() {
        return Boolean(this._user && !this._user.isAnonymous);
    },

    isAdmin() {
        return this._isAdmin;
    }
};

AuthService.init();
window.AuthService = AuthService;
