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

/* ---------------- Input restrictions ---------------- */

function clampInt(n, min, max) {
  const x = parseInt(String(n ?? "").trim() || "0", 10);
  if (Number.isNaN(x)) return min;
  return Math.max(min, Math.min(max, x));
}
function clampMoney(n, min, max) {
  const x = parseInt(String(n ?? "").trim() || "0", 10);
  if (Number.isNaN(x)) return min;
  return Math.max(min, Math.min(max, x));
}
function sanitizeSignedIntText(raw, { maxAbs = 99 } = {}) {
  // allows: "", "-", "-12", "12"
  const s = String(raw ?? "").trim();
  if (s === "") return "";
  if (s === "-") return "-";
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const ok = (ch >= "0" && ch <= "9") || (ch === "-" && i === 0);
    if (ok) out += ch;
  }
  if (out === "-" || out === "") return out;

  const neg = out[0] === "-";
  const digits = out.replace("-", "");
  const num = parseInt(digits || "0", 10);
  const clamped = Math.max(0, Math.min(maxAbs, num));
  return (neg ? "-" : "") + String(clamped);
}

function toast(msg) {
  const el = document.createElement("div");
  el.textContent = msg;
  Object.assign(el.style, {
    position: "fixed",
    left: "50%",
    bottom: "calc(18px + env(safe-area-inset-bottom))",
    transform: "translateX(-50%)",
    background: "rgba(15,23,42,0.92)",
    color: "white",
    padding: "10px 12px",
    borderRadius: "14px",
    border: "1px solid rgba(148,163,184,0.18)",
    fontWeight: 900,
    zIndex: 9999,
    maxWidth: "90vw",
    textAlign: "center",
    boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

function countFilledScores(scoresObj) {
  if (!scoresObj) return 0;
  let n = 0;
  for (const k of Object.keys(scoresObj)) {
    const arr = Array.isArray(scoresObj[k]) ? scoresObj[k] : [];
    for (const v of arr) if (String(v || "").trim() !== "") n++;
  }
  return n;
}

export default function Session() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState(null);
  const [settings, setSettings] = useState(null); // settings/main (entryFee + bolaRosaEnabled)
  const [groups, setGroups] = useState([]);
  const [groupsStateMap, setGroupsStateMap] = useState({}); // { [groupId]: stateMain }

  const [creatingGroup, setCreatingGroup] = useState(false);
  const [savingCourse, setSavingCourse] = useState(false);
  const [savingHistory, setSavingHistory] = useState(false);
  const [savingEntry, setSavingEntry] = useState(false);
  const [savingBolaRosa, setSavingBolaRosa] = useState(false);

  // UI collapsables
  const [openSession, setOpenSession] = useState(true);
  const [openH2H, setOpenH2H] = useState(false);
  const [openLeaderboards, setOpenLeaderboards] = useState(true);
  const [openGroups, setOpenGroups] = useState(true);

  // Inputs as controlled (prevents weird mobile number behaviors)
  const [hcpText, setHcpText] = useState("100");
  const [entryText, setEntryText] = useState("0");

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

  // keep input texts in sync with live data
  useEffect(() => setHcpText(String(hcpPercent)), [hcpPercent]);
  useEffect(() => setEntryText(String(entryFee)), [entryFee]);

  const courseLabel = COURSES.find((c) => c.id === courseId)?.label || courseId;

  const copySessionId = async () => {
    try {
      await navigator.clipboard.writeText(sessionId);
      toast("Session ID copiado ✅");
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
      toast("Campo actualizado ✅");
    } catch (e) {
      console.error(e);
      alert(e?.message || "No se pudo actualizar el campo");
    } finally {
      setSavingCourse(false);
    }
  };

  const commitHcpPercent = async () => {
    if (!sessionRef) return;
    // only 0..100 allowed
    const v = clampInt(hcpText, 0, 100);
    try {
      await updateDoc(sessionRef, { hcpPercent: v, updatedAt: serverTimestamp() });
      toast("%Hcp actualizado ✅");
    } catch (e) {
      console.error(e);
      alert(e?.message || "No se pudo actualizar handicap %");
    }
  };

  const commitEntryFee = async () => {
    if (!sessionId) return;
    setSavingEntry(true);
    try {
      await ensureSettingsDoc();
      const ref = doc(db, "sessions", sessionId, "settings", "main");
      const v = clampMoney(entryText, 0, 999999);
      await updateDoc(ref, { entryFee: v, updatedAt: serverTimestamp() });
      toast("Entry actualizado ✅");
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
      toast(`Bola Rosa ${checked ? "On" : "Off"} ✅`);
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
      toast("Grupo creado ✅");
      navigate(`/session/${sessionId}/group/${groupDocId}`);
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
      toast("Historial guardado ✅");
    } catch (e) {
      console.error(e);
      alert(e?.message || "No pude guardar historial");
    } finally {
      setSavingHistory(false);
    }
  };

  // ---------- Guards ----------
  if (!sessionId) {
    return (
      <div style={page}>
        <div style={fallbackCard}>
          <div style={{ fontWeight: 1000, fontSize: 18 }}>Falta Session ID</div>
          <button style={btn} onClick={() => navigate("/")}>
            Volver
          </button>
        </div>
      </div>
    );
  }

  if (!session) return <div style={page}><div style={loadingCard}>Cargando sesión…</div></div>;

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
  // stable list (prevents mobile select weirdness)
  allPlayers.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

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

    const scores = { [a.id]: scoresA, [b.id]: scoresB };
    h2hRes = computeMatchResultForPair({ a, b, scores, courseId });
  }

  const subtitle = `${courseLabel} · %Hcp ${hcpPercent} · ${groups.length} grupos · Pool ${fmtMoney(prizes.pool)}`;

  return (
    <div style={page}>
      <style>{baseCss}</style>

      {/* App Bar */}
      <div style={appBar}>
        <button onClick={() => navigate("/")} style={iconBtn} aria-label="Home">
          ←
        </button>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={barTitle}>{session.name || "Sesión"}</div>
          <div style={barSub}>{subtitle}</div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={copySessionId} style={chipBtn}>
            Copiar ID
          </button>
          <button onClick={saveHistory} disabled={savingHistory} style={chipBtnPrimary}>
            {savingHistory ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>

      <div style={content}>
        {/* Session Settings */}
        <Collapsible
          title="Configuración"
          subtitle={`Entry ${fmtMoney(entryFee)} · Bola Rosa ${bolaRosaEnabled ? "On" : "Off"}`}
          open={openSession}
          setOpen={setOpenSession}
        >
          <div style={grid2}>
            <div style={field}>
              <div style={label}>Session ID</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <code style={codePillRow}>{sessionId}</code>
                <button onClick={copySessionId} style={smallBtn}>
                  Copiar
                </button>
              </div>
            </div>

            <div style={field}>
              <div style={label}>Campo</div>
              <select value={courseId} onChange={(e) => changeCourse(e.target.value)} style={selectDark} disabled={savingCourse}>
                {COURSES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              {savingCourse ? <div style={hint}>Guardando…</div> : null}
            </div>

            <div style={field}>
              <div style={label}>% Handicap (Net/STB)</div>
              <input
                value={hcpText}
                onChange={(e) => setHcpText(sanitizeSignedIntText(e.target.value, { maxAbs: 100 }))} // 0..100 only effectively
                onBlur={commitHcpPercent}
                style={inputDark}
                inputMode="numeric"
              />
              <div style={hint}>Rango 0–100. Matches siempre 100%.</div>
            </div>

            <div style={field}>
              <div style={label}>Entry fee (por jugador)</div>
              <input
                value={entryText}
                onChange={(e) => setEntryText(sanitizeSignedIntText(e.target.value, { maxAbs: 999999 }))}
                onBlur={commitEntryFee}
                style={inputDark}
                inputMode="numeric"
              />
              {savingEntry ? <div style={hint}>Guardando…</div> : null}
            </div>

            <div style={{ ...field, gridColumn: "1 / -1" }}>
              <div style={label}>Pool & Premios</div>

              {/* Not cut on mobile: wrap + scroll-safe */}
              <div style={poolCard}>
                <div style={poolLeft}>
                  <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 900 }}>Pool</div>
                  <div style={{ fontSize: 24, fontWeight: 1000, color: "white", marginTop: 4 }}>
                    {fmtMoney(prizes.pool)}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
                    {prizes.totalPlayers} jugadores
                  </div>
                </div>

                <div style={poolRight}>
                  <WinnerLine
                    emoji="🥇"
                    label="STB 1º"
                    name={prizes.winners.stableford1?.name}
                    money={prizes.payoutsByPlayerKey[prizes.winners.stableford1?.playerKey] || 0}
                  />
                  <WinnerLine
                    emoji="🥈"
                    label="STB 2º"
                    name={prizes.winners.stableford2?.name}
                    money={prizes.payoutsByPlayerKey[prizes.winners.stableford2?.playerKey] || 0}
                  />
                  <WinnerLine
                    emoji="🏆"
                    label="Net 1º"
                    name={prizes.winners.net1?.name}
                    money={prizes.payoutsByPlayerKey[prizes.winners.net1?.playerKey] || 0}
                  />
                  <div style={{ opacity: 0.7, fontSize: 12, marginTop: 8 }}>
                    Net 1º excluye a los dos ganadores de Stableford.
                  </div>
                </div>
              </div>
            </div>

            <div style={{ ...field, gridColumn: "1 / -1" }}>
              <label style={togglePill}>
                <input type="checkbox" checked={bolaRosaEnabled} onChange={(e) => toggleBolaRosa(e.target.checked)} />
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontWeight: 950, color: "white" }}>Habilitar Bola Rosa</span>
                  <span style={{ fontSize: 12, opacity: 0.75 }}>Activa selección de ganador en cada grupo.</span>
                </div>
              </label>
              {savingBolaRosa ? <div style={hint}>Guardando…</div> : null}
            </div>
          </div>
        </Collapsible>

        {/* Leaderboards */}
        <Collapsible
          title="Leaderboards"
          subtitle="Stableford y Net (General)"
          open={openLeaderboards}
          setOpen={setOpenLeaderboards}
        >
          <div style={{ display: "grid", gap: 12 }}>
            <LeaderboardCard
              title="Stableford"
              rows={stablefordRows}
              mode="stb"
              prizes={prizes}
            />
            <LeaderboardCard
              title="Net"
              rows={netRows}
              mode="net"
              prizes={prizes}
            />
          </div>
        </Collapsible>

        {/* H2H */}
        <Collapsible
          title="Head-to-Head (cross-group)"
          subtitle="Cualquier jugador vs cualquier jugador · F9/B9/Total"
          open={openH2H}
          setOpen={setOpenH2H}
        >
          <div style={cardDark}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={label}>Player A</div>
                <select value={h2hA} onChange={(e) => setH2hA(e.target.value)} style={selectDark}>
                  <option value="">— Selecciona —</option>
                  {allPlayers.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name} · {p.groupId} · hcp {p.hcp}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div style={label}>Player B</div>
                <select value={h2hB} onChange={(e) => setH2hB(e.target.value)} style={selectDark}>
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
                <div style={{ opacity: 0.75 }}>Elige dos jugadores y te calculo F9/B9/Total.</div>
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
        </Collapsible>

        {/* Groups */}
        <Collapsible
          title="Groups"
          subtitle={`${groups.length} grupos · tap para abrir scorecard`}
          open={openGroups}
          setOpen={setOpenGroups}
          right={
            <button onClick={addGroup} disabled={creatingGroup} style={smallPrimaryBtn}>
              {creatingGroup ? "Creando…" : "+ Grupo"}
            </button>
          }
        >
          <div style={{ display: "grid", gap: 12 }}>
            {groups.length === 0 ? (
              <div style={{ opacity: 0.78 }}>No hay grupos todavía.</div>
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
        </Collapsible>

        <div style={{ height: 16 }} />
      </div>
    </div>
  );
}

/* ---------------- UI components ---------------- */

function Collapsible({ title, subtitle, open, setOpen, right, children }) {
  return (
    <section style={section}>
      <button onClick={() => setOpen(!open)} style={collapsibleHead}>
        <div style={{ minWidth: 0 }}>
          <div style={sectionTitle}>{title}</div>
          {subtitle ? <div style={subText2}>{subtitle}</div> : null}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {right ? <div onClick={(e) => e.stopPropagation()}>{right}</div> : null}
          <div style={chev}>{open ? "▾" : "▸"}</div>
        </div>
      </button>
      {open ? <div style={collapsibleBody}>{children}</div> : null}
    </section>
  );
}

function GroupCard({ group, state, onOpen }) {
  const players = state?.players || [];
  const filled = countFilledScores(state?.scores);

  const pct = (() => {
    const totalSlots = players.length * 18;
    if (!totalSlots) return 0;
    return Math.round((filled / totalSlots) * 100);
  })();

  return (
    <button style={groupCardBtn} onClick={onOpen}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 1000, fontSize: 16, color: "white" }}>
            {group.name || group.id}
          </div>
          <div style={{ marginTop: 6, opacity: 0.78, fontSize: 12 }}>
            {players.length}/6 jugadores · {filled} scores · {pct}% completo
          </div>
          <div style={progressTrack}>
            <div style={{ ...progressFill, width: `${pct}%` }} />
          </div>
        </div>
        <div style={openPill}>Abrir</div>
      </div>
    </button>
  );
}

