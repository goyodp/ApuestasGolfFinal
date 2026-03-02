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

import {
  COURSE_DATA,
  computeLeaderboards,
  computeMatchResultForPair,
  fmtMatch,
  fmtMoney,
  computeEntryPrizes,
} from "../lib/compute";

const COURSES = [
  { id: "campestre-slp", label: "Campestre de San Luis" },
  { id: "la-loma", label: "La Loma Golf" },
];

export default function Session() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState(null);
  const [settings, setSettings] = useState(null); // settings/main (entry fee)
  const [groups, setGroups] = useState([]);

  const [creatingGroup, setCreatingGroup] = useState(false);
  const [savingCourse, setSavingCourse] = useState(false);
  const [savingHistory, setSavingHistory] = useState(false);
  const [savingEntry, setSavingEntry] = useState(false);

  const [groupsStateMap, setGroupsStateMap] = useState({}); // { [groupId]: stateMain }

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

  // Subscribe to each group's state/main
  useEffect(() => {
    if (!sessionId) return;

    const unsubs = [];

    groups.forEach((g) => {
      const ref = doc(db, "sessions", sessionId, "groups", g.id, "state", "main");
      const unsub = onSnapshot(ref, (snap) => {
        const data = snap.exists() ? snap.data() : null;
        setGroupsStateMap((prev) => ({ ...prev, [g.id]: data }));
      });
      unsubs.push(unsub);
    });

    return () => unsubs.forEach((u) => u && u());
  }, [sessionId, groups]);

  const courseId = session?.courseId || "campestre-slp";
  const course = COURSE_DATA[courseId] || COURSE_DATA["campestre-slp"];
  const hcpPercent = session?.hcpPercent ?? 100;

  const entryFee = settings?.entryFee ?? 0;

  const copySessionId = async () => {
    try {
      await navigator.clipboard.writeText(sessionId);
      alert("Session ID copiado ✅");
    } catch {
      alert("No pude copiar. Cópialo manual: " + sessionId);
    }
  };

  const ensureSettingsDoc = async () => {
    if (!sessionId) return;
    const ref = doc(db, "sessions", sessionId, "settings", "main");
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { entryFee: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
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

  const changeEntryFee = async (value) => {
    if (!sessionId) return;
    setSavingEntry(true);
    try {
      await ensureSettingsDoc();
      const ref = doc(db, "sessions", sessionId, "settings", "main");
      const v = Math.max(0, parseInt(value || "0", 10));
      await updateDoc(ref, { entryFee: v, updatedAt: serverTimestamp() });
    } catch (e) {
      console.error(e);
      alert(e?.message || "No se pudo actualizar entry fee");
    } finally {
      setSavingEntry(false);
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

  // ---------- History snapshot ----------
  const buildSnapshot = async () => {
    const sessionSnap = await getDoc(doc(db, "sessions", sessionId));
    const sessionData = sessionSnap.exists() ? sessionSnap.data() : {};

    const settingsSnap = await getDoc(doc(db, "sessions", sessionId, "settings", "main"));
    const settingsData = settingsSnap.exists() ? settingsSnap.data() : {};

    const groupsSnap = await getDocs(
      query(collection(db, "sessions", sessionId, "groups"), orderBy("order", "asc"))
    );
    const groupsMeta = groupsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

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
    const snapshotHcpPercent = sessionData?.hcpPercent ?? 100;

    const { stablefordRows, netRows } = computeLeaderboards({
      groupsFull,
      courseId: snapshotCourseId,
      hcpPercent: snapshotHcpPercent,
    });

    const matchesByGroup = {};
    for (const g of groupsFull) {
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
          });
          res.push(r);
        }
      }
      matchesByGroup[g.id] = res;
    }

    const prizes = computeEntryPrizes({
      groupsFull,
      courseId: snapshotCourseId,
      hcpPercent: snapshotHcpPercent,
      entryFee: settingsData?.entryFee ?? 0,
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
        leaderboardStableford: stablefordRows,
        leaderboardNet: netRows,
        matchesByGroup,
        entryPrizes: prizes,
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

  // groupsFull from live map
  const groupsFull = groups.map((g) => ({
    id: g.id,
    name: g.name || g.id,
    order: g.order || 0,
    ...(groupsStateMap[g.id] || {}),
  }));

  const { stablefordRows, netRows } = computeLeaderboards({
    groupsFull,
    courseId,
    hcpPercent,
  });

  const prizes = computeEntryPrizes({
    groupsFull,
    courseId,
    hcpPercent,
    entryFee,
  });

  return (
    <div style={page}>
      <style>{`
        .ag-row{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
        @media (max-width:520px){
          .ag-row{ gap:8px; }
          .ag-h1{ font-size:24px !important; }
        }
      `}</style>

      <div style={topHeader}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="ag-h1" style={{ margin: 0, fontSize: 28, fontWeight: 950, letterSpacing: -0.4 }}>
            {session.name || "Sesión"}
          </h1>

          <div style={{ opacity: 0.85, marginTop: 6 }}>
            Status: <b>{session.status || "live"}</b> · Campo: <b>{courseLabel}</b>
          </div>

          <div className="ag-row" style={{ marginTop: 12 }}>
            <code style={pillCode}>{sessionId}</code>
            <button onClick={copySessionId} style={btn}>Copiar Session ID</button>
            <button onClick={saveHistory} disabled={savingHistory} style={btnPrimary}>
              {savingHistory ? "Guardando..." : "💾 Guardar Historial"}
            </button>
          </div>

          <div className="ag-row" style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 950 }}>Campo:</div>
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

            <div style={{ width: 6 }} />

            <div style={{ fontWeight: 950 }}>% Handicap (Net/STB):</div>
            <input
              type="number"
              defaultValue={hcpPercent}
              onBlur={(e) => changeHcpPercent(e.target.value)}
              style={inputSmall}
            />
            <span style={{ opacity: 0.7, fontSize: 12 }}>matches siempre 100%</span>
          </div>

          <div className="ag-row" style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 950 }}>Entry (polla) por jugador:</div>
            <input
              type="number"
              defaultValue={entryFee}
              onBlur={(e) => changeEntryFee(e.target.value)}
              style={inputSmall}
            />
            {savingEntry ? <span style={{ opacity: 0.75 }}>Guardando…</span> : null}
            <span style={{ opacity: 0.75 }}>
              Pool: <b>${Math.round(prizes.pool)}</b> ({prizes.totalPlayers} jugadores)
            </span>
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={card}>
              <div style={{ fontWeight: 950, marginBottom: 6 }}>Premios Entry (50/30/20)</div>
              <div style={{ opacity: 0.9, display: "flex", gap: 14, flexWrap: "wrap" }}>
                <div>
                  🥇 STB 1º: <b>{prizes.winners.stableford1?.name || "-"}</b>{" "}
                  <span style={{ opacity: 0.75 }}>({fmtMoney(prizes.payoutsByPlayerKey[prizes.winners.stableford1?.playerKey] || 0)})</span>
                </div>
                <div>
                  🥈 STB 2º: <b>{prizes.winners.stableford2?.name || "-"}</b>{" "}
                  <span style={{ opacity: 0.75 }}>({fmtMoney(prizes.payoutsByPlayerKey[prizes.winners.stableford2?.playerKey] || 0)})</span>
                </div>
                <div>
                  🏆 Net 1º: <b>{prizes.winners.net1?.name || "-"}</b>{" "}
                  <span style={{ opacity: 0.75 }}>({fmtMoney(prizes.payoutsByPlayerKey[prizes.winners.net1?.playerKey] || 0)})</span>
                </div>
              </div>
              <div style={{ opacity: 0.65, marginTop: 8, fontSize: 12 }}>
                Net 1º excluye a los dos ganadores de Stableford.
              </div>
            </div>
          </div>
        </div>

        <button onClick={() => navigate("/")} style={btn}>← Home</button>
      </div>

      <hr style={hr} />

      {/* Leaderboards */}
      <section style={{ marginBottom: 18 }}>
        <h2 style={{ margin: "0 0 8px 0" }}>Leaderboard (General)</h2>

        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
          <div style={card}>
            <div style={cardTitle}>Stableford (mejor = mayor)</div>
            <div style={{ overflowX: "auto" }}>
              <table style={miniTable}>
                <thead>
                  <tr>
                    <th style={miniTh}>#</th>
                    <th style={miniThLeft}>Jugador</th>
                    <th style={miniTh}>HCP</th>
                    <th style={miniTh}>STB</th>
                    <th style={miniTh}>Grupo</th>
                  </tr>
                </thead>
                <tbody>
                  {stablefordRows.slice(0, 50).map((r, i) => (
                    <tr key={`${r.playerKey}-${i}`}>
                      <td style={miniTd}>{i + 1}</td>
                      <td style={miniTdLeft}>{r.name}</td>
                      <td style={miniTd}>{r.hcp}</td>
                      <td style={miniTd}><b>{r.stableford}</b></td>
                      <td style={miniTd}>{r.groupId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ opacity: 0.65, marginTop: 8, fontSize: 12 }}>
              Empate: gana el HCP menor (sube arriba).
            </div>
          </div>

          <div style={card}>
            <div style={cardTitle}>Net (mejor = menor)</div>
            <div style={{ overflowX: "auto" }}>
              <table style={miniTable}>
                <thead>
                  <tr>
                    <th style={miniTh}>#</th>
                    <th style={miniThLeft}>Jugador</th>
                    <th style={miniTh}>HCP</th>
                    <th style={miniTh}>Net</th>
                    <th style={miniTh}>Grupo</th>
                  </tr>
                </thead>
                <tbody>
                  {netRows.slice(0, 50).map((r, i) => (
                    <tr key={`${r.playerKey}-${i}`}>
                      <td style={miniTd}>{i + 1}</td>
                      <td style={miniTdLeft}>{r.name}</td>
                      <td style={miniTd}>{r.hcp}</td>
                      <td style={miniTd}><b>{r.net}</b></td>
                      <td style={miniTd}>{r.groupId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ opacity: 0.65, marginTop: 8, fontSize: 12 }}>
              Empate: gana el HCP menor (sube arriba).
            </div>
          </div>
        </div>
      </section>

      <hr style={hr} />

      {/* Groups */}
      <section>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
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
                group={g}
                courseId={courseId}
                state={groupsStateMap[g.id]}
                onOpen={() => navigate(`/session/${sessionId}/group/${g.id}`)}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function GroupCard({ group, courseId, state, onOpen }) {
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
      });
      matches.push(r);
    }
  }

  return (
    <div style={groupCard}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 950, fontSize: 18 }}>
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
        <div style={{ fontWeight: 950, marginBottom: 6 }}>Cruces (Match Play)</div>
        {matches.length === 0 ? (
          <div style={{ opacity: 0.7 }}>Aún no hay cruces (agrega jugadores).</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {matches.map((m, idx) => {
              const c = m.total > 0 ? "#86efac" : m.total < 0 ? "#fca5a5" : "#d4d4d4";
              return (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "10px 12px",
                    border: "1px solid #2a2a2a",
                    borderRadius: 14,
                    background: "#0c0c0c",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ fontWeight: 800, minWidth: 140 }}>{m.label}</div>
                  <div style={{ display: "flex", gap: 10, fontWeight: 950, color: c }}>
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
  padding: 16,
  fontFamily: "system-ui",
  maxWidth: 1100,
  margin: "0 auto",
  color: "white",
};

const topHeader = {
  display: "flex",
  gap: 12,
  alignItems: "flex-start",
  flexWrap: "wrap",
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
  minWidth: 220,
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
  minWidth: 520,
};

const miniTh = {
  textAlign: "center",
  padding: 8,
  borderBottom: "1px solid #2a2a2a",
  opacity: 0.85,
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
