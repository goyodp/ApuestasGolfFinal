// src/screens/Session.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase/db";
import { auth } from "../firebase/auth";

// Ajusta si tu ruta/export difiere:
import { buildStrokeArray, buildHcpAdjustments } from "../lib/compute";

// 👇 Mantén aquí los courses (por ahora)
const COURSES = [
  { id: "campestre-slp", label: "Campestre de San Luis" },
  { id: "la-loma", label: "La Loma Golf" },
];

const COURSE_DATA = {
  "campestre-slp": {
    name: "Campestre de San Luis",
    parValues: [4, 3, 4, 4, 4, 4, 5, 3, 5, 5, 3, 4, 4, 4, 3, 4, 4, 5],
    strokeIndexes: [3, 13, 15, 7, 5, 1, 17, 11, 9, 4, 12, 6, 14, 18, 8, 2, 16, 10],
  },
  "la-loma": {
    name: "La Loma Golf",
    parValues: [4, 4, 4, 3, 5, 5, 4, 3, 4, 4, 3, 4, 4, 4, 5, 4, 3, 5],
    strokeIndexes: [11, 3, 13, 17, 7, 5, 1, 15, 9, 2, 18, 10, 16, 4, 8, 14, 12, 6],
  },
};

// ---------- helpers cálculos ----------
function safeInt(v) {
  const n = parseInt(v);
  return Number.isNaN(n) ? null : n;
}

function sumGross(arr18) {
  let t = 0;
  for (let i = 0; i < 18; i++) {
    const n = safeInt(arr18?.[i]);
    if (n !== null) t += n;
  }
  return t;
}

function netTotal(arr18, hcpAdj18) {
  let t = 0;
  for (let i = 0; i < 18; i++) {
    const g = safeInt(arr18?.[i]);
    if (g !== null) t += g - (hcpAdj18[i] || 0);
  }
  return t;
}

function matchByHcpDiff({ grossA, grossB, diffStrokesForA, strokeIndexes }) {
  // diffStrokesForA > 0 => A recibe golpes
  // diffStrokesForA < 0 => B recibe golpes
  const strokesA = diffStrokesForA > 0 ? buildStrokeArray(diffStrokesForA, strokeIndexes) : Array(18).fill(0);
  const strokesB = diffStrokesForA < 0 ? buildStrokeArray(Math.abs(diffStrokesForA), strokeIndexes) : Array(18).fill(0);

  let front = 0;
  let back = 0;

  for (let i = 0; i < 18; i++) {
    const a = safeInt(grossA?.[i]);
    const b = safeInt(grossB?.[i]);
    if (a === null || b === null) continue;

    const aAdj = a - (strokesA[i] || 0);
    const bAdj = b - (strokesB[i] || 0);

    let r = 0;
    if (aAdj < bAdj) r = 1;
    else if (aAdj > bAdj) r = -1;

    if (i < 9) front += r;
    else back += r;
  }

  return { front, back, total: front + back };
}

function tieBreak(a, b, key, hcpKey = "hcp") {
  // key: "gross" (asc) o "net" (asc)
  // si empatan, gana hcp menor (sube)
  if (a[key] !== b[key]) return a[key] - b[key];
  return (a[hcpKey] || 0) - (b[hcpKey] || 0);
}

