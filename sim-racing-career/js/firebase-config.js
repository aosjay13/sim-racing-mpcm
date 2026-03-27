// Firebase Configuration
// IMPORTANT: Replace these values with your own Firebase project credentials
// Get these from https://console.firebase.google.com

const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Initialize Firebase
let db;
let auth;
let storage;

try {
    const app = firebase.initializeApp(firebaseConfig);
    db = firebase.firestore(app);
    auth = firebase.auth(app);
    storage = firebase.storage(app);

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
    console.warn('Firebase not yet configured. Please update firebase-config.js with your credentials.');
    console.warn('Get your config from: https://console.firebase.google.com');
}

// Firebase Helper Functions
const DatabaseHelper = {
    /**
     * Add a new document to a collection
     */
    async addDocument(collectionName, data) {
        try {
            if (!db) throw new Error('Firebase not initialized');
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
            if (!db) throw new Error('Firebase not initialized');
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
            if (!db) throw new Error('Firebase not initialized');
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
            if (!db) throw new Error('Firebase not initialized');
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
            if (!db) throw new Error('Firebase not initialized');
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
            if (!db) throw new Error('Firebase not initialized');
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
            if (!db) throw new Error('Firebase not initialized');
            let query = db.collection(collectionName);

            // Apply constraints if provided
            for (const [field, operator, value] of constraints) {
                query = query.where(field, operator, value);
            }

            return query.onSnapshot((snapshot) => {
                const documents = [];
                snapshot.forEach(doc => {
                    documents.push({ id: doc.id, ...doc.data() });
                });
                callback(documents);
            }, (error) => {
                console.error(`Error listening to ${collectionName}:`, error);
            });
        } catch (error) {
            console.error(`Error setting up listener:`, error);
        }
    },

    /**
     * Batch write operations
     */
    async batchWrite(operations) {
        try {
            if (!db) throw new Error('Firebase not initialized');
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
