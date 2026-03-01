// src/screens/Session.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase/db";

const COURSES = [
  { id: "campestre-slp", label: "Campestre de San Luis" },
  { id: "la-loma", label: "La Loma Golf" },
];

export default function Session() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState(null);
  const [settings, setSettings] = useState(null);
  const [groups, setGroups] = useState([]);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [savingCourse, setSavingCourse] = useState(false);

  const sessionRef = useMemo(() => {
    if (!sessionId) return null;
    return doc(db, "sessions", sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionRef) return;
    return onSnapshot(sessionRef, (snap) => {
      setSession(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
  }, [sessionRef]);

  useEffect(() => {
    if (!sessionId) return;
    const settingsRef = doc(db, "sessions", sessionId, "settings", "main");
    return onSnapshot(settingsRef, (snap) => {
      setSettings(snap.exists() ? snap.data() : null);
    });
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const groupsRef = collection(db, "sessions", sessionId, "groups");
    const q = query(groupsRef, orderBy("order", "asc"));
    return onSnapshot(q, (snap) => {
      setGroups(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, [sessionId]);

  const copySessionId = async () => {
    try {
      await navigator.clipboard.writeText(sessionId);
      alert("Session ID copiado ✅");
    } catch {
      alert("No pude copiar. Cópialo manual: " + sessionId);
    }
  };

  const addGroup = async () => {
    if (!sessionId) return;
    setCreatingGroup(true);
    try {
      const nextOrder =
        (groups?.length ? Math.max(...groups.map((g) => g.order || 0)) : 0) + 1;

      const groupDocId = `group-${nextOrder}`;

      await setDoc(doc(db, "sessions", sessionId, "groups", groupDocId), {
        order: nextOrder,
        name: `Grupo ${nextOrder}`,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // refresca updatedAt en la sesión
      await updateDoc(doc(db, "sessions", sessionId), {
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error(e);
      alert(e?.message || "Error creando grupo");
    } finally {
      setCreatingGroup(false);
    }
  };

  const changeCourse = async (newCourseId) => {
    if (!sessionRef) return;
    setSavingCourse(true);
    try {
      await updateDoc(sessionRef, {
        courseId: newCourseId,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error(e);
      alert(e?.message || "No se pudo actualizar el campo");
    } finally {
      setSavingCourse(false);
    }
  };

  if (!sessionId) {
    return (
      <div style={page}>
        <h2>Falta Session ID</h2>
        <button style={btn} onClick={() => navigate("/")}>
          Volver
        </button>
      </div>
    );
  }

  if (!session) return <div style={page}>Cargando sesión...</div>;

  const courseLabel =
    COURSES.find((c) => c.id === session.courseId)?.label || session.courseId || "—";

  return (
    <div style={page}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>
            {session.name || "Sesión"}
          </h1>

          <div style={{ opacity: 0.85, marginTop: 6 }}>
            Status: <b>{session.status || "—"}</b> · Campo: <b>{courseLabel}</b>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <code style={pillCode}>{sessionId}</code>
            <button onClick={copySessionId} style={btn}>
              Copiar Session ID
            </button>
          </div>

          {/* CAMPO (A NIVEL SESIÓN) */}
          <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 800, opacity: 0.9 }}>Campo:</div>
            <select
              value={session.courseId || "campestre-slp"}
              onChange={(e) => changeCourse(e.target.value)}
              style={select}
              disabled={savingCourse}
            >
              {COURSES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            {savingCourse ? <span style={{ opacity: 0.7 }}>Guardando…</span> : null}
          </div>
        </div>

        <button onClick={() => navigate("/")} style={btn}>
          ← Home
        </button>
      </div>

      <hr style={hr} />

      <section style={{ marginBottom: 18 }}>
        <h2 style={{ margin: "0 0 8px 0" }}>Settings</h2>
        {!settings ? (
          <div style={{ opacity: 0.75 }}>No hay settings/main todavía.</div>
        ) : (
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", opacity: 0.95 }}>
            <div>Entry: <b>${settings.entryFee ?? 0}</b></div>
            <div>Birdie: <b>${settings.birdiePay ?? 0}</b></div>
            <div>Eagle: <b>${settings.eaglePay ?? 0}</b></div>
            <div>Albatross: <b>${settings.albatrossPay ?? 0}</b></div>
            <div>Greenie: <b>${settings.greeniePay ?? 0}</b></div>
          </div>
        )}
      </section>

      <section>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h2 style={{ margin: 0 }}>Groups</h2>
          <button onClick={addGroup} disabled={creatingGroup} style={btn}>
            {creatingGroup ? "Creando..." : "+ Agregar grupo"}
          </button>
        </div>

        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          {groups.length === 0 ? (
            <div style={{ opacity: 0.75 }}>No hay grupos todavía.</div>
          ) : (
            groups.map((g) => (
              <div key={g.id} style={card}>
                <div style={{ fontWeight: 900, fontSize: 18 }}>
                  {g.name || g.id} <span style={{ opacity: 0.7, fontWeight: 700 }}>(order {g.order})</span>
                </div>
                <div style={{ opacity: 0.75, marginTop: 6 }}>
                  id: <code>{g.id}</code>
                </div>

                <div style={{ marginTop: 12 }}>
                  <button
                    style={btn}
                    onClick={() => navigate(`/session/${sessionId}/group/${g.id}`)}
                  >
                    Abrir Scorecard →
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

/* ---------- styles ---------- */

const page = {
  padding: 20,
  fontFamily: "system-ui",
  maxWidth: 980,
  margin: "0 auto",
  color: "white",
};

const hr = { margin: "18px 0", borderColor: "#2a2a2a" };

const pillCode = {
  padding: "8px 12px",
  borderRadius: 14,
  background: "#0f0f0f",
  border: "1px solid #2a2a2a",
  color: "white",
  fontWeight: 800,
};

const btn = {
  padding: "10px 14px",
  borderRadius: 14,
  border: "1px solid #2a2a2a",
  background: "#141414",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
};

const select = {
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid #2a2a2a",
  background: "#111",
  color: "white",
  fontWeight: 800,
  minWidth: 240,
};

const card = {
  border: "1px solid #2a2a2a",
  borderRadius: 18,
  padding: 14,
  background: "#0f0f0f",
};
