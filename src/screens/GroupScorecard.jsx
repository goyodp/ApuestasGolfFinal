// src/screens/GroupScorecard.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase/db";
import {
  COURSE_DATA,
  buildHcpAdjustments,
  sumNet9,
  sumGross9,
  sumStableford9,
  pairKey,
  scoreCategory,
  computeMatchResultForPair,
  calcMatchMoneyForPair,
  computeBonusMoneyByPlayer,
  computeGreensMoneyByPlayer,
  computeMatchesMoneyByPlayer,
  fmtMoney as fmtMoneyLib,
  fmtMatch as fmtMatchLib,
} from "../lib/compute";

function makePlayerId(existingIds = []) {
  for (let i = 1; i <= 6; i++) {
    const id = `p${i}`;
    if (!existingIds.includes(id)) return id;
  }
  return `p${Date.now()}`;
}

const DEFAULT_GROUP_SETTINGS = {
  birdiePay: 10,
  eaglePay: 20,
  albatrossPay: 30,
  greensPay: 10, // fixed tag "Greens"
};

const DEFAULT_STATE = {
  players: [],
  scores: {},

  groupSettings: { ...DEFAULT_GROUP_SETTINGS },

  matchBets: {},
  dobladas: {},
  greens: {},
  bolaRosa: "",

  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
};