function LeaderboardCard({ title, rows, mode, prizes }) {
  const topKey =
    mode === "stb"
      ? prizes.winners.stableford1?.playerKey
      : prizes.winners.net1?.playerKey;

  const secondKey = mode === "stb" ? prizes.winners.stableford2?.playerKey : null;

  return (
    <div style={cardDark}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <div style={cardTitle}>{title}</div>
        <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 900 }}>
          {rows?.length || 0} jugadores
        </div>
      </div>

      {/* Fix “cut” on mobile: horizontal scroll + sticky name col */}
      <div style={tableWrap}>
        <table style={lbTable}>
          <thead>
            <tr>
              <th style={lbThRank}>#</th>
              <th style={lbThName}>Jugador</th>
              <th style={lbTh}>HCP</th>
              <th style={lbTh}>{mode === "stb" ? "STB" : "NET"}</th>
              <th style={lbTh}>Grupo</th>
              <th style={lbTh}>Premio</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).slice(0, 60).map((r, i) => {
              const prize = prizes.payoutsByPlayerKey?.[r.playerKey] || 0;
              const isFirst = r.playerKey && r.playerKey === topKey;
              const isSecond = r.playerKey && r.playerKey === secondKey;
              const badge = isFirst ? "🥇" : isSecond ? "🥈" : "";
              return (
                <tr key={`${r.playerKey}-${i}`}>
                  <td style={lbTdRank}>{i + 1}</td>
                  <td style={lbTdName}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                      {badge ? <span style={{ width: 20 }}>{badge}</span> : <span style={{ width: 20 }} />}
                      <span style={lbNameText}>{r.name}</span>
                    </div>
                  </td>
                  <td style={lbTd}>{r.hcp}</td>
                  <td style={lbTdStrong}>{mode === "stb" ? r.stableford : r.net}</td>
                  <td style={lbTd}>{r.groupId}</td>
                  <td style={lbTdPrize}>{prize ? fmtMoney(prize) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.72 }}>
        Empates: gana el HCP menor.
      </div>
    </div>
  );
}

