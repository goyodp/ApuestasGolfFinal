// src/screens/Home.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  onAuthStateChanged,
  signOut,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithCredential,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from "firebase/auth";
import {
  addDoc,
  collection,
  serverTimestamp,
  doc,
  setDoc,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { auth } from "../firebase/auth";
import { db } from "../firebase/db";
import { useNavigate } from "react-router-dom";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import { Capacitor } from "@capacitor/core";

const LS_KEY = "apuestasGolf_recentSessions";

/* ---------------- LocalStorage helpers ---------------- */

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

/* ---------------- Error helpers ---------------- */

function normalizeErr(e) {
  if (!e) return "Error desconocido";
  if (typeof e === "string") return e;

  const code = e?.code ? String(e.code) : "";
  const msg =
    e?.message ||
    e?.error ||
    e?.localizedDescription ||
    e?.details ||
    (typeof e === "object" ? JSON.stringify(e) : String(e));

  return code ? `${code}: ${msg}` : msg;
}

function firebaseNiceMessage(err) {
  const code = String(err?.code || "").toLowerCase();

  if (code.includes("auth/user-not-found")) return "Ese usuario no existe.";
  if (code.includes("auth/wrong-password")) return "Contraseña incorrecta.";
  if (code.includes("auth/invalid-credential")) return "Credenciales inválidas. Revisa email y contraseña.";
  if (code.includes("auth/invalid-email")) return "Email inválido.";
  if (code.includes("auth/email-already-in-use")) return "Ese email ya tiene cuenta. Usa 'Entrar'.";
  if (code.includes("auth/weak-password")) return "Password muy débil (mínimo 6 caracteres).";
  if (code.includes("auth/network-request-failed")) return "Sin conexión. Revisa tu internet.";
  if (code.includes("auth/too-many-requests")) return "Demasiados intentos. Espera un poco e intenta de nuevo.";

  return normalizeErr(err);
}

function withTimeout(promise, ms, label = "Operación") {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label}: timeout (${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

/* ---------------- Input restrictions ---------------- */

function sanitizeSessionId(raw) {
  const s = String(raw ?? "");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const isAz = (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
    const is09 = ch >= "0" && ch <= "9";
    const ok = isAz || is09 || ch === "-" || ch === "_";
    if (ok) out += ch;
  }
  return out.slice(0, 60);
}

function isLikelyValidSessionId(id) {
  const s = (id || "").trim();
  if (!s) return false;
  if (s.length < 6) return false;
  if (s.length > 60) return false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const isAz = (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
    const is09 = ch >= "0" && ch <= "9";
    const ok = isAz || is09 || ch === "-" || ch === "_";
    if (!ok) return false;
  }
  return true;
}

/* ---------------- Screen ---------------- */

export default function Home() {
  const [user, setUser] = useState(null);

  const [creating, setCreating] = useState(false);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [loadingApple, setLoadingApple] = useState(false);
  const [loadingEmail, setLoadingEmail] = useState(false);

  const [joinId, setJoinId] = useState("");
  const [recent, setRecent] = useState(() => loadRecent());

  const [newSessionName, setNewSessionName] = useState("");

  const [mySessions, setMySessions] = useState([]);
  const [loadingMySessions, setLoadingMySessions] = useState(false);

  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [emailMode, setEmailMode] = useState("login"); // "login" | "signup"

  const navigate = useNavigate();

  const platform = Capacitor.getPlatform(); // "ios" | "android" | "web"
  const showApple = platform === "ios";
  const isBusy = loadingGoogle || loadingApple || loadingEmail || creating;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      setMySessions([]);
      return;
    }

    setLoadingMySessions(true);

    const qy = query(
      collection(db, "sessions"),
      where("memberUids", "array-contains", user.uid),
      orderBy("updatedAt", "desc")
    );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setMySessions(rows);
        setLoadingMySessions(false);
      },
      (err) => {
        console.error("mySessions onSnapshot error:", err);
        setMySessions([]);
        setLoadingMySessions(false);
      }
    );

    return () => unsub();
  }, [user?.uid]);

  const joinHint = useMemo(() => {
    const t = (joinId || "").trim();
    if (!t) return { type: "muted", msg: "Pega tu Session ID (ej: xYz123Abc…)" };
    if (t.length < 6) return { type: "warn", msg: "Se ve muy corto. ¿Seguro es el ID completo?" };
    if (!isLikelyValidSessionId(t)) return { type: "warn", msg: "Formato raro. Solo letras, números, - y _." };
    return { type: "ok", msg: "Listo para entrar." };
  }, [joinId]);

  /* ---------------- Auth: Google ---------------- */

  const loginGoogle = async () => {
    if (isBusy) return;
    setLoadingGoogle(true);
    try {
      // limpia estados atorados nativos
      try {
        await FirebaseAuthentication.signOut();
      } catch {}

      const res = await withTimeout(
        FirebaseAuthentication.signInWithGoogle(),
        20000,
        "Google Sign-In"
      );

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

      const credential = GoogleAuthProvider.credential(idToken || null, accessToken || null);
      await signInWithCredential(auth, credential);
    } catch (e) {
      console.error("loginGoogle error:", e);
      alert(firebaseNiceMessage(e));
    } finally {
      setLoadingGoogle(false);
    }
  };

  /* ---------------- Auth: Apple ---------------- */

  const loginApple = async () => {
    if (platform !== "ios") return;
    if (isBusy) return;

    setLoadingApple(true);
    try {
      // limpia estados atorados nativos
      try {
        await FirebaseAuthentication.signOut();
      } catch {}

      const res = await withTimeout(
        FirebaseAuthentication.signInWithApple({ scopes: ["email", "name"] }),
        20000,
        "Apple Sign-In"
      );

      const idToken =
        res?.credential?.idToken ||
        res?.credential?.identityToken ||
        res?.credential?.id_token ||
        null;

      const rawNonce =
        res?.credential?.nonce ||
        res?.credential?.rawNonce ||
        null;

      if (!idToken) {
        throw new Error("Apple no regresó idToken. No puedo sincronizar con Firebase Web.");
      }

      const provider = new OAuthProvider("apple.com");
      const cred = provider.credential({
        idToken,
        rawNonce: rawNonce || undefined,
      });

      await signInWithCredential(auth, cred);
    } catch (e) {
      console.error("loginApple error:", e);
      const msg = firebaseNiceMessage(e);
      alert(
        [
          "No se pudo iniciar sesión con Apple.",
          "",
          msg,
          "",
          "Si se queda atorado con nonce/duplicate:",
          "1) Borra la app del iPhone.",
          "2) Settings > Apple ID > Sign-In & Security > Apps Using Apple ID > (tu app) > Stop Using Apple ID.",
          "3) Reinstala e intenta de nuevo.",
        ].join("\n")
      );
    } finally {
      setLoadingApple(false);
    }
  };

  /* ---------------- Auth: Email/Password ---------------- */

  const isEmailValid = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
  const canSubmitEmail = isEmailValid(email) && String(pass || "").length >= 6;

  const loginEmail = async () => {
    if (isBusy) return;

    const em = String(email || "").trim();
    const pw = String(pass || "");

    if (!isEmailValid(em)) return alert("Pon un email válido.");
    if (emailMode === "signup" && pw.length < 6) return alert("Password mínimo 6 caracteres.");

    setLoadingEmail(true);
    try {
      if (emailMode === "login") {
        await signInWithEmailAndPassword(auth, em, pw);
      } else {
        await createUserWithEmailAndPassword(auth, em, pw);
      }
    } catch (e) {
      const code = String(e?.code || "").toLowerCase();

      if (emailMode === "login" && code.includes("auth/user-not-found")) {
        const ok = window.confirm("Ese email no tiene cuenta.\n\n¿Quieres crear una cuenta con ese email y password?");
        if (ok) {
          try {
            await createUserWithEmailAndPassword(auth, em, pw);
            return;
          } catch (e2) {
            alert(firebaseNiceMessage(e2));
            return;
          }
        }
        alert("Ok. Si ya tienes cuenta, revisa que el email esté bien escrito.");
        return;
      }

      alert(firebaseNiceMessage(e));
    } finally {
      setLoadingEmail(false);
    }
  };

  const resetPassword = async () => {
    const em = String(email || "").trim();
    if (!isEmailValid(em)) return alert("Pon tu email para mandarte el reset.");
    try {
      await sendPasswordResetEmail(auth, em);
      alert("Listo. Te mandé un correo para resetear tu contraseña.");
    } catch (e) {
      alert(firebaseNiceMessage(e));
    }
  };

  /* ---------------- Misc ---------------- */

  const logout = async () => {
    try {
      await FirebaseAuthentication.signOut();
    } catch {}
    try {
      await signOut(auth);
    } catch {}
    setJoinId("");
  };

  const createSession = async () => {
    if (!user) return;
    if (isBusy) return;

    setCreating(true);
    try {
      const nowName = String(newSessionName || "").trim() || `Session ${new Date().toLocaleString()}`;

      const sessionRef = await addDoc(collection(db, "sessions"), {
        name: nowName,
        status: "live",
        courseId: "campestre-slp",
        hcpPercent: 100,

        createdBy: user.uid,
        ownerUid: user.uid,

        members: { [user.uid]: true },
        memberUids: [user.uid],

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
      setNewSessionName("");
      navigate(`/session/${newSessionId}`);
    } catch (e) {
      alert(firebaseNiceMessage(e));
    } finally {
      setCreating(false);
    }
  };

  const joinSession = async () => {
    if (!user?.uid) return alert("Inicia sesión para unirte.");

    const id = sanitizeSessionId(joinId).trim();
    if (!id) return alert("Pega el Session ID.");
    if (!isLikelyValidSessionId(id)) {
      return alert("Ese Session ID se ve inválido. Revisa que sea el ID completo (solo letras, números, - y _).");
    }

    try {
      const fn = httpsCallable(getFunctions(), "joinSession");
      await fn({ sessionId: id });

      setRecent(addRecent(id));
      navigate(`/session/${id}`);
    } catch (e) {
      console.error("joinSession failed:", e);
      alert(firebaseNiceMessage(e));
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) return setJoinId(sanitizeSessionId(t.trim()));
      throw new Error("Clipboard vacío.");
    } catch {
      const manual = window.prompt("Pega aquí tu Session ID:");
      if (manual) setJoinId(sanitizeSessionId(String(manual).trim()));
    }
  };

  const removeRecent = (id) => {
    const ok = window.confirm(`¿Quitar esta sesión de Recientes?\n\n${id}`);
    if (!ok) return;
    const next = recent.filter((x) => x !== id);
    setRecent(next);
    saveRecent(next);
  };

  const showLoginCentered = !user;

  return (
    <div style={page}>
      <header style={topBar}>
        <div style={{ minWidth: 0 }}>
          <div style={brandTitle}>Apuestas Golf</div>
          <div style={brandSub}>Sesiones compartidas · Grupos · Matches · Greens</div>
        </div>

        {user ? (
          <button onClick={logout} style={btnGhost}>
            Logout
          </button>
        ) : null}
      </header>

      <main style={showLoginCentered ? mainCentered : mainNormal}>
        {!user ? (
          <div style={{ ...card, width: "min(520px, 100%)" }}>
            <div style={cardTitle}>Entrar</div>
            <div style={{ opacity: 0.8, marginTop: 6 }}>Inicia sesión para crear y administrar sesiones.</div>

            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              <button onClick={loginGoogle} disabled={isBusy} style={btnProvider}>
                <GoogleIcon />
                <span>{loadingGoogle ? "Entrando..." : "Continuar con Google"}</span>
              </button>

              {showApple ? (
                <button onClick={loginApple} disabled={isBusy} style={btnProviderApple}>
                  <AppleIcon />
                  <span>{loadingApple ? "Entrando..." : "Continuar con Apple"}</span>
                </button>
              ) : null}

              <button
                onClick={() => setShowEmail((v) => !v)}
                disabled={isBusy}
                style={{ ...btnGhost, display: "flex", justifyContent: "center" }}
              >
                {showEmail ? "Ocultar Email" : "Ingresar con Email"}
              </button>

              {showEmail ? (
                <div style={{ marginTop: 2, display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      style={emailMode === "login" ? btnPrimary : btn}
                      onClick={() => setEmailMode("login")}
                      disabled={isBusy}
                    >
                      Entrar
                    </button>
                    <button
                      type="button"
                      style={emailMode === "signup" ? btnPrimary : btn}
                      onClick={() => setEmailMode("signup")}
                      disabled={isBusy}
                    >
                      Crear cuenta
                    </button>
                    <button type="button" style={btn} onClick={resetPassword} disabled={isBusy}>
                      Reset password
                    </button>
                  </div>

                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email"
                    style={input}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    inputMode="email"
                  />
                  <input
                    value={pass}
                    onChange={(e) => setPass(e.target.value)}
                    placeholder="Password (mín 6)"
                    style={input}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    type="password"
                  />

                  <button
                    onClick={loginEmail}
                    disabled={isBusy || (emailMode !== "login" ? !canSubmitEmail : !isEmailValid(email))}
                    style={btnPrimary}
                  >
                    {loadingEmail ? "Procesando..." : emailMode === "login" ? "Entrar con Email" : "Crear cuenta con Email"}
                  </button>

                  <div style={{ opacity: 0.7, fontSize: 12, lineHeight: 1.35 }}>
                    *Para Email/Password: habilítalo en Firebase Console → Authentication → Sign-in method.
                  </div>
                </div>
              ) : null}
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
                  <div style={emailRow}>{user.email || ""}</div>
                </div>
              </div>

              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                <div style={{ opacity: 0.8, fontSize: 12, fontWeight: 900 }}>Nombre de sesión (opcional)</div>
                <input
                  value={newSessionName}
                  onChange={(e) => setNewSessionName(e.target.value)}
                  placeholder="Ej: Animalario Domingo"
                  style={input}
                  maxLength={50}
                />

                <button onClick={createSession} disabled={isBusy} style={btnPrimary}>
                  {creating ? "Creando..." : "➕ Crear sesión"}
                </button>

                <div style={hintRow}>
                  Crea una sesión nueva con <b>Campo</b>, <b>%Hcp</b> y <b>Entry</b> global.
                </div>
              </div>
            </div>

            <div style={card}>
              <div style={cardTitle}>Entrar a una sesión</div>
              <div style={{ opacity: 0.82, marginTop: 6 }}>
                Pega el Session ID y la app te agrega como miembro (seguro).
              </div>

              <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  value={joinId}
                  onChange={(e) => setJoinId(sanitizeSessionId(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") joinSession();
                  }}
                  placeholder="Ej: xYz123Abc..."
                  style={input}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <button onClick={pasteFromClipboard} style={btn}>
                  Pegar
                </button>
              </div>

              <div style={helperRow(joinHint.type)}>
                {joinHint.type === "ok" ? "✅ " : joinHint.type === "warn" ? "⚠️ " : "ℹ️ "}
                {joinHint.msg}
              </div>

              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  onClick={joinSession}
                  style={btnPrimary}
                  disabled={!isLikelyValidSessionId(sanitizeSessionId(joinId))}
                >
                  🚀 Entrar
                </button>
                <button onClick={() => setJoinId("")} style={btnGhost}>
                  Limpiar
                </button>
              </div>

              <div style={{ marginTop: 18 }}>
                <div style={{ fontWeight: 950, marginBottom: 8 }}>Mis sesiones</div>

                {loadingMySessions ? (
                  <div style={{ opacity: 0.7, fontSize: 12 }}>Cargando…</div>
                ) : mySessions.length === 0 ? (
                  <div style={{ opacity: 0.65, fontSize: 12 }}>Aún no tienes sesiones (crea una o únete con ID).</div>
                ) : (
                  <div style={recentListWrap}>
                    {mySessions.slice(0, 10).map((s) => (
                      <button
                        key={s.id}
                        style={mySessionRowBtn}
                        onClick={() => {
                          setRecent(addRecent(s.id));
                          navigate(`/session/${s.id}`);
                        }}
                        type="button"
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={mySessionName}>{s.name || "Sesión"}</div>
                          <div style={mySessionMeta}>
                            <code style={{ opacity: 0.9 }}>{s.id}</code>
                          </div>
                        </div>
                        <div style={openPill}>Abrir</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {recent.length > 0 ? (
                <div style={{ marginTop: 18 }}>
                  <div style={{ fontWeight: 950, marginBottom: 8 }}>Recientes</div>

                  <div style={recentListWrap}>
                    {recent.map((id) => (
                      <div key={id} style={recentRow}>
                        <code style={codePill} title={id}>
                          {id}
                        </code>

                        <div style={recentActions}>
                          <button
                            style={btn}
                            onClick={() => {
                              setJoinId(id);
                              navigate(`/session/${id}`);
                            }}
                          >
                            Abrir
                          </button>

                          <button style={btnDanger} onClick={() => removeRecent(id)} aria-label="Quitar de recientes">
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                      style={btnGhost}
                      onClick={() => {
                        const ok = window.confirm("¿Borrar toda la lista de sesiones recientes?");
                        if (!ok) return;
                        setRecent([]);
                        saveRecent([]);
                      }}
                    >
                      Limpiar recientes
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 14, opacity: 0.6, fontSize: 12 }}>Aquí aparecerán tus sesiones recientes.</div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/* ---------------- Icons ---------------- */

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 33 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 2.9l5.7-5.7C34.6 6 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.2-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3 0 5.7 1.1 7.8 2.9l5.7-5.7C34.6 6 29.6 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 10-2 13.5-5.2l-6.2-5.2C29.2 35.6 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.4 39.7 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-1 2.6-2.9 4.7-5.4 6.1l.1.1 6.2 5.2C35.8 40 44 34 44 24c0-1.3-.1-2.2-.4-3.5z"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M16.365 1.43c0 1.14-.42 2.2-1.25 3.13-.85.95-2.25 1.7-3.45 1.6-.15-1.12.46-2.3 1.22-3.16.84-.96 2.3-1.67 3.48-1.57zM20.8 17.15c-.55 1.27-.82 1.83-1.53 2.95-.99 1.53-2.39 3.44-4.11 3.46-1.53.02-1.93-1-4.01-1-2.08 0-2.53.98-4.06 1.02-1.72.04-3.03-1.74-4.02-3.27-2.78-4.29-3.07-9.31-1.36-11.94 1.2-1.84 3.09-2.92 4.87-2.92 1.82 0 2.96 1 4.47 1 1.47 0 2.36-1 4.48-1 1.58 0 3.25.86 4.44 2.35-3.91 2.14-3.28 7.74.83 9.35z" />
    </svg>
  );
}

/* ---------------- Styles ---------------- */

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
  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.35)",
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
const btnDanger = {
  ...btn,
  padding: "10px 12px",
  border: "1px solid #3a1a1a",
  background: "#170808",
  color: "#ffb4b4",
};

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
  minWidth: 0,
};

const recentListWrap = { display: "grid", gap: 8 };

const recentRow = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  alignItems: "center",
  gap: 10,
  minWidth: 0,
};

const recentActions = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  justifyContent: "flex-end",
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

const nameRow = {
  fontWeight: 950,
  fontSize: 16,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const emailRow = {
  fontSize: 12,
  opacity: 0.7,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const hintRow = { opacity: 0.72, fontSize: 12, lineHeight: 1.35 };

const helperRow = (type) => ({
  marginTop: 10,
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid #2a2a2a",
  background:
    type === "ok"
      ? "rgba(34, 197, 94, 0.10)"
      : type === "warn"
      ? "rgba(251, 146, 60, 0.10)"
      : "rgba(148, 163, 184, 0.08)",
  color: type === "ok" ? "#bbf7d0" : type === "warn" ? "#fed7aa" : "#e5e7eb",
  fontSize: 12,
  fontWeight: 900,
});

const mySessionRowBtn = {
  width: "100%",
  padding: 12,
  borderRadius: 16,
  border: "1px solid #2a2a2a",
  background: "#0f0f0f",
  color: "white",
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "center",
  textAlign: "left",
};

const mySessionName = {
  fontWeight: 950,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: "60vw",
};

const mySessionMeta = { marginTop: 6, fontSize: 12, opacity: 0.7, overflow: "hidden" };

const openPill = {
  padding: "8px 10px",
  borderRadius: 999,
  border: "1px solid rgba(59,130,246,0.35)",
  background: "rgba(59,130,246,0.18)",
  color: "#dbeafe",
  fontWeight: 950,
};