export default function GroupScorecard() {
  const { sessionId, groupId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [groupMeta, setGroupMeta] = useState(null);
  const [session, setSession] = useState(null); // ✅ now reading courseId/hcpPercent from session doc
  const [settings, setSettings] = useState(null); // still useful for entryFee if you ever show it here
  const [state, setState] = useState(undefined);
  const [saving, setSaving] = useState(false);

  const [editingScores, setEditingScores] = useState({}); // { [playerId]: { [holeIndex]: "value" } }

  const screenshotMode = searchParams.get("shot") === "1";

  const sessionRef = useMemo(() => {
    if (!sessionId) return null;
    return doc(db, "sessions", sessionId);
  }, [sessionId]);

  const settingsRef = useMemo(() => {
    if (!sessionId) return null;
    return doc(db, "sessions", sessionId, "settings", "main");
  }, [sessionId]);

  const groupRef = useMemo(() => {
    if (!sessionId || !groupId) return null;
    return doc(db, "sessions", sessionId, "groups", groupId);
  }, [sessionId, groupId]);

  const stateRef = useMemo(() => {
    if (!sessionId || !groupId) return null;
    return doc(db, "sessions", sessionId, "groups", groupId, "state", "main");
  }, [sessionId, groupId]);

  useEffect(() => {
    if (!sessionRef) return;
    return onSnapshot(sessionRef, (snap) => setSession(snap.exists() ? snap.data() : null));
  }, [sessionRef]);

  useEffect(() => {
    if (!settingsRef) return;
    return onSnapshot(settingsRef, (snap) => setSettings(snap.exists() ? snap.data() : null));
  }, [settingsRef]);

  useEffect(() => {
    if (!groupRef) return;
    return onSnapshot(groupRef, (snap) => setGroupMeta(snap.exists() ? snap.data() : null));
  }, [groupRef]);

  // Listener + auto init + migration defaults
  useEffect(() => {
    if (!stateRef) return;

    const unsub = onSnapshot(stateRef, async (snap) => {
      if (snap.exists()) {
        const data = snap.data();

        const gs = data.groupSettings || {};
        const nextGs = { ...DEFAULT_GROUP_SETTINGS, ...gs };

        const migratedGreens = data.greens || data.greenies || {};
        const migratedBolaRosa = typeof data.bolaRosa === "string" ? data.bolaRosa : "";

        const needsPatch =
          !data.groupSettings ||
          !data.greens ||
          !("bolaRosa" in data) ||
          nextGs.birdiePay !== gs.birdiePay ||
          nextGs.eaglePay !== gs.eaglePay ||
          nextGs.albatrossPay !== gs.albatrossPay ||
          nextGs.greensPay !== gs.greensPay;

        if (needsPatch) {
          try {
            await updateDoc(stateRef, {
              groupSettings: nextGs,
              greens: migratedGreens,
              bolaRosa: migratedBolaRosa,
              updatedAt: serverTimestamp(),
            });
          } catch {}
        }

        setState({
          ...data,
          groupSettings: nextGs,
          greens: migratedGreens,
          bolaRosa: migratedBolaRosa,
        });
        return;
      }

      try {
        await setDoc(stateRef, DEFAULT_STATE, { merge: true });
      } catch (e) {
        console.error(e);
        setState(null);
      }
    });

    return () => unsub();
  }, [stateRef]);

  const courseId = session?.courseId || "campestre-slp";
  const hcpPercent = session?.hcpPercent ?? 100; // ONLY net + stableford
  const course = COURSE_DATA[courseId] || COURSE_DATA["campestre-slp"];

  const players = state?.players || [];
  const scores = state?.scores || {};
  const groupSettings = state?.groupSettings || DEFAULT_GROUP_SETTINGS;
  const matchBets = state?.matchBets || {};
  const dobladas = state?.dobladas || {};
  const greens = state?.greens || {};
  const bolaRosa = state?.bolaRosa || "";

  const par3Holes = useMemo(() => {
    const out = [];
    for (let i = 0; i < course.parValues.length; i++) {
      if (course.parValues[i] === 3) out.push(i + 1);
    }
    return out;
  }, [course.parValues]);

  const patchState = async (patch) => {
    if (!stateRef) return;
    setSaving(true);
    try {
      await updateDoc(stateRef, { ...patch, updatedAt: serverTimestamp() });
    } finally {
      setSaving(false);
    }
  };

  const addPlayer = async () => {
    if (!state) return;
    if (players.length >= 6) return alert("Máximo 6 jugadores por grupo.");

    const existingIds = players.map((p) => p.id);
    const id = makePlayerId(existingIds);

    const newPlayers = [...players, { id, name: `Player ${players.length + 1}`, hcp: 0 }];
    const newScores = { ...scores, [id]: Array(18).fill("") };

    await patchState({ players: newPlayers, scores: newScores });
  };

  const removePlayer = async (playerId) => {
    if (!state) return;

    const newPlayers = players.filter((p) => p.id !== playerId);
    const newScores = { ...scores };
    delete newScores[playerId];

    const newGreens = { ...greens };
    Object.keys(newGreens).forEach((h) => {
      if (newGreens[h] === playerId) delete newGreens[h];
    });

    const newMatchBets = { ...matchBets };
    Object.keys(newMatchBets).forEach((k) => {
      if (k.split("|").includes(playerId)) delete newMatchBets[k];
    });

    const newDobladas = { ...dobladas };
    Object.keys(newDobladas).forEach((k) => {
      if (k.split("|").includes(playerId)) delete newDobladas[k];
    });

    const newBolaRosa = bolaRosa === playerId ? "" : bolaRosa;

    await patchState({
      players: newPlayers,
      scores: newScores,
      greens: newGreens,
      matchBets: newMatchBets,
      dobladas: newDobladas,
      bolaRosa: newBolaRosa,
    });
  };

  const updatePlayer = async (playerId, field, value) => {
    if (!state) return;
    const newPlayers = players.map((p) => (p.id === playerId ? { ...p, [field]: value } : p));
    await patchState({ players: newPlayers });
  };

  const commitScore = async (playerId, holeIndex, value) => {
    if (!state) return;
    const arr = Array.isArray(scores[playerId]) ? [...scores[playerId]] : Array(18).fill("");
    arr[holeIndex] = value;
    await patchState({ scores: { ...scores, [playerId]: arr } });
  };

  const onScoreChange = (playerId, holeIndex, value) => {
    // keep digits only (optional) - but allow empty
    const cleaned = value === "" ? "" : value.replace(/[^\d]/g, "");
    setEditingScores((prev) => ({
      ...prev,
      [playerId]: { ...(prev[playerId] || {}), [holeIndex]: cleaned },
    }));
  };

  const onScoreBlur = async (playerId, holeIndex) => {
    const v = editingScores?.[playerId]?.[holeIndex];
    if (v === undefined) return;
    await commitScore(playerId, holeIndex, v);

    setEditingScores((prev) => {
      const next = { ...prev };
      const row = { ...(next[playerId] || {}) };
      delete row[holeIndex];
      if (Object.keys(row).length === 0) delete next[playerId];
      else next[playerId] = row;
      return next;
    });
  };

  const updateGroupSetting = async (field, raw) => {
    const value = Math.max(0, parseInt(raw || "0", 10));
    await patchState({ groupSettings: { ...groupSettings, [field]: value } });
  };

  const setGreenWinner = async (holeNumber, playerIdOrEmpty) => {
    const next = { ...greens };
    if (!playerIdOrEmpty) delete next[String(holeNumber)];
    else next[String(holeNumber)] = playerIdOrEmpty;
    await patchState({ greens: next });
  };

  const setBetAmount = async (aId, bId, raw) => {
    const key = pairKey(aId, bId);
    const n = Math.max(0, parseInt(raw || "0", 10));
    const prev = matchBets[key] || { amount: 0 };
    await patchState({ matchBets: { ...matchBets, [key]: { ...prev, amount: n } } });
  };

  const toggleDoblada = async (aId, bId, seg, checked) => {
    const key = pairKey(aId, bId);
    const prev = dobladas[key] || { f9: false, b9: false };
    await patchState({ dobladas: { ...dobladas, [key]: { ...prev, [seg]: !!checked } } });
  };

  const setBolaRosa = async (playerIdOrEmpty) => {
    await patchState({ bolaRosa: playerIdOrEmpty || "" });
  };

  const toggleScreenshot = () => {
    const next = new URLSearchParams(searchParams);
    if (screenshotMode) next.delete("shot");
    else next.set("shot", "1");
    setSearchParams(next, { replace: true });
  };

  if (!sessionId || !groupId) return <div style={{ padding: 20 }}>Faltan parámetros.</div>;
  if (!groupMeta || state === undefined || !settings || !session) return <div style={{ padding: 20 }}>Cargando grupo...</div>;
  if (state === null) return <div style={{ padding: 20 }}>No pude crear state/main (revisa reglas).</div>;

  // ===== Money inside group =====
  const bonusByPlayer = computeBonusMoneyByPlayer({
    players,
    scores,
    parValues: course.parValues,
    groupSettings,
  });

  const greensByPlayer = computeGreensMoneyByPlayer({
    players,
    greens,
    greensPay: groupSettings.greensPay ?? 0,
  });

  const matchesByPlayer = computeMatchesMoneyByPlayer({
    players,
    scores,
    courseId,
    matchBets,
    dobladas,
  });

  const moneyRows = players.map((p) => {
    const bonus = bonusByPlayer[p.id] || 0;
    const g = greensByPlayer[p.id] || 0;
    const m = matchesByPlayer[p.id] || 0;
    return {
      id: p.id,
      name: p.name || p.id,
      matches: m,
      greens: g,
      bonus,
      total: m + g + bonus,
    };
  });

  // ===== Build matches list for UI =====
  const matchesList = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i];
      const b = players[j];
      const key = pairKey(a.id, b.id);

      const bet = matchBets[key] || { amount: 0 };
      const dbl = dobladas[key] || { f9: false, b9: false };

      const pairRes = computeMatchResultForPair({
        a,
        b,
        scores,
        courseId,
      });

      const money = calcMatchMoneyForPair({
        pairResult: pairRes,
        matchBetsForPair: bet,
        dobladasForPair: dbl,
      });

      matchesList.push({ key, a, b, pairRes, bet, dbl, money });
    }
  }

  return (
    <div style={page}>
      {/* Responsive CSS (keeps your inline style system but makes mobile 🔥) */}
      <style>{`
        :root{
          --fg:#0f172a;
          --muted: rgba(15,23,42,.72);
          --border: rgba(15,23,42,.12);
          --glass: rgba(255,255,255,.78);
        }
        .ag-hide-shot{ display:${screenshotMode ? "none" : "block"}; }
        .ag-hide-shot-flex{ display:${screenshotMode ? "none" : "flex"}; }
        .ag-tableWrap{
          overflow-x:auto;
          -webkit-overflow-scrolling:touch;
          border-radius: 18px;
        }
        .ag-table{
          width:100%;
          min-width: 1080px;
          border-collapse:collapse;
        }
        @media (max-width: 760px){
          .ag-table{ min-width: 980px; }
        }
        @media (max-width: 520px){
          .ag-table{ min-width: 940px; }
        }
        .ag-inputScore{
          width:44px; height:44px;
        }
        @media (max-width: 520px){
          .ag-inputScore{
            width:40px; height:40px;
            border-radius: 10px;
          }
        }
        .ag-sticky{
          position: sticky;
          left: 0;
          z-index: 3;
          box-shadow: 8px 0 18px rgba(2,6,23,.06);
        }
        .ag-stickyHead{
          position: sticky;
          top: 0;
          z-index: 20;
        }
        .ag-scoreHint{
          display:none;
        }
        @media (max-width: 760px){
          .ag-scoreHint{ display:block; opacity:.65; font-size:12px; margin-top:8px; }
        }
      `}</style>

      <div style={header} className="ag-stickyHead">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 950, letterSpacing: -0.2 }}>
              {groupMeta?.name || groupId}
            </h1>

            <span style={badge}>
              {course.name}
            </span>

            <span style={badgeMuted}>
              Net/STB {hcpPercent}%
            </span>

            <span style={badgeMuted}>
              Matches 100%
            </span>
          </div>

          <div style={{ opacity: 0.82, marginTop: 8, fontSize: 13 }}>
            Session: <b style={{ fontWeight: 950 }}>{sessionId}</b>
            {saving ? <span style={{ marginLeft: 10 }}>· Guardando…</span> : null}
          </div>

          <div style={payoutRow} className="ag-hide-shot-flex">
            <PayoutInput
              label="Birdie"
              value={groupSettings.birdiePay ?? 0}
              onBlur={(v) => updateGroupSetting("birdiePay", v)}
            />
            <PayoutInput
              label="Eagle"
              value={groupSettings.eaglePay ?? 0}
              onBlur={(v) => updateGroupSetting("eaglePay", v)}
            />
            <PayoutInput
              label="Albatross/HIO"
              value={groupSettings.albatrossPay ?? 0}
              onBlur={(v) => updateGroupSetting("albatrossPay", v)}
            />
            <PayoutInput
              label="Greens"
              value={groupSettings.greensPay ?? 0}
              onBlur={(v) => updateGroupSetting("greensPay", v)}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={toggleScreenshot} style={btn} className="ag-hide-shot">
            {screenshotMode ? "Salir Shot" : "📸 Shot"}
          </button>

          <button onClick={() => navigate(`/session/${sessionId}`)} style={btn}>
            ← Volver
          </button>
        </div>
      </div>

      <hr style={hr} />

      {/* Greens + Bola Rosa */}
      <section style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Greens (Par 3)</h2>

          <div style={{ marginLeft: "auto", minWidth: 260 }}>
            <div style={{ fontWeight: 950, marginBottom: 6 }}>Bola Rosa</div>
            <select
              value={bolaRosa}
              onChange={(e) => setBolaRosa(e.target.value)}
              style={select}
              disabled={players.length === 0}
            >
              <option value="">— Sin ganador —</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        {players.length < 2 ? (
          <div style={{ opacity: 0.75, marginTop: 10 }}>Agrega jugadores para seleccionar ganadores.</div>
        ) : (
          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            {par3Holes.map((holeNumber) => (
              <div key={holeNumber} style={card}>
                <div style={{ fontWeight: 950, marginBottom: 8 }}>
                  Hoyo {holeNumber} <span style={{ opacity: 0.65, fontWeight: 900 }}>(Par 3)</span>
                </div>
                <select
                  value={greens[String(holeNumber)] || ""}
                  onChange={(e) => setGreenWinner(holeNumber, e.target.value)}
                  style={select}
                >
                  <option value="">— Sin ganador —</option>
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <div style={{ opacity: 0.72, fontSize: 12, marginTop: 8 }}>
                  Gana <b>${groupSettings.greensPay}</b> vs cada jugador.
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <hr style={hr} />

      <div className="ag-hide-shot-flex" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={addPlayer} disabled={players.length >= 6} style={btnPrimary}>
          + Agregar jugador ({players.length}/6)
        </button>

        <div style={{ opacity: 0.7, fontSize: 12 }}>
          Tip móvil: desliza horizontal en la tabla para capturar screenshots rápido.
        </div>
      </div>

      {/* Score table */}
      <div style={{ marginTop: 14 }} className="ag-tableWrap">
        <table className="ag-table">
          <thead>
            <tr>
              <th style={thSticky} className="ag-sticky">Jugador</th>

              {Array.from({ length: 9 }).map((_, i) => (
                <th key={`f-${i}`} style={th}>{i + 1}</th>
              ))}
              <th style={thStrong}>F9</th>

              {Array.from({ length: 9 }).map((_, i) => (
                <th key={`b-${i}`} style={th}>{i + 10}</th>
              ))}
              <th style={thStrong}>B9</th>

              <th style={thStrong}>Tot</th>
              <th style={thMuted}>Net</th>
              <th style={thMuted}>STB</th>
            </tr>

            <tr>
              <th style={thStickySmall} className="ag-sticky">Hcp</th>

              {course.parValues.slice(0, 9).map((p, i) => (
                <th key={`pf-${i}`} style={thMuted}>Par {p}</th>
              ))}
              <th style={thMuted}></th>

              {course.parValues.slice(9).map((p, i) => (
                <th key={`pb-${i}`} style={thMuted}>Par {p}</th>
              ))}
              <th style={thMuted}></th>

              <th style={thMuted}></th>
              <th style={thMuted}></th>
              <th style={thMuted}></th>
            </tr>
          </thead>

          <tbody>
            {players.map((p) => {
              const arr = scores[p.id] || Array(18).fill("");

              const grossF9 = sumGross9(arr, 0);
              const grossB9 = sumGross9(arr, 9);
              const grossT = grossF9 + grossB9;

              const adj = buildHcpAdjustments(p.hcp || 0, hcpPercent, course.strokeIndexes);
              const netF9 = sumNet9(arr, adj, 0);
              const netB9 = sumNet9(arr, adj, 9);
              const netT = netF9 + netB9;

              const stbF9 = sumStableford9(arr, course.parValues, adj, 0);
              const stbB9 = sumStableford9(arr, course.parValues, adj, 9);
              const stbT = stbF9 + stbB9;

              const effHcp = Math.round((p.hcp || 0) * (Number(hcpPercent) / 100));

              return (
                <tr key={p.id} style={{ borderTop: "1px solid rgba(0,0,0,0.08)" }}>
                  <td style={tdSticky} className="ag-sticky">
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <input
                        defaultValue={p.name}
                        onBlur={(e) => updatePlayer(p.id, "name", e.target.value)}
                        style={inputName}
                        placeholder="Nombre"
                      />

                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <input
                          type="number"
                          defaultValue={p.hcp}
                          onBlur={(e) => updatePlayer(p.id, "hcp", parseFloat(e.target.value || "0"))}
                          style={inputHcp}
                        />
                        <span style={{ fontSize: 12, opacity: 0.78, fontWeight: 900 }}>
                          eff {hcpPercent}%: <b>{effHcp}</b>
                        </span>

                        <button onClick={() => removePlayer(p.id)} style={btnDanger} className="ag-hide-shot">
                          Quitar
                        </button>
                      </div>
                    </div>
                  </td>

                  {Array.from({ length: 9 }).map((_, h) => {
                    const shown =
                      editingScores?.[p.id]?.[h] !== undefined ? editingScores[p.id][h] : (arr[h] ?? "");
                    const cat = scoreCategory(shown, course.parValues[h]);
                    return (
                      <td key={`sf-${p.id}-${h}`} style={td}>
                        <input
                          inputMode="numeric"
                          value={shown}
                          onChange={(e) => onScoreChange(p.id, h, e.target.value)}
                          onBlur={() => onScoreBlur(p.id, h)}
                          style={{ ...inputScore, ...scoreStyle(cat) }}
                          className="ag-inputScore"
                        />
                      </td>
                    );
                  })}
                  <td style={tdStrong}>{grossF9 || ""}</td>

                  {Array.from({ length: 9 }).map((_, i) => {
                    const h = i + 9;
                    const shown =
                      editingScores?.[p.id]?.[h] !== undefined ? editingScores[p.id][h] : (arr[h] ?? "");
                    const cat = scoreCategory(shown, course.parValues[h]);
                    return (
                      <td key={`sb-${p.id}-${h}`} style={td}>
                        <input
                          inputMode="numeric"
                          value={shown}
                          onChange={(e) => onScoreChange(p.id, h, e.target.value)}
                          onBlur={() => onScoreBlur(p.id, h)}
                          style={{ ...inputScore, ...scoreStyle(cat) }}
                          className="ag-inputScore"
                        />
                      </td>
                    );
                  })}
                  <td style={tdStrong}>{grossB9 || ""}</td>

                  <td style={tdStrong}>{grossT || ""}</td>
                  <td style={tdMutedCell}>{netT || ""}</td>
                  <td style={tdMutedCell}>{stbT || ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="ag-scoreHint">
        Desliza → para ver hoyos 10–18. Para screenshot: botón “📸 Shot”.
      </div>

      <hr style={hr} />

      {/* Matches */}
      <section style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Matches</h2>
          <div style={{ opacity: 0.7, fontSize: 12 }} className="ag-hide-shot">
            Bet = 1 monto · Doblada (x2 por segmento) · Mostramos <b>$Total</b>
          </div>
        </div>

        {players.length < 2 ? (
          <div style={{ opacity: 0.75, marginTop: 10 }}>Agrega al menos 2 jugadores.</div>
        ) : (
          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            {matchesList.map((m) => (
              <MatchCard
                key={m.key}
                m={m}
                onBet={(raw) => setBetAmount(m.a.id, m.b.id, raw)}
                onDbl={(seg, checked) => toggleDoblada(m.a.id, m.b.id, seg, checked)}
                screenshotMode={screenshotMode}
              />
            ))}
          </div>
        )}
      </section>

      <hr style={hr} />

      {/* Money by player */}
      <section style={{ marginBottom: 20 }}>
        <h2 style={{ margin: "0 0 8px 0" }}>Totales por jugador (grupo)</h2>

        {players.length === 0 ? (
          <div style={{ opacity: 0.75 }}>Agrega jugadores.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={thLeft}>Jugador</th>
                  <th style={th}>Matches</th>
                  <th style={th}>Greens</th>
                  <th style={th}>Birdie/Eagle/Alb</th>
                  <th style={thStrong}>Total</th>
                </tr>
              </thead>
              <tbody>
                {moneyRows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid rgba(0,0,0,0.08)" }}>
                    <td style={tdLeft}><b>{r.name}</b></td>
                    <td style={td}>{fmtMoneyLib(r.matches)}</td>
                    <td style={td}>{fmtMoneyLib(r.greens)}</td>
                    <td style={td}>{fmtMoneyLib(r.bonus)}</td>
                    <td style={{ ...tdStrong, color: r.total > 0 ? "#16a34a" : r.total < 0 ? "#dc2626" : "#0f172a" }}>
                      {fmtMoneyLib(r.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ opacity: 0.7, fontSize: 12, marginTop: 8 }}>
              Bonus y Greens son zero-sum dentro del grupo.
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function MatchCard({ m, onBet, onDbl, screenshotMode }) {
  const aWins = m.pairRes.total > 0;
  const bWins = m.pairRes.total < 0;

  const accent =
    aWins ? "#16a34a" :
    bWins ? "#dc2626" :
    "#64748b";

  return (
    <div style={matchCard}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 950, fontSize: 16, lineHeight: 1.1 }}>
            {m.a.name} <span style={{ opacity: 0.55, fontWeight: 900 }}>vs</span> {m.b.name}
          </div>
          <div style={{ marginTop: 6, opacity: 0.72, fontSize: 12 }}>
            diff HCP: <b>{m.pairRes.diff}</b>
          </div>
        </div>

        {!screenshotMode ? (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div style={miniField}>
              <div style={miniLabel}>Bet</div>
              <input
                type="number"
                defaultValue={m.bet.amount}
                onBlur={(e) => onBet(e.target.value)}
                style={miniInput}
                inputMode="numeric"
              />
            </div>

            <label style={checkPill}>
              <input
                type="checkbox"
                checked={!!m.dbl.f9}
                onChange={(e) => onDbl("f9", e.target.checked)}
              />
              <span style={{ fontWeight: 900 }}>Doblada F9</span>
            </label>

            <label style={checkPill}>
              <input
                type="checkbox"
                checked={!!m.dbl.b9}
                onChange={(e) => onDbl("b9", e.target.checked)}
              />
              <span style={{ fontWeight: 900 }}>Doblada B9</span>
            </label>
          </div>
        ) : null}
      </div>

      <div style={scoreStripWrap}>
        <div style={scoreStripHead}>
          <div style={scoreStripH}>F9</div>
          <div style={scoreStripH}>B9</div>
          <div style={scoreStripH}>Total</div>
        </div>

        <div style={scoreStripBody}>
          <div style={{ ...scoreStripV, color: accent }}>{fmtMatchLib(m.pairRes.front)}</div>
          <div style={{ ...scoreStripV, color: accent }}>{fmtMatchLib(m.pairRes.back)}</div>
          <div style={{ ...scoreStripV, color: accent }}>{fmtMatchLib(m.pairRes.total)}</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
        <div style={{ ...moneyPill, borderColor: accent, color: accent }}>
          {fmtMoneyLib(m.money.moneyTotal)} <span style={{ opacity: 0.7, fontWeight: 900 }}>total</span>
        </div>
      </div>
    </div>
  );
}

function PayoutInput({ label, value, onBlur }) {
  return (
    <div style={pill}>
      <div style={pillLabel}>{label}</div>
      <input
        type="number"
        defaultValue={value}
        onBlur={(e) => onBlur(e.target.value)}
        style={pillInput}
        inputMode="numeric"
      />
    </div>
  );
}

function scoreStyle(cat) {
  if (cat === "albatross") return { borderColor: "#ff77c8", background: "rgba(255,119,200,0.12)" };
  if (cat === "eagle") return { borderColor: "#22c55e", background: "rgba(34,197,94,0.12)" };
  if (cat === "birdie") return { borderColor: "#fb923c", background: "rgba(251,146,60,0.12)" };
  if (cat === "bogey") return { borderColor: "#60a5fa", background: "rgba(96,165,250,0.12)" };
  if (cat === "double") return { borderColor: "#ef4444", background: "rgba(239,68,68,0.12)" };
  return {};
}

// ---------- styles ----------
const page = {
  padding: 16,
  fontFamily: "system-ui",
  maxWidth: 1100,
  margin: "0 auto",
  color: "#0f172a",
  background:
    "radial-gradient(1200px 800px at 20% -20%, rgba(59,130,246,0.14), transparent 55%), radial-gradient(900px 600px at 120% 10%, rgba(34,197,94,0.12), transparent 55%), linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)",
  minHeight: "100vh",
};

const header = {
  display: "flex",
  gap: 12,
  alignItems: "flex-start",
  position: "sticky",
  top: 0,
  zIndex: 15,
  backdropFilter: "blur(10px)",
  background: "rgba(248,250,252,0.88)",
  paddingBottom: 10,
  paddingTop: 10,
  borderBottom: "1px solid rgba(15,23,42,0.08)",
};

const badge = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(59,130,246,0.22)",
  background: "rgba(59,130,246,0.10)",
  fontWeight: 950,
  fontSize: 12,
};

const badgeMuted = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(15,23,42,0.12)",
  background: "rgba(255,255,255,0.7)",
  fontWeight: 950,
  fontSize: 12,
  opacity: 0.9,
};

const payoutRow = { marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" };

const pill = {
  padding: "10px 12px",
  borderRadius: 16,
  border: "1px solid rgba(15,23,42,0.10)",
  background: "rgba(255,255,255,0.75)",
  minWidth: 140,
  boxShadow: "0 10px 25px rgba(2,6,23,0.06)",
};
const pillLabel = { opacity: 0.7, fontSize: 12, fontWeight: 950, color: "#0f172a" };
const pillInput = {
  marginTop: 6,
  width: "100%",
  padding: "10px 10px",
  borderRadius: 12,
  border: "1px solid rgba(15,23,42,0.14)",
  background: "white",
  color: "#0f172a",
  fontWeight: 950,
};

const card = {
  border: "1px solid rgba(15,23,42,0.10)",
  borderRadius: 18,
  padding: 14,
  background: "rgba(255,255,255,0.75)",
  boxShadow: "0 14px 30px rgba(2,6,23,0.07)",
};

const select = {
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid rgba(15,23,42,0.14)",
  background: "white",
  color: "#0f172a",
  fontWeight: 950,
  width: "100%",
};

const hr = { margin: "14px 0", borderColor: "rgba(15,23,42,0.10)" };

const th = {
  textAlign: "center",
  padding: 8,
  background: "rgba(15,23,42,0.06)",
  color: "#0f172a",
  fontWeight: 900,
  borderBottom: "1px solid rgba(15,23,42,0.10)",
  whiteSpace: "nowrap",
};
const thLeft = { ...th, textAlign: "left" };
const thMuted = { ...th, opacity: 0.75, fontWeight: 800, fontSize: 12 };
const thStrong = { ...th, background: "rgba(59,130,246,0.12)" };

const thSticky = { ...th, textAlign: "left", minWidth: 250, background: "rgba(248,250,252,0.95)" };
const thStickySmall = { ...thMuted, textAlign: "left", background: "rgba(248,250,252,0.95)" };

const td = { padding: 8, textAlign: "center", background: "rgba(255,255,255,0.55)", color: "#0f172a" };
const tdLeft = { ...td, textAlign: "left" };
const tdSticky = { ...td, textAlign: "left", minWidth: 250, background: "rgba(248,250,252,0.92)" };
const tdStrong = { ...td, fontWeight: 950, background: "rgba(59,130,246,0.10)" };
const tdMutedCell = { ...td, opacity: 0.95, background: "rgba(15,23,42,0.04)", fontWeight: 950 };

const inputName = {
  width: "100%",
  padding: "10px 10px",
  borderRadius: 12,
  border: "1px solid rgba(15,23,42,0.14)",
  background: "white",
  color: "#0f172a",
  fontWeight: 950,
};

const inputHcp = {
  width: 86,
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid rgba(15,23,42,0.14)",
  background: "white",
  color: "#0f172a",
  fontWeight: 900,
};

const inputScore = {
  padding: "8px 6px",
  borderRadius: 12,
  border: "1px solid rgba(15,23,42,0.14)",
  background: "white",
  color: "#0f172a",
  textAlign: "center",
  fontWeight: 950,
  outline: "none",
};

const btn = {
  padding: "10px 14px",
  borderRadius: 14,
  border: "1px solid rgba(15,23,42,0.16)",
  background: "rgba(255,255,255,0.8)",
  color: "#0f172a",
  fontWeight: 950,
  cursor: "pointer",
  boxShadow: "0 12px 26px rgba(2,6,23,0.08)",
};

const btnPrimary = {
  ...btn,
  background: "linear-gradient(180deg, rgba(59,130,246,0.22), rgba(59,130,246,0.12))",
  border: "1px solid rgba(59,130,246,0.28)",
};

const btnDanger = {
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid rgba(220,38,38,0.22)",
  background: "rgba(220,38,38,0.10)",
  color: "#b91c1c",
  fontWeight: 950,
  cursor: "pointer",
};

// Matches UI
const matchCard = {
  borderRadius: 20,
  border: "1px solid rgba(15,23,42,0.10)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.80) 0%, rgba(255,255,255,0.60) 100%)",
  boxShadow: "0 18px 40px rgba(2,6,23,0.10)",
  padding: 14,
};

const miniField = {
  minWidth: 120,
  borderRadius: 16,
  border: "1px solid rgba(15,23,42,0.10)",
  background: "rgba(255,255,255,0.75)",
  padding: "10px 12px",
};

const miniLabel = { fontSize: 12, fontWeight: 950, opacity: 0.7 };
const miniInput = {
  marginTop: 6,
  width: "100%",
  padding: "10px 10px",
  borderRadius: 12,
  border: "1px solid rgba(15,23,42,0.14)",
  background: "white",
  fontWeight: 950,
  textAlign: "center",
};

const checkPill = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 12px",
  borderRadius: 16,
  border: "1px solid rgba(15,23,42,0.10)",
  background: "rgba(255,255,255,0.75)",
  userSelect: "none",
};

const scoreStripWrap = {
  marginTop: 12,
  borderRadius: 18,
  overflow: "hidden",
  border: "1px solid rgba(15,23,42,0.10)",
};

const scoreStripHead = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  background: "rgba(15,23,42,0.06)",
};

const scoreStripBody = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  background: "rgba(15,23,42,0.03)",
};

const scoreStripH = {
  padding: "10px 10px",
  textAlign: "center",
  fontWeight: 950,
  letterSpacing: -0.2,
};

const scoreStripV = {
  padding: "18px 10px",
  textAlign: "center",
  fontWeight: 1000,
  fontSize: 28,
  letterSpacing: -0.6,
};

const moneyPill = {
  padding: "10px 12px",
  borderRadius: 16,
  border: "2px solid rgba(15,23,42,0.10)",
  background: "rgba(255,255,255,0.75)",
  fontWeight: 1000,
};