function WinnerLine({ emoji, label, name, money }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
      <div style={{ width: 22 }}>{emoji}</div>
      <div style={{ fontWeight: 900, opacity: 0.9 }}>{label}:</div>
      <div style={{ fontWeight: 950, color: "white" }}>{name || "-"}</div>
      <div style={{ opacity: 0.75 }}>{fmtMoney(money)}</div>
    </div>
  );
}

/* ---------------- Styles (premium dark, mobile-first) ---------------- */

const baseCss = `
  * { box-sizing: border-box; }
  input, button, select { font: inherit; }
  button { -webkit-tap-highlight-color: transparent; }
  input:focus, select:focus { outline: none; }
  table { border-spacing: 0; }
`;

const page = {
  minHeight: "100%",
  background:
    "radial-gradient(1200px 700px at 10% 0%, rgba(59,130,246,0.10) 0%, rgba(0,0,0,0) 45%), #05070b",
  color: "#e5e7eb",
  paddingTop: "env(safe-area-inset-top)",
  paddingBottom: "env(safe-area-inset-bottom)",
  paddingLeft: "env(safe-area-inset-left)",
  paddingRight: "env(safe-area-inset-right)",
};

const content = { padding: 12, maxWidth: 1100, margin: "0 auto" };

const appBar = {
  position: "sticky",
  top: 0,
  zIndex: 50,
  padding: "10px 12px",
  display: "flex",
  alignItems: "center",
  gap: 10,
  justifyContent: "space-between",
  backdropFilter: "blur(14px)",
  background: "rgba(5,7,11,0.70)",
  borderBottom: "1px solid rgba(148,163,184,0.14)",
};

