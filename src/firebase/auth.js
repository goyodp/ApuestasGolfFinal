// src/firebase/auth.js
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { app } from "./app";

export const auth = getAuth(app);

// Aún lo puedes dejar por si luego usas web login/redirect
export const googleProvider = new GoogleAuthProvider();
