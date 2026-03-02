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
  computeEntryPrizes,
} from "../lib/compute";

const COURSES = [
  { id: "campestre-slp", label: "Campestre de San Luis" },
  { id: "la-loma", label: "La Loma Golf" },
];

const DEFAULT_SETTINGS = {
  courseId: "campestre-slp",
  hcpPercent: 100,
  entryFee: 0,
};

export default function Session() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState(null);
  const [settings, setSettings] = useState(null);
  const [groups, setGroups] = useState([]);

  const [creatingGroup, setCreatingGroup] = useState(false);
  const [savingCourse, setSavingCourse] = useState(false);
  const [savingHcp, setSavingHcp] = useState(false);
  const [savingEntry, setSavingEntry] = useState(false);
  const [savingHistory, setSavingHistory] = useState(false);

  // Live computed state
  const [groupsStateMap, setGroupsStateMap] = useState({}); // { [groupId]: stateMain }

  const sessionRef = useMemo(() => {
    if (!sessionId) return null;
    return doc(db, "sessions", sessionId);
  }, [sessionId]);

  const settingsRef = useMemo(() => {
    if (!sessionId) return null;
    return doc(db, "sessions", sessionId, "settings", "main");
  }, [sessionId]);

  // ---- session doc ----
  useEffect(() => {
    if (!sessionRef) return;
    return onSnapshot(sessionRef, (snap) => {
      setSession(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
  }, [sessionRef]);

  // ---- settings/main (global) ----
  useEffect(() => {
    if (!settingsRef) return;
    return onSnapshot(settingsRef, (snap) => {
      if (snap.exists()) setSettings({ ...DEFAULT_SETTINGS, ...snap.data() });
      else setSettings(null);
    });
  }, [settingsRef]);

  // Auto-init settings/main if missing
  useEffect(() => {
    if (!settingsRef) return;
    (async () => {
      try {
        const s = await getDoc(settingsRef);
        if (!s.exists()) {
          await setDoc(settingsRef, {
            ...DEFAULT_SETTINGS,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (e) {
        console.error("settings init failed", e);
      }
    })();
  }, [settingsRef]);

  // ---- groups meta ----
  useEffect(() => {
    if (!sessionId) return;
    const groupsRef = collection(db, "sessions", sessionId, "groups");
    const q = query(groupsRef, orderBy("order", "asc"));
    return onSnapshot(q, (snap) => {
      setGroups(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, [sessionId]);

  // ---- subscribe each group state/main (for leaderboard + player count) ----
  useEffect(() => {
    if (!sessionId) return;

    const unsubs = [];
    const groupIds = new Set(groups.map((g) => g.id));

    // prune stale
    setGroupsStateMap((prev) => {
      const next = {};
      Object.keys(prev).forEach((gid) => {
        if (groupIds.has(gid)) next[gid] = prev[gid];
      });
      return next;
    });

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

  const effectiveSettings = settings || DEFAULT_SETTINGS;

  const courseId = effectiveSettings.courseId || "campestre-slp";
  const hcpPercent = Number.isFinite(effectiveSettings.hcpPercent)
    ? effectiveSettings.hcpPercent
    : 100;
  const entryFee = Number.isFinite(effectiveSettings.entryFee)
    ? effectiveSettings.entryFee
    : 0;

  const course = COURSE_DATA[courseId] || COURSE_DATA["campestre-slp"];
  const courseLabel = COURSES.find((c) => c.id === courseId)?.label || courseId;

  const totalPlayers = useMemo(() => {
    let n = 0;
    for (const g of groups) {
      const st = groupsStateMap[g.id];
      n += (st?.players?.length || 0);
    }
    return n;
  }, [groups, groupsStateMap]);

  const copySessionId = async () => {
    try {
      await navigator.clipboard.writeText(sessionId);
      alert("Session ID copiado ✅");
    } catch {
      alert("No pude copiar. Cópialo manual: " + sessionId);
    }
  };

  const changeCourse = async (newCourseId) => {
    if (!settingsRef) return;
    setSavingCourse(true);
    try {
      await updateDoc(settingsRef, { courseId: newCourseId, updatedAt: serverTimestamp() });
      await updateDoc(doc(db, "sessions", sessionId), { updatedAt: serverTimestamp() });
    } catch (e) {
      console.error(e);
      alert(e?.message || "No se pudo actualizar el campo");
    } finally {
      setSavingCourse(false);
    }
  };

  const changeHcpPercent = async (value) => {
    if (!settingsRef) return;
    setSavingHcp(true);
    const v = Math.max(0, Math.min(100, parseInt(value || "0", 10)));
    try {
      await updateDoc(settingsRef, { hcpPercent: v, updatedAt: serverTimestamp() });
      await updateDoc(doc(db, "sessions", sessionId), { updatedAt: serverTimestamp() });
    } catch (e) {
      console.error(e);
      alert(e?.message || "No se pudo actualizar handicap %");
    } finally {
      setSavingHcp(false);
    }
  };

  const changeEntryFee = async (value) => {
    if (!settingsRef) return;
    setSavingEntry(true);
    const v = Math.max(0, parseInt(value || "0", 10));
    try {
      await updateDoc(settingsRef, { entryFee: v, updatedAt: serverTimestamp() });
      await updateDoc(doc(db, "sessions", sessionId), { updatedAt: serverTimestamp() });
    } catch (e) {
      console.error(e);
      alert(e?.message || "No se pudo actualizar entry");
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
    const settingsDataRaw = settingsSnap.exists() ? settingsSnap.data() : {};
    const settingsData = { ...DEFAULT_SETTINGS, ...settingsDataRaw };

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

    const snapshotCourseId = settingsData.courseId || "campestre-slp";
    const snapshotHcpPercent = settingsData.hcpPercent ?? 100;

    const { stablefordRows, netRows } = computeLeaderboards({
      groupsFull,
      courseId: snapshotCourseId,
      hcpPercent: snapshotHcpPercent,
    });

    const totalPlayersSnap = groupsFull.reduce((acc, g) => acc + (g.players?.length || 0), 0);
    const prizes = computeEntryPrizes({
      stablefordRows,
      netRows,
      entryFee: settingsData.entryFee ?? 0,
      totalPlayers: totalPlayersSnap,
    });

    return {
      session: {
        name: sessionData?.name || "",
        status: sessionData?.status || "",
      },
      settings: settingsData,
      groups: groupsFull,
      computed: {
        leaderboardStableford: stablefordRows,
        leaderboardNet: netRows,
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

  if (!session || !settings) return <div style={page}>Cargando sesión...</div>;

  // Build groupsFull for compute
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
    stablefordRows,
    netRows,
    entryFee,
    totalPlayers,
  });

  return (
    <div style={page}>
      <div style={stickyHeader}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, lineHeight: 1.1 }}>
              {session.name || "Sesión"}
            </h1>

            <div style={{ opacity: 0.85, marginTop: 6, fontSize: 13 }}>
              Status: <b>{session.status || "live"}</b> · Campo: <b>{courseLabel}</b> · %Hcp: <b>{hcpPercent}</b>
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <code style={pillCode}>{sessionId}</code>
              <button onClick={copySessionId} style={btn}>Copiar</button>
              <button onClick={saveHistory} disabled={savingHistory} style={btnPrimary}>
                {savingHistory ? "Guardando..." : "💾 Historial"}
              </button>
            </div>
          </div>

          <button onClick={() => navigate("/")} style={btn}>← Home</button>
        </div>

        {/* Global day settings */}
        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
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

          <div style={{ width: 6 }} />

          <div style={{ fontWeight: 900 }}>% Handicap:</div>
          <input
            type="number"
            value={hcpPercent}
            onChange={(e) => changeHcpPercent(e.target.value)}
            onBlur={(e) => changeHcpPercent(e.target.value)}
            style={inputSmall}
            inputMode="numeric"
          />
          {savingHcp ? <span style={{ opacity: 0.75 }}>Guardando…</span> : <span style={{ opacity: 0.75 }}>strokes</span>}

          <div style={{ width: 6 }} />

          <div style={{ fontWeight: 900 }}>Entry (global):</div>
          <input
            type="number"
            value={entryFee}
            onChange={(e) => changeEntryFee(e.target.value)}
            onBlur={(e) => changeEntryFee(e.target.value)}
            style={inputSmall}
            inputMode="numeric"
          />
          {savingEntry ? <span style={{ opacity: 0.75 }}>Guardando…</span> : <span style={{ opacity: 0.75 }}>/ jugador</span>}
        </div>
      </div>

      <hr style={hr} />

      {/* Prize pool summary */}
      <section style={{ marginBottom: 18 }}>
        <h2 style={{ margin: "0 0 8px 0" }}>Entry Pool (Global)</h2>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={statPill}>
            <div style={statLabel}>Jugadores</div>
            <div style={statValue}>{totalPlayers}</div>
          </div>

          <div style={statPill}>
            <div style={statLabel}>Entry / jugador</div>
            <div style={statValue}>${entryFee}</div>
          </div>

          <div style={statPill}>
            <div style={statLabel}>Prize Pool</div>
            <div style={statValue}>${prizes.pool}</div>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          {prizes.awards.map((a, idx) => (
            <div key={idx} style={awardRow}>
              <div style={{ fontWeight: 950 }}>{a.label}</div>
              <div style={{ opacity: 0.9 }}>
                <b>{a.name || "-"}</b> · {a.meta}
              </div>
              <div style={{ fontWeight: 950 }}>${a.amount}</div>
            </div>
          ))}
          <div style={{ opacity: 0.65, fontSize: 12 }}>
            Reglas: 50% 1º Stableford · 30% 2º Stableford · 20% 1º Net (excluye ganadores previos).
          </div>
        </div>
      </section>

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
                  {stablefordRows.slice(0, 30).map((r, i) => (
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
                  {netRows.slice(0, 30).map((r, i) => (
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
                group={g}
                state={groupsStateMap[g.id]}
                onOpen={() => navigate(`/session/${sessionId}/group/${g.id}`)}
              />
            ))
          )}
        </div>

        <div style={{ opacity: 0.65, fontSize: 12, marginTop: 10 }}>
          Nota: Birdies/Eagles/Albatross/Greenies y apuestas de matches son <b>por grupo</b>.
        </div>
      </section>
    </div>
  );
}

function GroupCard({ group, state, onOpen }) {
  const players = state?.players || [];
  const greenieLabel = state?.groupSettings?.greenieLabel || state?.greenieLabel || "Greenie";

  return (
    <div style={groupCard}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: 18 }}>
            {group.name || group.id}{" "}
            <span style={{ opacity: 0.7, fontWeight: 700 }}>(order {group.order})</span>
          </div>
          <div style={{ opacity: 0.75, marginTop: 6 }}>
            Jugadores: <b>{players.length}</b> / 6 · {greenieLabel}:{" "}
            <b>{Object.keys(state?.greenies || {}).length}</b>
          </div>
        </div>
        <button style={btnPrimary} onClick={onOpen}>Abrir Scorecard →</button>
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

const stickyHeader = {
  position: "sticky",
  top: 0,
  zIndex: 20,
  background: "#0b0b0b",
  paddingBottom: 10,
  borderBottom: "1px solid #1f1f1f",
};

const hr = { margin: "18px 0", borderColor: "#2a2a2a" };

const pillCode = {
  padding: "8px 12px",
  borderRadius: 14,
  background: "#0f0f0f",
  border: "1px solid #2a2a2a",
  color: "white",
  fontWeight: 900,
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
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
  width: 110,
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
  whiteSpace: "nowrap",
};

const miniThLeft = { ...miniTh, textAlign: "left" };

const miniTd = {
  textAlign: "center",
  padding: 8,
  borderBottom: "1px solid #1f1f1f",
  whiteSpace: "nowrap",
};

const miniTdLeft = { ...miniTd, textAlign: "left", whiteSpace: "nowrap" };

const groupCard = {
  border: "1px solid #2a2a2a",
  borderRadius: 18,
  padding: 14,
  background: "#0f0f0f",
};

const statPill = {
  padding: "10px 12px",
  borderRadius: 16,
  border: "1px solid #242424",
  background: "#0f0f0f",
  minWidth: 150,
};

const statLabel = { opacity: 0.75, fontSize: 12, fontWeight: 900 };
const statValue = { fontWeight: 950, fontSize: 16 };

const awardRow = {
  display: "grid",
  gridTemplateColumns: "1.1fr 2fr 0.7fr",
  gap: 10,
  alignItems: "center",
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid #222",
  background: "#0f0f0f",
};