const iconBtn = {
  width: 40,
  height: 40,
  borderRadius: 14,
  border: "1px solid rgba(148,163,184,0.18)",
  background: "rgba(15,23,42,0.55)",
  color: "white",
  fontWeight: 1000,
};

const barTitle = {
  fontSize: 16,
  fontWeight: 1000,
  letterSpacing: -0.4,
  color: "white",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: 240,
};

const barSub = {
  fontSize: 12,
  opacity: 0.75,
  marginTop: 2,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: 420,
};

const chipBtn = {
  height: 40,
  padding: "0 12px",
  borderRadius: 999,
  border: "1px solid rgba(148,163,184,0.18)",
  background: "rgba(15,23,42,0.55)",
  color: "white",
  fontWeight: 950,
};

const chipBtnPrimary = {
  ...chipBtn,
  border: "1px solid rgba(59,130,246,0.35)",
  background: "rgba(59,130,246,0.18)",
  color: "#dbeafe",
};

const section = {
  borderRadius: 18,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "linear-gradient(180deg, rgba(15,23,42,0.55) 0%, rgba(2,6,23,0.35) 100%)",
  boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
  overflow: "hidden",
  marginTop: 12,
};

const collapsibleHead = {
  width: "100%",
  padding: "12px 12px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  background: "transparent",
  color: "#e5e7eb",
  border: "none",
  textAlign: "left",
};

