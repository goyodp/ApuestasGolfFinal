// src/firebase/auth.js
import { Capacitor } from "@capacitor/core";
import {
  getAuth,
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  inMemoryPersistence,
} from "firebase/auth";
import { app } from "./app";

// En iOS/Android (WebView) es MUCHO más estable usar initializeAuth + persistence.
// En web normal, getAuth() es suficiente.
function makeAuth() {
  const isNative = Capacitor.isNativePlatform();

  if (!isNative) {
    return getAuth(app);
  }

  try {
    // iOS WebView normalmente soporta indexedDB, y es el más estable.
    return initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence],
    });
  } catch (e) {
    // Si por alguna razón ya fue inicializado, cae a getAuth.
    return getAuth(app);
  }
}

export const auth = makeAuth();
