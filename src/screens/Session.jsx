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

const COURSES = Object.entries(COURSE_DATA).map(([id, c]) => ({
  id,
  label: c.name || id,
}));

export default function Session() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState(null);
  const [settings, setSettings] = useState(null); // settings/main (entry fee + bolaRosaEnabled)
  const [groups, setGroups] = useState([]);
  const [groupsStateMap, setGroupsStateMap] = useState({}); // { [groupId]: stateMain }

  const [creatingGroup, setCreatingGroup] = useState(false);
  const [savingCourse, setSavingCourse] = useState(false);
  const [savingHistory, setSavingHistory] = useState(false);
  const [savingEntry, setSavingEntry] = useState(false);
  const [savingBolaRosa, setSavingBolaRosa] = useState(false);

  // Cross-group H2H
  const [h2hA, setH2hA] = useState("");
  const [h2hB, setH2hB] = useState("");

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
  const hcpPercent = session?.hcpPercent ?? 100;
  const entryFee = settings?.entryFee ?? 0;
  const bolaRosaEnabled = !!settings?.bolaRosaEnabled;

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
      await setDoc(
        ref,
        {
          entryFee: 0,
          bolaRosaEnabled: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
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

  const toggleBolaRosa = async (checked) => {
    if (!sessionId) return;
    setSavingBolaRosa(true);
    try {
      await ensureSettingsDoc();
      const ref = doc(db, "sessions", sessionId, "settings", "main");
      await updateDoc(ref, { bolaRosaEnabled: !!checked, updatedAt: serverTimestamp() });
    } catch (e) {
      console.error(e);
      alert(e?.message || "No se pudo actualizar Bola Rosa");
    } finally {
      setSavingBolaRosa(false);
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

  // ---------- History snapshot ----------
  const buildSnapshot = async () => {
    const sessionSnap = await getDoc(doc(db, "sessions", sessionId));
    const sessionData = sessionSnap.exists() ? sessionSnap.data() : {};

    const settingsSnap = await getDoc(doc(db, "sessions", sessionId, "settings", "main"));
    const settingsData = settingsSnap.exists() ? settingsSnap.data() : {};

    const groupsSnap = await getDocs(query(collection(db, "sessions", sessionId, "groups"), orderBy("order", "asc")));
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
          const r = computeMatchResultForPair({ a, b, scores: sc, courseId: snapshotCourseId });
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
        <button style={btn} onClick={() => navigate("/")}>
          Volver
        </button>
      </div>
    );
  }

  if (!session) return <div style={page}>Cargando sesión...</div>;

  // groupsFull from live map
  const groupsFull = groups.map((g) => ({
    id: g.id,
    name: g.name || g.id,
    order: g.order || 0,
    ...(groupsStateMap[g.id] || {}),
  }));

  const { stablefordRows, netRows } = computeLeaderboards({ groupsFull, courseId, hcpPercent });
  const prizes = computeEntryPrizes({ groupsFull, courseId, hcpPercent, entryFee });

  // Build list for cross-group H2H
  const allPlayers = [];
  for (const g of groupsFull) {
    const ps = g.players || [];
    for (const p of ps) {
      allPlayers.push({
        key: `${g.id}::${p.id}`,
        groupId: g.id,
        playerId: p.id,
        name: p.name || p.id,
        hcp: p.hcp || 0,
      });
    }
  }

  const pickA = allPlayers.find((x) => x.key === h2hA) || null;
  const pickB = allPlayers.find((x) => x.key === h2hB) || null;

  let h2hRes = null;
  if (pickA && pickB && pickA.key !== pickB.key) {
    const gA = groupsFull.find((g) => g.id === pickA.groupId);
    const gB = groupsFull.find((g) => g.id === pickB.groupId);
    const scoresA = gA?.scores?.[pickA.playerId] || Array(18).fill("");
    const scoresB = gB?.scores?.[pickB.playerId] || Array(18).fill("");

    // Avoid ID collision across groups (p1/p2 repeats)
    const a = { id: `A__${pickA.groupId}__${pickA.playerId}`, name: pickA.name, hcp: pickA.hcp };
    const b = { id: `B__${pickB.groupId}__${pickB.playerId}`, name: pickB.name, hcp: pickB.hcp };

    const scores = {
      [a.id]: scoresA,
      [b.id]: scoresB,
    };

    h2hRes = computeMatchResultForPair({ a, b, scores, courseId });
  }

  const courseLabel = (COURSES.find((c) => c.id === courseId)?.label) || courseId;

  return (
    <div style={page}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 950, letterSpacing: -0.5 }}>
            {session.name || "Sesión"}
          </h1>

          <div style={{ opacity: 0.85, marginTop: 6 }}>
            Status: <b>{session.status || "live"}</b> · Campo: <b>{courseLabel}</b>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <code style={pillCode}>{sessionId}</code>
            <button onClick={copySessionId} style={btn}>Copiar</button>
            <button onClick={saveHistory} disabled={savingHistory} style={btnPrimary}>
              {savingHistory ? "Guardando..." : "💾 Guardar Historial"}
            </button>
          </div>

          {/* Campo + %Hcp */}
          <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 900 }}>Campo:</div>
            <select value={courseId} onChange={(e) => changeCourse(e.target.value)} style={select} disabled={savingCourse}>
              {COURSES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            {savingCourse ? <span style={{ opacity: 0.75 }}>Guardando…</span> : null}

            <div style={{ width: 10 }} />

            <div style={{ fontWeight: 900 }}>% Handicap (Net/STB):</div>
            <input type="number" defaultValue={hcpPercent} onBlur={(e) => changeHcpPercent(e.target.value)} style={inputSmall} />
            <span style={{ opacity: 0.75 }}>matches siempre 100%</span>
          </div>

          {/* Entry Fee global */}
          <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 900 }}>Entry (polla) por jugador:</div>
            <input type="number" defaultValue={entryFee} onBlur={(e) => changeEntryFee(e.target.value)} style={inputSmall} />
            {savingEntry ? <span style={{ opacity: 0.75 }}>Guardando…</span> : null}
            <span style={{ opacity: 0.75 }}>
              Pool: <b>${Math.round(prizes.pool)}</b> ({prizes.totalPlayers} jugadores)
            </span>
          </div>

          {/* Bola Rosa toggle */}
          <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <label style={toggleRow}>
              <input
                type="checkbox"
                checked={bolaRosaEnabled}
                onChange={(e) => toggleBolaRosa(e.target.checked)}
              />
              <span style={{ fontWeight: 900 }}>Habilitar Bola Rosa</span>
            </label>
            {savingBolaRosa ? <span style={{ opacity: 0.75 }}>Guardando…</span> : null}
          </div>

          {/* Winners */}
          <div style={{ marginTop: 12 }}>
            <div style={card}>
              <div style={{ fontWeight: 950, marginBottom: 6 }}>Premios Entry (50/30/20)</div>
              <div style={{ opacity: 0.9, display: "flex", gap: 14, flexWrap: "wrap" }}>
                <div>
                  🥇 STB 1º: <b>{prizes.winners.stableford1?.name || "-"}</b>{" "}
                  <span style={{ opacity: 0.75 }}>
                    ({fmtMoney(prizes.payoutsByPlayerKey[prizes.winners.stableford1?.playerKey] || 0)})
                  </span>
                </div>
                <div>
                  🥈 STB 2º: <b>{prizes.winners.stableford2?.name || "-"}</b>{" "}
                  <span style={{ opacity: 0.75 }}>
                    ({fmtMoney(prizes.payoutsByPlayerKey[prizes.winners.stableford2?.playerKey] || 0)})
                  </span>
                </div>
                <div>
                  🏆 Net 1º: <b>{prizes.winners.net1?.name || "-"}</b>{" "}
                  <span style={{ opacity: 0.75 }}>
                    ({fmtMoney(prizes.payoutsByPlayerKey[prizes.winners.net1?.playerKey] || 0)})
                  </span>
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

      {/* Cross-group H2H */}
      <section style={{ marginBottom: 18 }}>
        <h2 style={{ margin: "0 0 8px 0" }}>Head-to-Head (cualquier jugador vs cualquier jugador)</h2>
        <div style={card}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ minWidth: 240, flex: 1 }}>
              <div style={miniLabel}>Player A</div>
              <select value={h2hA} onChange={(e) => setH2hA(e.target.value)} style={selectWide}>
                <option value="">— Selecciona —</option>
                {allPlayers.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name} · {p.groupId} · hcp {p.hcp}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ minWidth: 240, flex: 1 }}>
              <div style={miniLabel}>Player B</div>
              <select value={h2hB} onChange={(e) => setH2hB(e.target.value)} style={selectWide}>
                <option value="">— Selecciona —</option>
                {allPlayers.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name} · {p.groupId} · hcp {p.hcp}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            {!h2hRes ? (
              <div style={{ opacity: 0.75 }}>
                Elige dos jugadores (pueden ser de grupos diferentes) y te calculo F9/B9/Total.
              </div>
            ) : (
              <div style={h2hStrip}>
                <div style={{ fontWeight: 950, marginBottom: 8 }}>
                  {h2hRes.label} <span style={{ opacity: 0.7, fontWeight: 800 }}>· diff {h2hRes.diff}</span>
                </div>
                <div style={h2hGrid}>
                  <div style={h2hCell}>
                    <div style={h2hHead}>F9</div>
                    <div style={h2hVal(h2hRes.front)}>{fmtMatch(h2hRes.front)}</div>
                  </div>
                  <div style={h2hCell}>
                    <div style={h2hHead}>B9</div>
                    <div style={h2hVal(h2hRes.back)}>{fmtMatch(h2hRes.back)}</div>
                  </div>
                  <div style={h2hCell}>
                    <div style={h2hHead}>Total</div>
                    <div style={h2hVal(h2hRes.total)}>{fmtMatch(h2hRes.total)}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

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
              Empate: gana el HCP menor.
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
              Empate: gana el HCP menor.
            </div>
          </div>
        </div>
      </section>

      <hr style={hr} />

      {/* Groups (simple) */}
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

function GroupCard({ group, state, onOpen }) {
  const players = state?.players || [];
  return (
    <div style={groupCard}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 950, fontSize: 18 }}>
            {group.name || group.id}{" "}
            <span style={{ opacity: 0.7, fontWeight: 800 }}>(order {group.order})</span>
          </div>
          <div style={{ opacity: 0.8, marginTop: 6 }}>
            Jugadores: <b>{players.length}</b> / 6
          </div>
        </div>
        <button style={btnPrimary} onClick={onOpen}>Abrir Scorecard →</button>
      </div>
    </div>
  );
}

