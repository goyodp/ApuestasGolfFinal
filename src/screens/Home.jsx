import React, { useEffect, useState } from "react";
import { signInWithPopup, onAuthStateChanged, signOut } from "firebase/auth";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, googleProvider } from "../firebase/auth";
import { db } from "../firebase/db";

export default function Home() {
  const [user, setUser] = useState(null);
  const [creating, setCreating] = useState(false);
  const [sessionId, setSessionId] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  const login = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const logout = async () => {
    await signOut(auth);
    setSessionId("");
  };

  const createSession = async () => {
    if (!user) return;
    setCreating(true);
    try {
      const ref = await addDoc(collection(db, "sessions"), {
        name: `Session ${new Date().toLocaleString()}`,
        status: "live",
        courseId: "campestre-slp",
        hcpPercent: 100,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setSessionId(ref.id);
    } catch (e) {
      console.error(e);
      alert(e?.message || "Error creando sesión");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ padding: 20, fontFamily: "system-ui", maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800 }}>Apuestas Golf</h1>

      {!user ? (
        <button onClick={login} style={{ marginTop: 12, padding: "10px 14px" }}>
          Login con Google
        </button>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {user.photoURL && (
              <img src={user.photoURL} alt="avatar" width={36} height={36} style={{ borderRadius: 999 }} />
            )}
            <div>
              <div style={{ fontWeight: 700 }}>{user.displayName}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>{user.email}</div>
            </div>
            <button onClick={logout} style={{ marginLeft: "auto", padding: "8px 12px" }}>
              Logout
            </button>
          </div>

          <hr style={{ margin: "16px 0" }} />

          <button onClick={createSession} disabled={creating} style={{ padding: "10px 14px" }}>
            {creating ? "Creando..." : "Crear sesión"}
          </button>

          {sessionId && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 700 }}>Session ID:</div>
              <code style={{ display: "inline-block", marginTop: 4 }}>{sessionId}</code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
