// route_manager.js
const DB_NAME = 'RallyOfflineDB';
const DB_VERSION = 1;
const STORE_NAME = 'routes';

let db;

export function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = (event) => reject(event.target.errorCode);
        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
    });
}

export function saveRouteOffline(routeId, routeName, coordinatesArray) {
    return new Promise((resolve, reject) => {
        if (!db) return reject('Database not initialized');
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put({
            id: routeId,
            name: routeName,
            pointCount: coordinatesArray.length,
            points: coordinatesArray,
            savedAt: new Date().toISOString()
        });
        request.onsuccess = () => resolve(routeId);
        request.onerror = (e) => reject(e.target.error);
    });
}
