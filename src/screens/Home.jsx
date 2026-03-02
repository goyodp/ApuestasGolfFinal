// src/screens/Home.jsx
import React, { useEffect, useState } from "react";
import { onAuthStateChanged, signOut, GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { addDoc, collection, serverTimestamp, doc, setDoc } from "firebase/firestore";
import { auth } from "../firebase/auth";
import { db } from "../firebase/db";
import { useNavigate } from "react-router-dom";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";

const LS_KEY = "apuestasGolf_recentSessions";

function loadRecent() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function saveRecent(list) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, 8)));
  } catch {}
}
function addRecent(sessionId) {
  const current = loadRecent();
  const next = [sessionId, ...current.filter((x) => x !== sessionId)].slice(0, 8);
  saveRecent(next);
  return next;
}
function normalizeErr(e) {
  if (!e) return "Error desconocido";
  if (typeof e === "string") return e;
  return e?.message || e?.error || e?.localizedDescription || JSON.stringify(e);
}

export default function Home() {
  const [user, setUser] = useState(null);
  const [creating, setCreating] = useState(false);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [loadingApple, setLoadingApple] = useState(false);

  const [joinId, setJoinId] = useState("");
  const [recent, setRecent] = useState(() => loadRecent());

  const navigate = useNavigate();
  const isBusy = loadingGoogle || loadingApple;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  const loginGoogle = async () => {
    if (isBusy) return;
    setLoadingGoogle(true);

    try {
      // 1) Login nativo
      const res = await FirebaseAuthentication.signInWithGoogle();

      // 2) Tokens
      const idToken =
        res?.credential?.idToken ||
        res?.credential?.id_token ||
        res?.credential?.token ||
        res?.credential?.oauthIdToken ||
        null;

      const accessToken =
        res?.credential?.accessToken ||
        res?.credential?.access_token ||
        null;

      if (!idToken && !accessToken) {
        throw new Error("Google regresó respuesta pero no trajo idToken/accessToken.");
      }

      // 3) Firebase Web sign-in (esto dispara onAuthStateChanged)
      const credential = GoogleAuthProvider.credential(idToken || null, accessToken || null);
      await signInWithCredential(auth, credential);
    } catch (e) {
      alert(normalizeErr(e));
    } finally {
      setLoadingGoogle(false);
    }
  };

  const loginApple = async () => {
    if (isBusy) return;
    setLoadingApple(true);
    try {
      await FirebaseAuthentication.signInWithApple();
      // Para Apple real necesitas capability + Apple Developer
    } catch (e) {
      alert(normalizeErr(e));
    } finally {
      setLoadingApple(false);
    }
  };

  const logout = async () => {
    try { await FirebaseAuthentication.signOut(); } catch {}
    try { await signOut(auth); } catch {}
    setJoinId("");
  };

  const createSession = async () => {
    if (!user) return;
    setCreating(true);
    try {
      const sessionRef = await addDoc(collection(db, "sessions"), {
        name: `Session ${new Date().toLocaleString()}`,
        status: "live",
        courseId: "campestre-slp",
        hcpPercent: 100,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const newSessionId = sessionRef.id;

      await setDoc(doc(db, "sessions", newSessionId, "settings", "main"), {
        entryFee: 0,
        bolaRosaEnabled: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await setDoc(doc(db, "sessions", newSessionId, "groups", "group-1"), {
        order: 1,
        name: "Grupo 1",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setRecent(addRecent(newSessionId));
      navigate(`/session/${newSessionId}`);
    } catch (e) {
      alert(normalizeErr(e));
    } finally {
      setCreating(false);
    }
  };

  const joinSession = () => {
    const id = (joinId || "").trim();
    if (!id) return alert("Pega el Session ID.");
    setRecent(addRecent(id));
    navigate(`/session/${id}`);
  };

  const pasteFromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setJoinId(t.trim());
    } catch {
      alert("No pude leer el clipboard. Pega manual.");
    }
  };

  const removeRecent = (id) => {
    const next = recent.filter((x) => x !== id);
    setRecent(next);
    saveRecent(next);
  };

  const showLoginCentered = !user;

  return (
    <div style={page}>
      <header style={topBar}>
        <div style={{ minWidth: 0 }}>
          <div style={brandTitle}>Apuestas</div>
          <div style={brandSub}>Sesiones compartidas · Grupos · Matches · Greens</div>
        </div>
        {user ? (
          <button onClick={logout} style={btnGhost}>Logout</button>
        ) : null}
      </header>

      <main style={showLoginCentered ? mainCentered : mainNormal}>
        {!user ? (
          <div style={{ ...card, width: "min(520px, 100%)" }}>
            <div style={cardTitle}>Entrar</div>
            <div style={{ opacity: 0.8, marginTop: 6 }}>
              Inicia sesión para crear y administrar sesiones.
            </div>

            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              <button onClick={loginGoogle} disabled={isBusy} style={btnProvider}>
                <GoogleIcon />
                <span>{loadingGoogle ? "Entrando..." : "Continuar con Google"}</span>
              </button>

              <button onClick={loginApple} disabled={isBusy} style={btnProviderApple}>
                <AppleIcon />
                <span>{loadingApple ? "Entrando..." : "Continuar con Apple"}</span>
              </button>

              <div style={{ opacity: 0.55, fontSize: 12, lineHeight: 1.35 }}>
                Tip: Apple Sign-In en app real requiere Apple Developer + capability “Sign In with Apple”.
              </div>
            </div>
          </div>
        ) : (
          <div style={grid2}>
            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt="avatar"
                    width={44}
                    height={44}
                    style={{ borderRadius: 999, border: "1px solid #2a2a2a" }}
                  />
                ) : (
                  <div style={avatarFallback}>👤</div>
                )}

                <div style={{ minWidth: 0 }}>
                  <div style={nameRow}>{user.displayName || "Usuario"}</div>
                  <div style={emailRow}>{user.email}</div>
                </div>
              </div>

              <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                <button onClick={createSession} disabled={creating} style={btnPrimary}>
                  {creating ? "Creando..." : "➕ Crear sesión"}
                </button>
                <div style={{ opacity: 0.7, fontSize: 12 }}>
                  Crea una sesión nueva (Campo + %Hcp global + Entry global).
                </div>
              </div>
            </div>

            <div style={card}>
              <div style={cardTitle}>Entrar a una sesión</div>
              <div style={{ opacity: 0.8, marginTop: 6 }}>Pega el Session ID y entra directo.</div>

              <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
                <input
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value)}
                  placeholder="Ej: xYz123Abc..."
                  style={input}
                />
                <button onClick={pasteFromClipboard} style={btn}>Pegar</button>
              </div>

              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button onClick={joinSession} style={btnPrimary}>🚀 Entrar</button>
                <button onClick={() => setJoinId("")} style={btnGhost}>Limpiar</button>
              </div>

              {recent.length > 0 ? (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontWeight: 950, marginBottom: 8 }}>Recientes</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {recent.map((id) => (
                      <div key={id} style={recentRow}>
                        <code style={codePill}>{id}</code>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            style={btn}
                            onClick={() => {
                              setJoinId(id);
                              navigate(`/session/${id}`);
                            }}
                          >
                            Abrir
                          </button>
                          <button style={btnDanger} onClick={() => removeRecent(id)}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 14, opacity: 0.6, fontSize: 12 }}>
                  Aquí aparecerán tus sesiones recientes.
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 33 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 2.9l5.7-5.7C34.6 6 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.2-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3 0 5.7 1.1 7.8 2.9l5.7-5.7C34.6 6 29.6 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.5-5.2l-6.2-5.2C29.2 35.6 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.4 39.7 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1 2.6-2.9 4.7-5.4 6.1l.1.1 6.2 5.2C35.8 40 44 34 44 24c0-1.3-.1-2.2-.4-3.5z"/>
    </svg>
  );
}
function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M16.365 1.43c0 1.14-.42 2.2-1.25 3.13-.85.95-2.25 1.7-3.45 1.6-.15-1.12.46-2.3 1.22-3.16.84-.96 2.3-1.67 3.48-1.57zM20.8 17.15c-.55 1.27-.82 1.83-1.53 2.95-.99 1.53-2.39 3.44-4.11 3.46-1.53.02-1.93-1-4.01-1-2.08 0-2.53.98-4.06 1.02-1.72.04-3.03-1.74-4.02-3.27-2.78-4.29-3.07-9.31-1.36-11.94 1.2-1.84 3.09-2.92 4.87-2.92 1.82 0 2.96 1 4.47 1 1.47 0 2.36-1 4.48-1 1.58 0 3.25.86 4.44 2.35-3.91 2.14-3.28 7.74.83 9.35z"/>
    </svg>
  );
}

// Styles
const page = {
  minHeight: "100%",
  paddingTop: "calc(14px + env(safe-area-inset-top))",
  paddingBottom: "calc(14px + env(safe-area-inset-bottom))",
  paddingLeft: "calc(14px + env(safe-area-inset-left))",
  paddingRight: "calc(14px + env(safe-area-inset-right))",
  background: "#050505",
  color: "white",
};
const topBar = {
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 16,
};
const brandTitle = { fontSize: 26, fontWeight: 950, letterSpacing: -0.4, lineHeight: 1 };
const brandSub = { marginTop: 6, opacity: 0.7, fontSize: 13 };
const mainCentered = { minHeight: "calc(100vh - 160px)", display: "grid", placeItems: "center" };
const mainNormal = { display: "block" };
const grid2 = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 };

