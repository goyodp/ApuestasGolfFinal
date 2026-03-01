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

export default function Session() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState(null);
  const [settings, setSettings] = useState(null);
  const [groups, setGroups] = useState([]);
  const [creatingGroup, setCreatingGroup] = useState(false);

  const sessionDocRef = useMemo(() => {
    if (!sessionId) return null;
    return doc(db, "sessions", sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionDocRef) return;

    const unsub = onSnapshot(sessionDocRef, (snap) => {
      setSession(snap.exists() ? snap.data() : null);
    });

    return () => unsub();
  }, [sessionDocRef]);

  useEffect(() => {
    if (!sessionId) return;

    const settingsRef = doc(db, "sessions", sessionId, "settings", "main");
    const unsub = onSnapshot(settingsRef, (snap) => {
      setSettings(snap.exists() ? snap.data() : null);
    });

    return () => unsub();
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    const groupsRef = collection(db, "sessions", sessionId, "groups");
    const q = query(groupsRef, orderBy("order", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setGroups(rows);
    });

    return () => unsub();
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

      // 1) Meta del grupo
      await setDoc(doc(db, "sessions", sessionId, "groups", groupDocId), {
        order: nextOrder,
        name: `Grupo ${nextOrder}`,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 2) Estado editable del grupo (🔥 esto es lo que te faltaba)
      await setDoc(
        doc(db, "sessions", sessionId, "groups", groupDocId, "state", "main"),
        {
          updatedAt: serverTimestamp(),
          players: [], // máximo 6 lo controlamos en el UI
          scores: {}, // { p1: ["",...], p2: ["",...] }
          greenies: {}, // { "2": "p1" } holeIndex -> playerId
          match: {
            ventajas: {},
            dobladas: {},
            bets: {},
          },
        }
      );

      // 3) Bump updatedAt del session principal
      await updateDoc(doc(db, "sessions", sessionId), {
        updatedAt: serverTimestamp(),
      });

      // Opcional: te mando directo al scorecard del grupo recién creado
      // navigate(`/session/${sessionId}/group/${groupDocId}`);
    } catch (e) {
      console.error(e);
      alert(e?.message || "Error creando grupo");
    } finally {
      setCreatingGroup(false);
    }
  };

  if (!sessionId) {
    return (
      <div style={{ padding: 20 }}>
        <h2>Falta Session ID</h2>
        <button onClick={() => navigate("/")}>Volver</button>
      </div>
    );
  }

  if (!session) {
    return <div style={{ padding: 20 }}>Cargando sesión...</div>;
  }

  return (
    <div
      style={{
        padding: 20,
        fontFamily: "system-ui",
        maxWidth: 900,
        margin: "0 auto",
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>
            {session.name}
          </h1>

          <div style={{ opacity: 0.8, marginTop: 6 }}>
            Status: <b>{session.status}</b> · Curso: <b>{session.courseId}</b>
          </div>

          <div
            style={{
              marginTop: 10,
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <code
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                background: "#111",
                color: "#fff",
              }}
            >
              {sessionId}
            </code>

            <button onClick={copySessionId} style={{ padding: "8px 12px" }}>
              Copiar Session ID
            </button>
          </div>
        </div>

        <button onClick={() => navigate("/")} style={{ padding: "8px 12px" }}>
          ← Home
        </button>
      </div>

      <hr style={{ margin: "18px 0" }} />

      <section style={{ marginBottom: 18 }}>
        <h2 style={{ margin: "0 0 8px 0" }}>Settings</h2>
        {!settings ? (
          <div style={{ opacity: 0.75 }}>No hay settings/main todavía.</div>
        ) : (
          <div
            style={{
              display: "flex",
              gap: 14,
              flexWrap: "wrap",
              opacity: 0.9,
            }}
          >
            <div>
              Entry: <b>${settings.entryFee ?? 0}</b>
            </div>
            <div>
              Birdie: <b>${settings.birdiePay ?? 0}</b>
            </div>
            <div>
              Eagle: <b>${settings.eaglePay ?? 0}</b>
            </div>
            <div>
              Albatross: <b>${settings.albatrossPay ?? 0}</b>
            </div>
            <div>
              Greenie: <b>${settings.greeniePay ?? 0}</b>
            </div>
          </div>
        )}
      </section>

      <section>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h2 style={{ margin: 0 }}>Groups</h2>
          <button
            onClick={addGroup}
            disabled={creatingGroup}
            style={{ padding: "8px 12px" }}
          >
            {creatingGroup ? "Creando..." : "+ Agregar grupo"}
          </button>
        </div>

        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          {groups.length === 0 ? (
            <div style={{ opacity: 0.75 }}>No hay grupos todavía.</div>
          ) : (
            groups.map((g) => (
              <div
                key={g.id}
                style={{
                  border: "1px solid #2a2a2a",
                  borderRadius: 14,
                  padding: 12,
                  background: "#0f0f0f",
                  color: "white",
                }}
              >
                <div style={{ fontWeight: 800 }}>
                  {g.name || g.id}{" "}
                  <span style={{ opacity: 0.7 }}>(order {g.order})</span>
                </div>
                <div style={{ opacity: 0.7, marginTop: 4 }}>
                  id: <code>{g.id}</code>
                </div>

                <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
                  <button
                    onClick={() => navigate(`/session/${sessionId}/group/${g.id}`)}
                    style={{ padding: "8px 12px" }}
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