// ---------- styles ----------
const page = {
  minHeight: "100%",
  paddingTop: "calc(14px + env(safe-area-inset-top))",
  paddingBottom: "calc(14px + env(safe-area-inset-bottom))",
  paddingLeft: "calc(14px + env(safe-area-inset-left))",
  paddingRight: "calc(14px + env(safe-area-inset-right))",
  background: "#050505",
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
  minWidth: 220,
};

const selectWide = {
  ...select,
  width: "100%",
  minWidth: 0,
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

const toggleRow = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid #2a2a2a",
  background: "#0f0f0f",
};

const miniLabel = { fontSize: 12, fontWeight: 950, opacity: 0.7, marginBottom: 6 };

const h2hStrip = {
  padding: 12,
  borderRadius: 16,
  border: "1px solid #2a2a2a",
  background: "linear-gradient(180deg, #0d0d0d 0%, #0a0a0a 100%)",
};

const h2hGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 10,
  marginTop: 8,
};

const h2hCell = {
  borderRadius: 14,
  border: "1px solid #222",
  background: "#0b0b0b",
  padding: 10,
  textAlign: "center",
};

const h2hHead = { opacity: 0.7, fontWeight: 950, fontSize: 12 };
const h2hVal = (v) => ({
  marginTop: 6,
  fontWeight: 1000,
  fontSize: 26,
  letterSpacing: -0.4,
  color: v > 0 ? "#86efac" : v < 0 ? "#fca5a5" : "#e5e7eb",
});