const card = {
  border: "1px solid #242424",
  borderRadius: 18,
  padding: 14,
  background: "linear-gradient(180deg, #0b0b0b 0%, #070707 100%)",
  boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
};
const cardTitle = { fontWeight: 950, fontSize: 16 };

const btn = {
  padding: "10px 14px",
  borderRadius: 14,
  border: "1px solid #2a2a2a",
  background: "#121212",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};
const btnPrimary = { ...btn, background: "#1f2937", border: "1px solid #374151" };
const btnGhost = { ...btn, background: "transparent", border: "1px solid #2a2a2a", opacity: 0.95 };
const btnDanger = { ...btn, padding: "10px 12px", border: "1px solid #3a1a1a", background: "#170808", color: "#ffb4b4" };

const btnProvider = {
  ...btn,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  padding: "12px 14px",
  borderRadius: 16,
  background: "#101010",
  border: "1px solid #2a2a2a",
};
const btnProviderApple = { ...btnProvider, background: "linear-gradient(180deg, #121212 0%, #0b0b0b 100%)" };

const input = {
  flex: 1,
  minWidth: 0,
  padding: "12px 12px",
  borderRadius: 14,
  border: "1px solid #2a2a2a",
  background: "#0f0f0f",
  color: "white",
  fontWeight: 800,
};

const codePill = {
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid #2a2a2a",
  background: "#0f0f0f",
  fontWeight: 900,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: "100%",
};
const recentRow = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 };
const avatarFallback = {
  width: 44, height: 44, borderRadius: 999, background: "#111",
  border: "1px solid #2a2a2a", display: "grid", placeItems: "center", fontSize: 18,
};
const nameRow = { fontWeight: 950, fontSize: 16, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const emailRow = { fontSize: 12, opacity: 0.7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
