// src/screens/GroupScorecard.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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

  // per pair: { "p1|p2": { amount: 50 } }
  matchBets: {},

  // per pair: { "p1|p2": { f9: false, b9: false } }  // checkbox free
  dobladas: {},

  // winners by par3 hole number as string: { "3": "p2" }
  greens: {},

  // Bola Rosa winner (playerId)
  bolaRosa: "",

  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
};

export default function GroupScorecard() {
  const { sessionId, groupId } = useParams();
  const navigate = useNavigate();

  const [groupMeta, setGroupMeta] = useState(null);
  const [settings, setSettings] = useState(null); // global settings/main
  const [state, setState] = useState(undefined);
  const [saving, setSaving] = useState(false);

  const [editingScores, setEditingScores] = useState({}); // { [playerId]: { [holeIndex]: "value" } }

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

  const courseId = settings?.courseId || "campestre-slp";
  const hcpPercent = settings?.hcpPercent ?? 100; // ONLY net + stableford
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
    setEditingScores((prev) => ({
      ...prev,
      [playerId]: { ...(prev[playerId] || {}), [holeIndex]: value },
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

  if (!sessionId || !groupId) return <div style={{ padding: 20 }}>Faltan parámetros.</div>;
  if (!groupMeta || state === undefined || !settings) return <div style={{ padding: 20 }}>Cargando grupo...</div>;
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

  // MATCHES always 100% hcp diff (handled in compute.js)
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
        aId: a.id,
        bId: b.id,
        matchBetsForPair: bet,
        dobladasForPair: dbl,
      });

      matchesList.push({ key, a, b, pairRes, bet, dbl, money });
    }
  }

  return (
    <div style={page}>
      <div style={header}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>
            {groupMeta?.name || groupId}
          </h1>

          <div style={{ opacity: 0.8, marginTop: 6, fontSize: 13 }}>
            Campo: <b>{course.name}</b> · %Hcp (Net/STB): <b>{hcpPercent}</b> · Matches: <b>100%</b>
            {saving ? <span style={{ marginLeft: 10 }}>Guardando…</span> : null}
          </div>

          <div style={payoutRow}>
            <PayoutInput label="Birdie" value={groupSettings.birdiePay ?? 0} onBlur={(v) => updateGroupSetting("birdiePay", v)} />
            <PayoutInput label="Eagle" value={groupSettings.eaglePay ?? 0} onBlur={(v) => updateGroupSetting("eaglePay", v)} />
            <PayoutInput label="Albatross/HIO" value={groupSettings.albatrossPay ?? 0} onBlur={(v) => updateGroupSetting("albatrossPay", v)} />
            <PayoutInput label="Greens" value={groupSettings.greensPay ?? 0} onBlur={(v) => updateGroupSetting("greensPay", v)} />
          </div>
        </div>

        <button onClick={() => navigate(`/session/${sessionId}`)} style={btn}>
          ← Volver
        </button>
      </div>

      <hr style={hr} />

      {/* Greens + Bola Rosa */}
      <section style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Greens (Par 3)</h2>

          <div style={{ marginLeft: "auto", minWidth: 260 }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Bola Rosa</div>
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
            <div style={{ opacity: 0.65, fontSize: 12, marginTop: 8 }}>
              Solo tracking (si quieres, luego la metemos a dinero con monto).
            </div>
          </div>
        </div>

        {players.length < 2 ? (
          <div style={{ opacity: 0.7, marginTop: 10 }}>Agrega jugadores para seleccionar ganadores.</div>
        ) : (
          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            {par3Holes.map((holeNumber) => (
              <div key={holeNumber} style={card}>
                <div style={{ fontWeight: 900, marginBottom: 8 }}>
                  Hoyo {holeNumber} (Par 3)
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
                <div style={{ opacity: 0.65, fontSize: 12, marginTop: 8 }}>
                  El ganador cobra <b>${groupSettings.greensPay}</b> a cada jugador del grupo.
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <hr style={hr} />

      <button onClick={addPlayer} disabled={players.length >= 6} style={btnPrimary}>
        + Agregar jugador ({players.length}/6)
      </button>

      {/* Score table */}
      <div style={{ marginTop: 14, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1100 }}>
          <thead>
            <tr>
              <th style={thSticky}>Jugador</th>

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
              <th style={thStickySmall}>Hcp</th>

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

              // Net/STB use % global
              const adj = buildHcpAdjustments(p.hcp || 0, hcpPercent, course.strokeIndexes);
              const netF9 = sumNet9(arr, adj, 0);
              const netB9 = sumNet9(arr, adj, 9);
              const netT = netF9 + netB9;

              const stbF9 = sumStableford9(arr, course.parValues, adj, 0);
              const stbB9 = sumStableford9(arr, course.parValues, adj, 9);
              const stbT = stbF9 + stbB9;

              const effHcp = Math.round((p.hcp || 0) * (Number(hcpPercent) / 100));

              return (
                <tr key={p.id} style={{ borderTop: "1px solid #2a2a2a" }}>
                  <td style={tdSticky}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <input
                        defaultValue={p.name}
                        onBlur={(e) => updatePlayer(p.id, "name", e.target.value)}
                        style={inputName}
                      />

                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <input
                          type="number"
                          defaultValue={p.hcp}
                          onBlur={(e) => updatePlayer(p.id, "hcp", parseFloat(e.target.value || "0"))}
                          style={inputHcp}
                        />
                        <span style={{ fontSize: 12, opacity: 0.75, fontWeight: 900 }}>
                          eff {hcpPercent}%: <b>{effHcp}</b>
                        </span>

                        <button onClick={() => removePlayer(p.id)} style={btnDanger}>
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

      <hr style={hr} />

      {/* Matches */}
      <section style={{ marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 8px 0" }}>Matches (por pareja)</h2>

        {players.length < 2 ? (
          <div style={{ opacity: 0.7 }}>Agrega al menos 2 jugadores.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 980 }}>
              <thead>
                <tr>
                  <th style={thLeft}>Match</th>
                  <th style={th}>Bet</th>
                  <th style={th}>Doblada F9</th>
                  <th style={th}>Doblada B9</th>
                  <th style={th}>F9</th>
                  <th style={th}>B9</th>
                  <th style={th}>Total</th>
                  <th style={th}>$F9</th>
                  <th style={th}>$B9</th>
                  <th style={th}>$T</th>
                  <th style={thStrong}>$Total</th>
                </tr>
              </thead>
              <tbody>
                {matchesList.map((m) => {
                  const aWins = m.pairRes.total > 0;
                  const bWins = m.pairRes.total < 0;
                  const color = aWins ? "#86efac" : bWins ? "#fca5a5" : "#d4d4d4";

                  return (
                    <tr key={m.key} style={{ borderTop: "1px solid #222" }}>
                      <td style={tdLeft}>
                        <b>{m.a.name}</b> vs <b>{m.b.name}</b>
                        <div style={{ opacity: 0.65, fontSize: 12, marginTop: 4 }}>
                          diff HCP: <b>{m.pairRes.diff}</b> (matches 100%)
                        </div>
                      </td>

                      <td style={td}>
                        <input
                          type="number"
                          defaultValue={m.bet.amount}
                          onBlur={(e) => setBetAmount(m.a.id, m.b.id, e.target.value)}
                          style={inputBet}
                        />
                      </td>

                      <td style={td}>
                        <input
                          type="checkbox"
                          checked={!!m.dbl.f9}
                          onChange={(e) => toggleDoblada(m.a.id, m.b.id, "f9", e.target.checked)}
                        />
                      </td>

                      <td style={td}>
                        <input
                          type="checkbox"
                          checked={!!m.dbl.b9}
                          onChange={(e) => toggleDoblada(m.a.id, m.b.id, "b9", e.target.checked)}
                        />
                      </td>

                      <td style={{ ...td, fontWeight: 900, color }}>{fmtMatch(m.pairRes.front)}</td>
                      <td style={{ ...td, fontWeight: 900, color }}>{fmtMatch(m.pairRes.back)}</td>
                      <td style={{ ...td, fontWeight: 900, color }}>{fmtMatch(m.pairRes.total)}</td>

                      <td style={td}>{fmtMoney(m.money.moneyF9)}</td>
                      <td style={td}>{fmtMoney(m.money.moneyB9)}</td>
                      <td style={td}>{fmtMoney(m.money.moneyT)}</td>
                      <td style={{ ...tdStrong, color }}>{fmtMoney(m.money.moneyTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div style={{ opacity: 0.65, fontSize: 12, marginTop: 8 }}>
              Doblada = multiplica x2 ese segmento (checkbox libre).
            </div>
          </div>
        )}
      </section>

      <hr style={hr} />

      {/* Money by player */}
      <section style={{ marginBottom: 20 }}>
        <h2 style={{ margin: "0 0 8px 0" }}>Totales por jugador (grupo)</h2>

        {players.length === 0 ? (
          <div style={{ opacity: 0.7 }}>Agrega jugadores.</div>
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
                  <tr key={r.id} style={{ borderTop: "1px solid #222" }}>
                    <td style={tdLeft}><b>{r.name}</b></td>
                    <td style={td}>{fmtMoney(r.matches)}</td>
                    <td style={td}>{fmtMoney(r.greens)}</td>
                    <td style={td}>{fmtMoney(r.bonus)}</td>
                    <td style={{ ...tdStrong, color: r.total > 0 ? "#86efac" : r.total < 0 ? "#fca5a5" : "white" }}>
                      {fmtMoney(r.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ opacity: 0.65, fontSize: 12, marginTop: 8 }}>
              Bonus y Greens son zero-sum dentro del grupo. Bola Rosa por ahora no entra a dinero.
            </div>
          </div>
        )}
      </section>
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
  if (cat === "albatross") return { borderColor: "#ff77c8", background: "#2a0f22" }; // rosa
  if (cat === "eagle") return { borderColor: "#7dffb0", background: "#0d2417" };     // verde
  if (cat === "birdie") return { borderColor: "#ffb15c", background: "#2a1b0b" };    // naranja
  if (cat === "bogey") return { borderColor: "#7aa7ff", background: "#0f182a" };     // azul
  if (cat === "double") return { borderColor: "#ff6b6b", background: "#2a0f0f" };    // rojo
  return {};
}

function fmtMatch(v) {
  if (v === 0) return "AS";
  if (v > 0) return `+${v}`;
  return `${v}`;
}
function fmtMoney(n) {
  const x = Number(n || 0);
  if (x === 0) return "$0";
  return x > 0 ? `+$${Math.round(x)}` : `-$${Math.abs(Math.round(x))}`;
}

// ---------- styles ----------
const page = { padding: 16, fontFamily: "system-ui", maxWidth: 1100, margin: "0 auto", color: "white" };

const header = {
  display: "flex",
  gap: 12,
  alignItems: "flex-start",
  position: "sticky",
  top: 0,
  zIndex: 15,
  background: "#0b0b0b",
  paddingBottom: 10,
  borderBottom: "1px solid #1f1f1f",
};

const payoutRow = { marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" };

const pill = { padding: "10px 12px", borderRadius: 16, border: "1px solid #242424", background: "#0f0f0f", minWidth: 140 };
const pillLabel = { opacity: 0.75, fontSize: 12, fontWeight: 900 };
const pillInput = { marginTop: 6, width: "100%", padding: "10px 10px", borderRadius: 12, border: "1px solid #2a2a2a", background: "#111", color: "white", fontWeight: 900 };

const card = { border: "1px solid #2a2a2a", borderRadius: 18, padding: 14, background: "#0f0f0f" };
const select = { padding: "10px 12px", borderRadius: 14, border: "1px solid #2a2a2a", background: "#111", color: "white", fontWeight: 900, width: "100%" };

const hr = { margin: "14px 0", borderColor: "#2a2a2a" };

const th = { textAlign: "center", padding: 8, background: "#1a1a1a", color: "white", fontWeight: 800, borderBottom: "1px solid #2a2a2a", whiteSpace: "nowrap" };
const thLeft = { ...th, textAlign: "left" };
const thMuted = { ...th, opacity: 0.7, fontWeight: 700, fontSize: 12 };
const thStrong = { ...th, background: "#111827" };

const thSticky = { ...th, position: "sticky", left: 0, zIndex: 2, textAlign: "left", minWidth: 260 };
const thStickySmall = { ...thMuted, position: "sticky", left: 0, zIndex: 2, textAlign: "left" };

const td = { padding: 8, textAlign: "center", background: "#0f0f0f", color: "white" };
const tdLeft = { ...td, textAlign: "left" };
const tdSticky = { ...td, position: "sticky", left: 0, zIndex: 1, textAlign: "left", minWidth: 260 };
const tdStrong = { ...td, fontWeight: 900, background: "#0b1220" };
const tdMutedCell = { ...td, opacity: 0.9, background: "#0b0b0b", fontWeight: 900 };

const inputName = { width: "100%", padding: "10px 10px", borderRadius: 12, border: "1px solid #2a2a2a", background: "#111", color: "white", fontWeight: 800 };
const inputHcp = { width: 80, padding: "8px 10px", borderRadius: 12, border: "1px solid #2a2a2a", background: "#111", color: "white", fontWeight: 700 };
const inputScore = { width: 42, padding: "8px 6px", borderRadius: 10, border: "1px solid #2a2a2a", background: "#111", color: "white", textAlign: "center", fontWeight: 700 };

const inputBet = { width: 90, padding: "8px 10px", borderRadius: 12, border: "1px solid #2a2a2a", background: "#111", color: "white", textAlign: "center", fontWeight: 900 };

const btn = { padding: "10px 14px", borderRadius: 14, border: "1px solid #2a2a2a", background: "#141414", color: "white", fontWeight: 900, cursor: "pointer" };
const btnPrimary = { ...btn, background: "#1f2937", border: "1px solid #374151" };
const btnDanger = { padding: "8px 10px", borderRadius: 12, border: "1px solid #3a1a1a", background: "#1a0f0f", color: "#ffb4b4", fontWeight: 800 };