const collapsibleBody = { padding: 12, paddingTop: 0 };

const sectionTitle = { fontSize: 14, fontWeight: 1000, letterSpacing: -0.2, color: "white" };
const subText2 = { marginTop: 2, fontSize: 12, opacity: 0.72 };
const chev = { fontSize: 18, opacity: 0.8, fontWeight: 900 };

const grid2 = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: 12,
};

const field = { display: "flex", flexDirection: "column", gap: 8 };

const label = { fontWeight: 950, color: "white" };
const hint = { fontSize: 12, opacity: 0.75 };

const selectDark = {
  padding: "12px 12px",
  borderRadius: 14,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(15,23,42,0.55)",
  color: "white",
  fontWeight: 950,
  width: "100%",
};

const inputDark = {
  padding: "12px 12px",
  borderRadius: 14,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(15,23,42,0.55)",
  color: "white",
  fontWeight: 950,
  width: 160,
};

const codePillRow = {
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(2,6,23,0.35)",
  color: "white",
  fontWeight: 900,
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const smallBtn = {
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(15,23,42,0.55)",
  color: "white",
  fontWeight: 950,
};

const smallPrimaryBtn = {
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid rgba(59,130,246,0.35)",
  background: "rgba(59,130,246,0.18)",
  color: "#dbeafe",
  fontWeight: 950,
};

const cardDark = {
  borderRadius: 16,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(2,6,23,0.35)",
  padding: 12,
};

const cardTitle = { fontWeight: 950, marginBottom: 10, fontSize: 14, color: "white" };

const poolCard = {
  display: "grid",
  gridTemplateColumns: "minmax(160px, 240px) 1fr",
  gap: 12,
  borderRadius: 16,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(15,23,42,0.35)",
  padding: 12,
};

const poolLeft = {
  borderRadius: 16,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(2,6,23,0.35)",
  padding: 12,
  minWidth: 0,
};

const poolRight = {
  minWidth: 0,
};

const togglePill = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  padding: "12px 12px",
  borderRadius: 16,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(15,23,42,0.45)",
  userSelect: "none",
};

