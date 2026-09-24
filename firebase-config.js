// Configuración de Firebase (Consola de Firebase → Configuración del proyecto → Tus apps → Web).
// Estos valores son públicos por diseño; la seguridad la dan las reglas de firestore.rules.
// Mientras apiKey empiece con "TU_", la página funciona en MODO DEMO (solo guarda en este navegador).
export const firebaseConfig = {
  apiKey: "AIzaSyCg1o4G2B5UAk8zAdQags_Vg5_YADSgEe8",
  authDomain: "babyshower-48c02.firebaseapp.com",
  projectId: "babyshower-48c02",
  storageBucket: "babyshower-48c02.firebasestorage.app",
  messagingSenderId: "601986120124",
  appId: "1:601986120124:web:17b3f5d780bb9c426c13b9",
  measurementId: "G-2PRX9QT71C"
};

// Emails con acceso al panel admin.html (deben coincidir con los de firestore.rules).
export const ADMIN_EMAILS = ["jamp528@gmail.com"];

export const FIREBASE_VERSION = "10.12.2";

