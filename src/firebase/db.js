// src/firebase/db.js
import { getFirestore, enableIndexedDbPersistence } from "firebase/firestore";
import { app } from "./app";

export const db = getFirestore(app);

// Offline persistence (IndexedDB). Firestore encola writes cuando no hay señal y sincroniza al volver.
enableIndexedDbPersistence(db).catch((err) => {
  // common: failed-precondition (múltiples tabs) | unimplemented (entornos sin IndexedDB)
  console.warn("Firestore persistence not enabled:", err.code, err.message);
});