const tableWrap = { overflowX: "auto", WebkitOverflowScrolling: "touch" };

/* Leaderboard table: sticky name col + not cut */
const lbTable = {
  width: "100%",
  minWidth: 720,
  borderCollapse: "separate",
  borderSpacing: 0,
};

const lbThBase = {
  padding: 10,
  fontSize: 12,
  fontWeight: 950,
  opacity: 0.85,
  borderBottom: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(2,6,23,0.35)",
  whiteSpace: "nowrap",
  textAlign: "center",
};

const lbThRank = { ...lbThBase, width: 52 };
const lbTh = { ...lbThBase };

const lbThName = {
  ...lbThBase,
  position: "sticky",
  left: 0,
  zIndex: 2,
  textAlign: "left",
  minWidth: 240,
  background: "rgba(2,6,23,0.72)",
  backdropFilter: "blur(10px)",
};

const lbTdBase = {
  padding: 10,
  borderBottom: "1px solid rgba(148,163,184,0.08)",
  background: "rgba(15,23,42,0.15)",
  whiteSpace: "nowrap",
  textAlign: "center",
};

const lbTdRank = { ...lbTdBase, width: 52, opacity: 0.85 };

const lbTd = { ...lbTdBase, opacity: 0.95 };

const lbTdStrong = {
  ...lbTdBase,
  fontWeight: 1000,
  color: "white",
  background: "rgba(59,130,246,0.08)",
};

const lbTdPrize = {
  ...lbTdBase,
  fontWeight: 1000,
  color: "#dbeafe",
  background: "rgba(59,130,246,0.06)",
};

const lbTdName = {
  ...lbTdBase,
  position: "sticky",
  left: 0,
  zIndex: 1,
  textAlign: "left",
  minWidth: 240,
  background: "rgba(2,6,23,0.78)",
  backdropFilter: "blur(10px)",
};

const lbNameText = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontWeight: 950,
  color: "white",
};

const groupCardBtn = {
  width: "100%",
  borderRadius: 18,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(2,6,23,0.35)",
  padding: 12,
  textAlign: "left",
};

const openPill = {
  padding: "8px 10px",
  borderRadius: 999,
  border: "1px solid rgba(59,130,246,0.35)",
  background: "rgba(59,130,246,0.18)",
  color: "#dbeafe",
  fontWeight: 950,
};

const progressTrack = {
  marginTop: 8,
  height: 8,
  borderRadius: 999,
  background: "rgba(148,163,184,0.12)",
  overflow: "hidden",
};

const progressFill = {
  height: "100%",
  borderRadius: 999,
  background: "linear-gradient(90deg, rgba(59,130,246,0.65), rgba(34,197,94,0.55))",
};

const h2hStrip = {
  padding: 12,
  borderRadius: 16,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(15,23,42,0.45)",
};

const h2hGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 10,
  marginTop: 8,
};

const h2hCell = {
  borderRadius: 14,
  border: "1px solid rgba(148,163,184,0.12)",
  background: "rgba(2,6,23,0.35)",
  padding: 10,
  textAlign: "center",
};

const h2hHead = { opacity: 0.7, fontWeight: 950, fontSize: 12 };
const h2hVal = (v) => ({
  marginTop: 6,
  fontWeight: 1000,
  fontSize: 22,
  letterSpacing: -0.4,
  color: v > 0 ? "#22c55e" : v < 0 ? "#ef4444" : "#e5e7eb",
});

const loadingCard = {
  margin: 14,
  padding: 14,
  borderRadius: 18,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(2,6,23,0.35)",
  color: "white",
  fontWeight: 950,
};

const fallbackCard = {
  borderRadius: 18,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(2,6,23,0.35)",
  padding: 16,
};

const btn = {
  marginTop: 10,
  padding: "10px 14px",
  borderRadius: 14,
  border: "1px solid rgba(148,163,184,0.18)",
  background: "rgba(15,23,42,0.55)",
  color: "white",
  fontWeight: 900,
};
