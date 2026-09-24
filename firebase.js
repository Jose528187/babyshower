import { firebaseConfig, FIREBASE_VERSION } from './firebase-config.js';

const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
// Para probar sin tocar la base real: http://localhost:8765/?emulator (con `firebase emulators:start`).
const EMULATOR = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('emulator');

export const fs = await import(`${base}/firebase-firestore.js`);
const { initializeApp } = await import(`${base}/firebase-app.js`);

export const app = initializeApp(EMULATOR ? { ...firebaseConfig, projectId: 'demo-babyshower' } : firebaseConfig);
export const db = fs.getFirestore(app);
if (EMULATOR) fs.connectFirestoreEmulator(db, '127.0.0.1', 8089);

export async function loadAuth() {
    const auth = await import(`${base}/firebase-auth.js`);
    const instance = auth.getAuth(app);
    if (EMULATOR) auth.connectAuthEmulator(instance, 'http://127.0.0.1:9099', { disableWarnings: true });
    return { ...auth, auth: instance };
}

export const isEmulator = EMULATOR;
