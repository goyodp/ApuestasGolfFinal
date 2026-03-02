// src/screens/Session.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase/db";
import { auth } from "../firebase/auth";

import {
  COURSE_DATA,
  buildHcpAdjustments,
  computeLeaderboards,
  computeMatchResultForPair,
  fmtMatch,
} from "../lib/compute";

// Courses disponibles (session-level)
const COURSES = [
  { id: "campestre-slp", label: "Campestre de San Luis" },
  { id: "la-loma", label: "La Loma Golf" },
];

export default function Session() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState(null);
  const [settings, setSettings] = useState(null);
  const [groups, setGroups] = useState([]);          // meta: {id, order, name...}
  const [groupStates, setGroupStates] = useState({}); // { [groupId]: stateMain }

  const [creatingGroup, setCreatingGroup] = useState(false);
  const [savingCourse, setSavingCourse] = useState(false);
  const [savingHistory, setSavingHistory] = useState(false);

  const sessionRef = useMemo(() => (sessionId ? doc(db, "sessions", sessionId) : null), [sessionId]);

  // Session main
  useEffect(() => {
    if (!sessionRef) return;
    return onSnapshot(sessionRef, (snap) => {
      setSession(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
  }, [sessionRef]);

  // Settings
  useEffect(() => {
    if (!sessionId) return;
    const settingsRef = doc(db, "sessions", sessionId, "settings", "main");
    return onSnapshot(settingsRef, (snap) => setSettings(snap.exists() ? snap.data() : null));
  }, [sessionId]);

  // Groups meta
  useEffect(() => {
    if (!sessionId) return;
    const groupsRef = collection(db, "sessions", sessionId, "groups");
    const q = query(groupsRef, orderBy("order", "asc"));
    return onSnapshot(q, (snap) => {
      const meta = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setGroups(meta);
    });
  }, [sessionId]);

  // Subscribe to each group state/main (live)
  useEffect(() => {
    if (!sessionId) return;

    const unsubs = [];
    const next = {};

    groups.forEach((g) => {
      const ref = doc(db, "sessions", sessionId, "groups", g.id, "state", "main");
      const unsub = onSnapshot(ref, (snap) => {
        setGroupStates((prev) => ({
          ...prev,
          [g.id]: snap.exists() ? snap.data() : null,
        }));
      });
      unsubs.push(unsub);

      // mantiene keys consistentes (si aún no llega snapshot)
      if (!(g.id in next)) next[g.id] = groupStates[g.id] ?? null;
    });

    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, groups.map((g) => g.id).join("|")]);

  // Derived session-level config
  const courseId = session?.courseId || "campestre-slp";
  const course = COURSE_DATA[courseId] || COURSE_DATA["campestre-slp"];
  const hcpPercent = session?.hcpPercent ?? 100;

  // Build groupsFull for compute
  const groupsFull = groups.map((g) => {
    const st = groupStates[g.id] || {};
    return {
      id: g.id,
      order: g.order || 0,
      name: g.name || g.id,
      players: st?.players || [],
      scores: st?.scores || {},
      matchBets: st?.matchBets || {},   // por si luego lo metes ahí
      dobladas: st?.dobladas || {},     // por si luego lo metes ahí
    };
  });

  // Live computed leaderboards
  const computed = computeLeaderboards({
    groupsFull,
    courseId,
    hcpPercent,
  });

  const copySessionId = async () => {
    try {
      await navigator.clipboard.writeText(sessionId);
      alert("Session ID copiado ✅");
    } catch {
      alert("No pude copiar. Cópialo manual: " + sessionId);
    }
  };

  const changeCourse = async (newCourseId) => {
    if (!sessionRef) return;
    setSavingCourse(true);
    try {
      await updateDoc(sessionRef, { courseId: newCourseId, updatedAt: serverTimestamp() });
    } catch (e) {
      console.error(e);
      alert(e?.message || "No se pudo actualizar el campo");
    } finally {
      setSavingCourse(false);
    }
  };

  const changeHcpPercent = async (value) => {
    if (!sessionRef) return;
    const v = Math.max(0, Math.min(100, parseInt(value || "0", 10)));
    try {
      await updateDoc(sessionRef, { hcpPercent: v, updatedAt: serverTimestamp() });
    } catch (e) {
      console.error(e);
      alert(e?.message || "No se pudo actualizar handicap %");
    }
  };

  const addGroup = async () => {
    if (!sessionId) return;
    setCreatingGroup(true);
    try {
      const nextOrder = (groups?.length ? Math.max(...groups.map((g) => g.order || 0)) : 0) + 1;
      const groupDocId = `group-${nextOrder}`;

      await setDoc(doc(db, "sessions", sessionId, "groups", groupDocId), {
        order: nextOrder,
        name: `Grupo ${nextOrder}`,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await updateDoc(doc(db, "sessions", sessionId), { updatedAt: serverTimestamp() });
    } catch (e) {
      console.error(e);
      alert(e?.message || "Error creando grupo");
    } finally {
      setCreatingGroup(false);
    }
  };

  // ---------- HISTORY SNAPSHOT ----------
  const buildSnapshot = async () => {
    const sessionSnap = await getDoc(doc(db, "sessions", sessionId));
    const sessionData = sessionSnap.exists() ? sessionSnap.data() : {};

    const settingsSnap = await getDoc(doc(db, "sessions", sessionId, "settings", "main"));
    const settingsData = settingsSnap.exists() ? settingsSnap.data() : {};

    // Reuse groupsFull already live in UI (pero guardamos lo que haya en Firestore)
    // Para historia “exacta”, tomamos groupStates actuales (ya están live)
    const snapGroupsFull = groups.map((g) => {
      const st = groupStates[g.id] || {};
      return {
        id: g.id,
        order: g.order || 0,
        name: g.name || g.id,
        players: st?.players || [],
        scores: st?.scores || {},
        matchBets: st?.matchBets || {},
        dobladas: st?.dobladas || {},
        greenies: st?.greenies || {},
      };
    });

    const snapshotCourseId = sessionData?.courseId || "campestre-slp";
    const snapshotHcpPercent = sessionData?.hcpPercent ?? 100;

    const snapComputed = computeLeaderboards({
      groupsFull: snapGroupsFull,
      courseId: snapshotCourseId,
      hcpPercent: snapshotHcpPercent,
    });

    // matches by group (solo marcador F9/B9/T por ahora)
    const matchesByGroup = {};
    for (const g of snapGroupsFull) {
      const ps = g.players || [];
      const sc = g.scores || {};
      const res = [];

      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i];
          const b = ps[j];
          const r = computeMatchResultForPair({
            a,
            b,
            scores: sc,
            courseId: snapshotCourseId,
            hcpPercent: snapshotHcpPercent,
          });
          res.push(r);
        }
      }
      matchesByGroup[g.id] = res;
    }

    return {
      session: {
        name: sessionData?.name || "",
        status: sessionData?.status || "",
        courseId: snapshotCourseId,
        hcpPercent: snapshotHcpPercent,
      },
      settings: settingsData,
      groups: snapGroupsFull,
      computed: {
        leaderboardNet: snapComputed.netRows,
        leaderboardStableford: snapComputed.stbRows,
        matchesByGroup,
      },
    };
  };

  const saveHistory = async () => {
    if (!sessionId) return;
    setSavingHistory(true);
    try {
      const snapshot = await buildSnapshot();
      await addDoc(collection(db, "sessions", sessionId, "history"), {
        ...snapshot,
        createdAt: serverTimestamp(),
        createdByUid: auth.currentUser?.uid || null,
      });
      alert("Historial guardado ✅");
    } catch (e) {
      console.error(e);
      alert(e?.message || "No pude guardar historial");
    } finally {
      setSavingHistory(false);
    }
  };

  // ---------- UI ----------
  if (!sessionId) {
    return (
      <div style={page}>
        <h2>Falta Session ID</h2>
        <button style={btn} onClick={() => navigate("/")}>Volver</button>
      </div>
    );
  }

  if (!session) return <div style={page}>Cargando sesión...</div>;

  const courseLabel = (COURSES.find((c) => c.id === courseId)?.label) || courseId;

  return (
    <div style={page}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>
            {session.name || "Sesión"}
          </h1>

          <div style={{ opacity: 0.85, marginTop: 6 }}>
            Status: <b>{session.status || "live"}</b> · Campo: <b>{courseLabel}</b>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <code style={pillCode}>{sessionId}</code>
            <button onClick={copySessionId} style={btn}>Copiar Session ID</button>
            <button onClick={saveHistory} disabled={savingHistory} style={btnPrimary}>
              {savingHistory ? "Guardando..." : "💾 Guardar Historial"}
            </button>
          </div>

          {/* Campo + %Hcp */}
          <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 900 }}>Campo:</div>
            <select
              value={courseId}
              onChange={(e) => changeCourse(e.target.value)}
              style={select}
              disabled={savingCourse}
            >
              {COURSES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            {savingCourse ? <span style={{ opacity: 0.75 }}>Guardando…</span> : null}

            <div style={{ width: 10 }} />

            <div style={{ fontWeight: 900 }}>% Handicap:</div>
            <input
              type="number"
              defaultValue={hcpPercent}
              onBlur={(e) => changeHcpPercent(e.target.value)}
              style={inputSmall}
            />
            <span style={{ opacity: 0.75 }}>aplica para strokes</span>
          </div>
        </div>

        <button onClick={() => navigate("/")} style={btn}>← Home</button>
      </div>

      <hr style={hr} />

      {/* Settings */}
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

      {/* Leaderboards */}
      <section style={{ marginBottom: 18 }}>
        <h2 style={{ margin: "0 0 8px 0" }}>Leaderboard (General)</h2>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={card}>
            <div style={cardTitle}>Stableford (mejor = mayor)</div>
            <table style={miniTable}>
              <thead>
                <tr>
                  <th style={miniTh}>#</th>
                  <th style={miniThLeft}>Jugador</th>
                  <th style={miniTh}>HCP</th>
                  <th style={miniTh}>STB</th>
                </tr>
              </thead>
              <tbody>
                {computed.stbRows.slice(0, 12).map((r, i) => (
                  <tr key={i}>
                    <td style={miniTd}>{i + 1}</td>
                    <td style={miniTdLeft}>{r.name}</td>
                    <td style={miniTd}>{r.hcp}</td>
                    <td style={miniTd}><b>{r.stb}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ opacity: 0.65, marginTop: 8, fontSize: 12 }}>
              Empate: gana el HCP menor (sube arriba).
            </div>
          </div>

          <div style={card}>
            <div style={cardTitle}>Net (mejor = menor)</div>
            <table style={miniTable}>
              <thead>
                <tr>
                  <th style={miniTh}>#</th>
                  <th style={miniThLeft}>Jugador</th>
                  <th style={miniTh}>HCP</th>
                  <th style={miniTh}>Net</th>
                </tr>
              </thead>
              <tbody>
                {computed.netRows.slice(0, 12).map((r, i) => (
                  <tr key={i}>
                    <td style={miniTd}>{i + 1}</td>
                    <td style={miniTdLeft}>{r.name}</td>
                    <td style={miniTd}>{r.hcp}</td>
                    <td style={miniTd}><b>{r.net}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ opacity: 0.65, marginTop: 8, fontSize: 12 }}>
              Empate: gana el HCP menor (sube arriba).
            </div>
          </div>
        </div>
      </section>

      <hr style={hr} />

      {/* Groups */}
      <section>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h2 style={{ margin: 0 }}>Groups</h2>
          <button onClick={addGroup} disabled={creatingGroup} style={btn}>
            {creatingGroup ? "Creando..." : "+ Agregar grupo"}
          </button>
        </div>

        <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
          {groups.length === 0 ? (
            <div style={{ opacity: 0.75 }}>No hay grupos todavía.</div>
          ) : (
            groups.map((g) => (
              <GroupCard
                key={g.id}
                sessionId={sessionId}
                group={g}
                courseId={courseId}
                hcpPercent={hcpPercent}
                state={groupStates[g.id]}
                onOpen={() => navigate(`/session/${sessionId}/group/${g.id}`)}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

// ---------- Group card + matches live ----------
function GroupCard({ group, courseId, hcpPercent, state, onOpen }) {
  const players = state?.players || [];
  const scores = state?.scores || {};

  const matches = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i];
      const b = players[j];

      const r = computeMatchResultForPair({
        a,
        b,
        scores,
        courseId,
        hcpPercent,
      });

      matches.push({
        label: r.label,
        front: r.front,
        back: r.back,
        total: r.total,
      });
    }
  }

  return (
    <div style={groupCard}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 900, fontSize: 18 }}>
            {group.name || group.id}{" "}
            <span style={{ opacity: 0.7, fontWeight: 700 }}>(order {group.order})</span>
          </div>
          <div style={{ opacity: 0.75, marginTop: 6 }}>
            Jugadores: <b>{players.length}</b> / 6
          </div>
        </div>
        <button style={btnPrimary} onClick={onOpen}>Abrir Scorecard →</button>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>Cruces (Match Play)</div>
        {matches.length === 0 ? (
          <div style={{ opacity: 0.7 }}>Aún no hay cruces (agrega jugadores).</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {matches.map((m, idx) => {
              const c =
                m.total > 0 ? "#86efac" :
                m.total < 0 ? "#fca5a5" :
                "#d4d4d4";
              return (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "8px 10px",
                    border: "1px solid #2a2a2a",
                    borderRadius: 12,
                    background: "#0c0c0c",
                  }}
                >
                  <div style={{ fontWeight: 800 }}>{m.label}</div>
                  <div style={{ display: "flex", gap: 10, fontWeight: 900, color: c }}>
                    <span>F9 {fmtMatch(m.front)}</span>
                    <span>B9 {fmtMatch(m.back)}</span>
                    <span>T {fmtMatch(m.total)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- styles ----------
const page = {
  padding: 20,
  fontFamily: "system-ui",
  maxWidth: 1100,
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
  fontWeight: 900,
};

const btn = {
  padding: "10px 14px",
  borderRadius: 14,
  border: "1px solid #2a2a2a",
  background: "#141414",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};

const btnPrimary = {
  ...btn,
  background: "#1f2937",
  border: "1px solid #374151",
};

const select = {
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid #2a2a2a",
  background: "#111",
  color: "white",
  fontWeight: 900,
  minWidth: 240,
};

const inputSmall = {
  width: 90,
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid #2a2a2a",
  background: "#111",
  color: "white",
  fontWeight: 900,
};

const card = {
  border: "1px solid #2a2a2a",
  borderRadius: 18,
  padding: 14,
  background: "#0f0f0f",
};

const cardTitle = { fontWeight: 900, marginBottom: 10, fontSize: 16 };

const miniTable = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

const miniTh = {
  textAlign: "center",
  padding: 8,
  borderBottom: "1px solid #2a2a2a",
  opacity: 0.8,
};

const miniThLeft = { ...miniTh, textAlign: "left" };

const miniTd = {
  textAlign: "center",
  padding: 8,
  borderBottom: "1px solid #1f1f1f",
};

const miniTdLeft = { ...miniTd, textAlign: "left" };

const groupCard = {
  border: "1px solid #2a2a2a",
  borderRadius: 18,
  padding: 14,
  background: "#0f0f0f",
};
