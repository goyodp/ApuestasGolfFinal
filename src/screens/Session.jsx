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
  const [settings, setSettings] = useState(null); // settings/main (entry fee + bola rosa enable)
  const [groups, setGroups] = useState([]);

  const [creatingGroup, setCreatingGroup] = useState(false);
  const [savingCourse, setSavingCourse] = useState(false);
  const [savingHistory, setSavingHistory] = useState(false);
  const [savingEntry, setSavingEntry] = useState(false);
  const [savingBola, setSavingBola] = useState(false);

  const [groupsStateMap, setGroupsStateMap] = useState({}); // { [groupId]: stateMain }

  // Cross-group head to head
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
  const course = COURSE_DATA[courseId] || COURSE_DATA["campestre-slp"];
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
        { entryFee: 0, bolaRosaEnabled: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
        { merge: true }
      );
    } else {
      // migration: ensure bolaRosaEnabled exists
      const data = snap.data() || {};
      if (!("bolaRosaEnabled" in data)) {
        await updateDoc(ref, { bolaRosaEnabled: false, updatedAt: serverTimestamp() });
      }
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
    setSavingBola(true);
    try {
      await ensureSettingsDoc();
      const ref = doc(db, "sessions", sessionId, "settings", "main");
      await updateDoc(ref, { bolaRosaEnabled: !!checked, updatedAt: serverTimestamp() });
    } catch (e) {
      console.error(e);
      alert(e?.message || "No se pudo actualizar Bola Rosa");
    } finally {
      setSavingBola(false);
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

  // Build flat players list across groups for H2H
  const allPlayers = useMemo(() => {
    const list = [];
    for (const g of groupsFull) {
      const ps = g.players || [];
      const sc = g.scores || {};
      for (const p of ps) {
        const playerKey = `${g.id}|${p.id}`;
        list.push({
          playerKey,
          groupId: g.id,
          playerId: p.id,
          name: p.name || p.id,
          hcp: Number(p.hcp || 0),
          scores: Array.isArray(sc[p.id]) ? sc[p.id] : Array(18).fill(""),
        });
      }
    }
    // sort by group then name
    return list.sort((a, b) => (a.groupId.localeCompare(b.groupId) || a.name.localeCompare(b.name)));
  }, [groupsFull]);

  const aObj = allPlayers.find((x) => x.playerKey === h2hA) || null;
  const bObj = allPlayers.find((x) => x.playerKey === h2hB) || null;

  const h2hResult = useMemo(() => {
    if (!aObj || !bObj) return null;
    if (aObj.playerKey === bObj.playerKey) return null;

    // computeMatchResultForPair expects a/b ids that exist in scores map
    const a = { id: "a", name: aObj.name, hcp: aObj.hcp };
    const b = { id: "b", name: bObj.name, hcp: bObj.hcp };
    const scores = { a: aObj.scores, b: bObj.scores };

    return computeMatchResultForPair({ a, b, scores, courseId });
  }, [aObj, bObj, courseId]);

  return (
    <div style={page}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 280 }}>
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

            <div style={{ fontWeight: 900 }}>% Handicap (Net/STB):</div>
            <input
              type="number"
              defaultValue={hcpPercent}
              onBlur={(e) => changeHcpPercent(e.target.value)}
              style={inputSmall}
            />
            <span style={{ opacity: 0.75 }}>matches siempre 100%</span>
          </div>

          {/* Entry Fee global */}
          <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 900 }}>Entry (polla) por jugador:</div>
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

          {/* Bola Rosa enable */}
          <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <label style={checkRow}>
              <input
                type="checkbox"
                checked={bolaRosaEnabled}
                onChange={(e) => toggleBolaRosa(e.target.checked)}
                disabled={savingBola}
              />
              <span style={{ fontWeight: 900 }}>Habilitar Bola Rosa (solo tracker)</span>
            </label>
            {savingBola ? <span style={{ opacity: 0.75 }}>Guardando…</span> : null}
          </div>

          {/* Winners */}
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            <div style={card}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Premios Entry (50/30/20)</div>
              <div style={{ opacity: 0.85, display: "flex", gap: 14, flexWrap: "wrap" }}>
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

          {/* Head to Head cross-group */}
          <div style={{ marginTop: 12 }}>
            <div style={card}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Head to Head (cualquier grupo)</div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <div style={miniLabel}>Jugador A</div>
                  <select value={h2hA} onChange={(e) => setH2hA(e.target.value)} style={selectWide}>
                    <option value="">— seleccionar —</option>
                    {allPlayers.map((p) => (
                      <option key={p.playerKey} value={p.playerKey}>
                        {p.name} · ({p.groupId}) · HCP {p.hcp}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div style={miniLabel}>Jugador B</div>
                  <select value={h2hB} onChange={(e) => setH2hB(e.target.value)} style={selectWide}>
                    <option value="">— seleccionar —</option>
                    {allPlayers.map((p) => (
                      <option key={p.playerKey} value={p.playerKey}>
                        {p.name} · ({p.groupId}) · HCP {p.hcp}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {!h2hResult ? (
                <div style={{ opacity: 0.7, marginTop: 10, fontSize: 12 }}>
                  Selecciona 2 jugadores (pueden ser de grupos distintos).
                </div>
              ) : (
                <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={pillH2H}>
                    <div style={pillH2HTitle}>{aObj?.name} vs {bObj?.name}</div>
                    <div style={{ opacity: 0.75, fontSize: 12, marginTop: 4 }}>
                      diff HCP: <b>{h2hResult.diff}</b> (match 100%)
                    </div>
                  </div>

                  <div style={strip}>
                    <div style={stripH}>F9</div>
                    <div style={stripH}>B9</div>
                    <div style={stripH}>Total</div>

                    <div style={stripV}>{fmtMatch(h2hResult.front)}</div>
                    <div style={stripV}>{fmtMatch(h2hResult.back)}</div>
                    <div style={stripV}>{fmtMatch(h2hResult.total)}</div>
                  </div>
                </div>
              )}
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
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid #2a2a2a",
  background: "#111",
  color: "white",
  fontWeight: 900,
  width: "100%",
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

const checkRow = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid #2a2a2a",
  background: "#0b0b0b",
};

const miniLabel = { fontSize: 12, opacity: 0.7, fontWeight: 900 };

const pillH2H = {
  padding: "12px 14px",
  borderRadius: 18,
  border: "1px solid #2a2a2a",
  background: "linear-gradient(180deg, #0b0b0b 0%, #070707 100%)",
  minWidth: 240,
};

const pillH2HTitle = { fontWeight: 950, fontSize: 14 };

const strip = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  border: "1px solid #2a2a2a",
  borderRadius: 18,
  overflow: "hidden",
  minWidth: 260,
};

const stripH = {
  padding: "10px 10px",
  textAlign: "center",
  fontWeight: 950,
  background: "#0b0b0b",
  borderBottom: "1px solid #1f1f1f",
};

const stripV = {
  padding: "14px 10px",
  textAlign: "center",
  fontWeight: 1000,
  fontSize: 22,
  background: "#070707",
};