// ---------- componente ----------
export default function Session() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState(null);
  const [settings, setSettings] = useState(null);
  const [groups, setGroups] = useState([]);

  const [creatingGroup, setCreatingGroup] = useState(false);
  const [savingCourse, setSavingCourse] = useState(false);
  const [savingHistory, setSavingHistory] = useState(false);

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
    return onSnapshot(settingsRef, (snap) => setSettings(snap.exists() ? snap.data() : null));
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const groupsRef = collection(db, "sessions", sessionId, "groups");
    const q = query(groupsRef, orderBy("order", "asc"));
    return onSnapshot(q, (snap) => {
      setGroups(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, [sessionId]);

  const courseId = session?.courseId || "campestre-slp";
  const course = COURSE_DATA[courseId] || COURSE_DATA["campestre-slp"];
  const hcpPercent = session?.hcpPercent ?? 100;

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
    const v = Math.max(0, Math.min(100, parseInt(value || "0")));
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
      const nextOrder =
        (groups?.length ? Math.max(...groups.map((g) => g.order || 0)) : 0) + 1;

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

  // ---------- snapshot + computed ----------
  const buildSnapshot = async () => {
    // sesión
    const sessionSnap = await getDoc(doc(db, "sessions", sessionId));
    const sessionData = sessionSnap.exists() ? sessionSnap.data() : {};

    // settings
    const settingsSnap = await getDoc(doc(db, "sessions", sessionId, "settings", "main"));
    const settingsData = settingsSnap.exists() ? settingsSnap.data() : {};

    // groups meta
    const groupsSnap = await getDocs(
      query(collection(db, "sessions", sessionId, "groups"), orderBy("order", "asc"))
    );
    const groupsMeta = groupsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // group state/main
    const groupsFull = [];
    for (const g of groupsMeta) {
      const st = await getDoc(doc(db, "sessions", sessionId, "groups", g.id, "state", "main"));
      groupsFull.push({
        id: g.id,
        name: g.name || g.id,
        order: g.order || 0,
        ...(st.exists() ? st.data() : {}),
      });
    }

    const snapshotCourseId = sessionData?.courseId || "campestre-slp";
    const snapshotCourse = COURSE_DATA[snapshotCourseId] || COURSE_DATA["campestre-slp"];
    const snapshotHcpPercent = sessionData?.hcpPercent ?? 100;

    const { parValues, strokeIndexes } = snapshotCourse;

    // Flatten global players
    const allPlayers = [];
    const allScores = []; // aligned
    const playerMeta = []; // { groupId, playerId }
    groupsFull.forEach((g) => {
      const ps = g.players || [];
      const sc = g.scores || {};
      ps.forEach((p) => {
        allPlayers.push(p);
        allScores.push(sc[p.id] || Array(18).fill(""));
        playerMeta.push({ groupId: g.id, playerId: p.id });
      });
    });

    // Leaderboard Gross + Net (ASC) con tie-break por HCP menor
    const grossRows = allPlayers.map((p, idx) => ({
      name: p.name || "",
      hcp: p.hcp || 0,
      gross: sumGross(allScores[idx]),
      groupId: playerMeta[idx].groupId,
    }))
    .sort((a, b) => tieBreak(a, b, "gross"));

    const netRows = allPlayers.map((p, idx) => {
      const adj = buildHcpAdjustments(p.hcp || 0, snapshotHcpPercent, strokeIndexes);
      return {
        name: p.name || "",
        hcp: p.hcp || 0,
        net: netTotal(allScores[idx], adj),
        groupId: playerMeta[idx].groupId,
      };
    })
    .sort((a, b) => tieBreak(a, b, "net"));

    // Matches por grupo usando DIFERENCIA (hcpA - hcpB)
    // diff > 0 => A recibe diff golpes; diff < 0 => B recibe
    const matchesByGroup = {};
    groupsFull.forEach((g) => {
      const ps = g.players || [];
      const sc = g.scores || {};
      const res = [];

      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const A = ps[i];
          const B = ps[j];

          const rawDiff = (B.hcp || 0) - (A.hcp || 0); // si B tiene más hcp, B recibe
          const diffStrokesForA = Math.round((-rawDiff) * (snapshotHcpPercent / 100));
          // Explicación:
          // Queremos diffStrokesForA: positivo => A recibe
          // rawDiff = B - A. Si B es mayor, A debería NO recibir (B recibe), por eso usamos -rawDiff.

          const r = matchByHcpDiff({
            grossA: sc[A.id] || Array(18).fill(""),
            grossB: sc[B.id] || Array(18).fill(""),
            diffStrokesForA,
            strokeIndexes,
          });

          res.push({
            label: `${A.name} vs ${B.name}`,
            a: { id: A.id, name: A.name, hcp: A.hcp || 0 },
            b: { id: B.id, name: B.name, hcp: B.hcp || 0 },
            diffStrokesForA,
            front: r.front,
            back: r.back,
            total: r.total,
          });
        }
      }

      matchesByGroup[g.id] = res;
    });

    return {
      session: {
        name: sessionData?.name || "",
        status: sessionData?.status || "",
        courseId: snapshotCourseId,
        hcpPercent: snapshotHcpPercent,
      },
      settings: settingsData,
      groups: groupsFull,
      computed: {
        leaderboardGross: grossRows,
        leaderboardNet: netRows,
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

      {/* Leaderboards (computed live desde groups/state) */}
      <ComputedLeaderboards
        sessionId={sessionId}
        course={course}
        hcpPercent={hcpPercent}
      />

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
                course={course}
                hcpPercent={hcpPercent}
                onOpen={() => navigate(`/session/${sessionId}/group/${g.id}`)}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

// ---------- Leaderboard live ----------
function ComputedLeaderboards({ sessionId, course, hcpPercent }) {
  const [rows, setRows] = useState({ gross: [], net: [] });

  useEffect(() => {
    let mounted = true;

    async function loadAll() {
      const groupsSnap = await getDocs(
        query(collection(db, "sessions", sessionId, "groups"), orderBy("order", "asc"))
      );

      const groupsMeta = groupsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const allPlayers = [];
      const allScores = [];
      const groupIds = [];

      for (const g of groupsMeta) {
        const st = await getDoc(doc(db, "sessions", sessionId, "groups", g.id, "state", "main"));
        const data = st.exists() ? st.data() : {};
        const players = data.players || [];
        const scores = data.scores || {};
        players.forEach((p) => {
          allPlayers.push(p);
          allScores.push(scores[p.id] || Array(18).fill(""));
          groupIds.push(g.id);
        });
      }

      const gross = allPlayers
        .map((p, idx) => ({
          name: p.name || "",
          hcp: p.hcp || 0,
          gross: sumGross(allScores[idx]),
          groupId: groupIds[idx],
        }))
        .sort((a, b) => tieBreak(a, b, "gross"));

      const net = allPlayers
        .map((p, idx) => {
          const adj = buildHcpAdjustments(p.hcp || 0, hcpPercent, course.strokeIndexes);
          return {
            name: p.name || "",
            hcp: p.hcp || 0,
            net: netTotal(allScores[idx], adj),
            groupId: groupIds[idx],
          };
        })
        .sort((a, b) => tieBreak(a, b, "net"));

      if (mounted) setRows({ gross, net });
    }

    loadAll().catch(console.error);
    return () => {
      mounted = false;
    };
  }, [sessionId, course.strokeIndexes, hcpPercent]);

  return (
    <section style={{ marginBottom: 18 }}>
      <h2 style={{ margin: "0 0 8px 0" }}>Leaderboard (General)</h2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={card}>
          <div style={cardTitle}>Gross (mejor = menor)</div>
          <table style={miniTable}>
            <thead>
              <tr>
                <th style={miniTh}>#</th>
                <th style={miniThLeft}>Jugador</th>
                <th style={miniTh}>HCP</th>
                <th style={miniTh}>Gross</th>
              </tr>
            </thead>
            <tbody>
              {rows.gross.slice(0, 12).map((r, i) => (
                <tr key={i}>
                  <td style={miniTd}>{i + 1}</td>
                  <td style={miniTdLeft}>{r.name}</td>
                  <td style={miniTd}>{r.hcp}</td>
                  <td style={miniTd}><b>{r.gross}</b></td>
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
              {rows.net.slice(0, 12).map((r, i) => (
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
  );
}

// ---------- Group card + matches live ----------
function GroupCard({ sessionId, group, course, hcpPercent, onOpen }) {
  const [state, setState] = useState(null);

  useEffect(() => {
    const ref = doc(db, "sessions", sessionId, "groups", group.id, "state", "main");
    return onSnapshot(ref, (snap) => setState(snap.exists() ? snap.data() : null));
  }, [sessionId, group.id]);

  const players = state?.players || [];
  const scores = state?.scores || {};

  const matches = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const A = players[i];
      const B = players[j];

      // DIFERENCIA de handicap (A vs B)
      // Si A=1, B=10 => B recibe 9 golpes.
      // Queremos diffStrokesForA: positivo => A recibe; negativo => B recibe
      const rawDiff = (B.hcp || 0) - (A.hcp || 0);
      const diffStrokesForA = Math.round((-rawDiff) * (hcpPercent / 100));

      const r = matchByHcpDiff({
        grossA: scores[A.id] || Array(18).fill(""),
        grossB: scores[B.id] || Array(18).fill(""),
        diffStrokesForA,
        strokeIndexes: course.strokeIndexes,
      });

      matches.push({
        label: `${A.name} vs ${B.name}`,
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
                <div key={idx} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 10px", border: "1px solid #2a2a2a", borderRadius: 12, background: "#0c0c0c" }}>
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

function fmtMatch(v) {
  if (v === 0) return "AS";
  if (v > 0) return `+${v}`;
  return `${v}`;
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
