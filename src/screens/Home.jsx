import React, { useEffect, useMemo, useState } from "react";
import { signInWithPopup, onAuthStateChanged, signOut } from "firebase/auth";
import { addDoc, collection, serverTimestamp, doc, setDoc } from "firebase/firestore";
import { auth, googleProvider } from "../firebase/auth";
import { db } from "../firebase/db";
import { useNavigate } from "react-router-dom";

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

export default function Home() {
  const [user, setUser] = useState(null);
  const [creating, setCreating] = useState(false);

  const [joinId, setJoinId] = useState("");
  const [recent, setRecent] = useState(() => loadRecent());

  const navigate = useNavigate();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  const login = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const logout = async () => {
    await signOut(auth);
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

      // settings/main: entryFee + bolaRosaEnabled (globales)
      await setDoc(doc(db, "sessions", newSessionId, "settings", "main"), {
        entryFee: 0,
        bolaRosaEnabled: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // groups/group-1
      await setDoc(doc(db, "sessions", newSessionId, "groups", "group-1"), {
        order: 1,
        name: "Grupo 1",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setRecent(addRecent(newSessionId));
      navigate(`/session/${newSessionId}`);
    } catch (error) {
      console.error(error);
      alert(error?.message || "Error creando sesión");
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

  return (
    <div style={page}>
      <div style={topBar}>
        <div>
          <div style={brandTitle}>Apuestas Golf</div>
          <div style={brandSub}>Sesiones compartidas · Grupos · Matches · Greens</div>
        </div>

        {user ? (
          <button onClick={logout} style={btnGhost}>
            Logout
          </button>
        ) : null}
      </div>

      {!user ? (
        <div style={card}>
          <div style={cardTitle}>Entrar</div>
          <div style={{ opacity: 0.8, marginTop: 6 }}>
            Inicia sesión para crear y administrar sesiones.
          </div>

          <button onClick={login} style={{ ...btnPrimary, marginTop: 14 }}>
            Login con Google
          </button>
        </div>
      ) : (
        <>
          <div style={grid2}>
            {/* Perfil */}
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
                  <div
                    style={{
                      fontWeight: 900,
                      fontSize: 16,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {user.displayName || "Usuario"}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      opacity: 0.7,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {user.email}
                  </div>
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

            {/* Join */}
            <div style={card}>
              <div style={cardTitle}>Entrar a una sesión</div>
              <div style={{ opacity: 0.8, marginTop: 6 }}>
                Pega el Session ID y entra directo.
              </div>

              <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
                <input
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value)}
                  placeholder="Ej: xYz123Abc..."
                  style={input}
                />
                <button onClick={pasteFromClipboard} style={btn}>
                  Pegar
                </button>
              </div>

              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button onClick={joinSession} style={btnPrimary}>
                  🚀 Entrar
                </button>
                <button onClick={() => setJoinId("")} style={btnGhost}>
                  Limpiar
                </button>
              </div>

              {recent.length > 0 ? (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontWeight: 900, marginBottom: 8 }}>Recientes</div>
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
                          <button style={btnDanger} onClick={() => removeRecent(id)}>
                            ✕
                          </button>
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

          <div style={{ ...card, marginTop: 14 }}>
            <div style={cardTitle}>Tip rápido</div>
            <div style={{ opacity: 0.85, lineHeight: 1.4 }}>
              Para compartir: entra a la sesión → “Copiar Session ID” → lo mandas por WhatsApp. En móvil,
              con “Pegar” y “Entrar” queda en 2 taps.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Styles ----------
const page = {
  minHeight: "100vh",
  padding: 16,
  fontFamily: "system-ui",
  background: "#050505",
  color: "white",
  maxWidth: 980,
  margin: "0 auto",
};

const topBar = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 14,
};

const brandTitle = {
  fontSize: 28,
  fontWeight: 950,
  letterSpacing: -0.5,
};

const brandSub = {
  marginTop: 2,
  opacity: 0.7,
  fontSize: 13,
};

const grid2 = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: 12,
};

const card = {
  border: "1px solid #242424",
  borderRadius: 18,
  padding: 14,
  background: "linear-gradient(180deg, #0b0b0b 0%, #070707 100%)",
  boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
};

const cardTitle = {
  fontWeight: 950,
  fontSize: 16,
};

const btn = {
  padding: "10px 14px",
  borderRadius: 14,
  border: "1px solid #2a2a2a",
  background: "#121212",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};

const btnPrimary = {
  ...btn,
  background: "#1f2937",
  border: "1px solid #374151",
};

const btnGhost = {
  ...btn,
  background: "transparent",
  border: "1px solid #2a2a2a",
  opacity: 0.95,
};

const btnDanger = {
  ...btn,
  padding: "10px 12px",
  border: "1px solid #3a1a1a",
  background: "#170808",
  color: "#ffb4b4",
};

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

const recentRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
};

const avatarFallback = {
  width: 44,
  height: 44,
  borderRadius: 999,
  background: "#111",
  border: "1px solid #2a2a2a",
  display: "grid",
  placeItems: "center",
  fontSize: 18,
};
