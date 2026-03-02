// src/screens/GroupScorecard.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import html2canvas from "html2canvas";
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
  fmtMoney,
  fmtMatch,
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
  greensPay: 10,
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

  const [session, setSession] = useState(null);
  const [settings, setSettings] = useState(null);
  const [groupMeta, setGroupMeta] = useState(null);
  const [state, setState] = useState(undefined);

  const [saving, setSaving] = useState(false);
  const [editingScores, setEditingScores] = useState({});
  const [screenshotMode, setScreenshotMode] = useState(false);

  // Collapsables (mobile-first)
  const [openPlayers, setOpenPlayers] = useState(true);
  const [openPayouts, setOpenPayouts] = useState(false);
  const [openGreens, setOpenGreens] = useState(false);
  const [openMatches, setOpenMatches] = useState(false);
  const [openTotals, setOpenTotals] = useState(false);

  const captureRef = useRef(null);

  const sessionRef = useMemo(() => (sessionId ? doc(db, "sessions", sessionId) : null), [sessionId]);
  const settingsRef = useMemo(() => (sessionId ? doc(db, "sessions", sessionId, "settings", "main") : null), [sessionId]);
  const groupRef = useMemo(() => (sessionId && groupId ? doc(db, "sessions", sessionId, "groups", groupId) : null), [sessionId, groupId]);
  const stateRef = useMemo(
    () => (sessionId && groupId ? doc(db, "sessions", sessionId, "groups", groupId, "state", "main") : null),
    [sessionId, groupId]
  );

  useEffect(() => {
    if (!sessionRef) return;
    return onSnapshot(sessionRef, (snap) => setSession(snap.exists() ? { id: snap.id, ...snap.data() } : null));
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
  const hcpPercent = session?.hcpPercent ?? 100;
  const course = COURSE_DATA[courseId] || COURSE_DATA["campestre-slp"];
  const bolaRosaEnabled = !!settings?.bolaRosaEnabled;

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

  const exportPNG = async () => {
    const el = captureRef.current;
    if (!el) return;

    try {
      const canvas = await html2canvas(el, {
        scale: 2,
        backgroundColor: null,
        useCORS: true,
      });

      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${groupMeta?.name || groupId || "grupo"}_${sessionId || "session"}.png`;
      a.click();
    } catch (e) {
      console.error(e);
      alert("No pude exportar PNG. Revisa consola.");
    }
  };

  if (!sessionId || !groupId) return <div style={fallback}>Faltan parámetros.</div>;
  if (!groupMeta || state === undefined || !session) return <div style={fallback}>Cargando grupo...</div>;
  if (state === null) return <div style={fallback}>No pude crear state/main (revisa reglas).</div>;

  // ===== Money inside group =====
  const bonusByPlayer = computeBonusMoneyByPlayer({ players, scores, parValues: course.parValues, groupSettings });
  const greensByPlayer = computeGreensMoneyByPlayer({ players, greens, greensPay: groupSettings.greensPay ?? 0 });
  const matchesByPlayer = computeMatchesMoneyByPlayer({ players, scores, courseId, matchBets, dobladas });

  const moneyRows = players.map((p) => {
    const bonus = bonusByPlayer[p.id] || 0;
    const g = greensByPlayer[p.id] || 0;
    const m = matchesByPlayer[p.id] || 0;
    return { id: p.id, name: p.name || p.id, matches: m, greens: g, bonus, total: m + g + bonus };
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

      const pairRes = computeMatchResultForPair({ a, b, scores, courseId });
      const money = calcMatchMoneyForPair({ pairResult: pairRes, matchBetsForPair: bet, dobladasForPair: dbl });

      matchesList.push({ key, a, b, pairRes, bet, dbl, money });
    }
  }

  const subtitle = `${course.name} · %Hcp ${hcpPercent} · ${players.length}/6 jugadores`;

  return (
    <div style={page}>
      <style>{baseCss}</style>

      {/* App Bar */}
      <div style={appBar}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <button onClick={() => navigate(`/session/${sessionId}`)} style={iconBtn} aria-label="Volver">
            ←
          </button>

          <div style={{ minWidth: 0 }}>
            <div style={titleRow}>
              <div style={titleText}>{groupMeta?.name || groupId}</div>
              {saving ? <div style={savingPill}>Guardando…</div> : null}
            </div>
            <div style={subText}>{subtitle}</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setScreenshotMode((s) => !s)} style={chipBtn}>
            {screenshotMode ? "Normal" : "Screenshot"}
          </button>
          <button onClick={exportPNG} style={chipBtnPrimary}>
            Export
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={content}>
        {/* CAPTURE AREA (para png) */}
        <div ref={captureRef}>
          {/* Scorecard PRIMERO (siempre visible) */}
          <section style={section}>
            <div style={sectionHead}>
              <div style={sectionTitle}>Scorecard</div>
              {!screenshotMode ? (
                <button onClick={addPlayer} disabled={players.length >= 6} style={smallPrimaryBtn}>
                  + Jugador
                </button>
              ) : null}
            </div>

            {/* Score table */}
            <div style={tableWrap}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={thSticky}>Jugador</th>

                    {Array.from({ length: 9 }).map((_, i) => (
                      <th key={`h-${i}`} style={th}>
                        {i + 1}
                      </th>
                    ))}
                    <th style={thStrong}>F9</th>

                    {Array.from({ length: 9 }).map((_, i) => (
                      <th key={`h2-${i}`} style={th}>
                        {i + 10}
                      </th>
                    ))}
                    <th style={thStrong}>B9</th>

                    <th style={thStrong}>Tot</th>
                    <th style={thMuted}>Net</th>
                    <th style={thMuted}>STB</th>
                  </tr>

                  <tr>
                    <th style={thStickySmall}>Hcp</th>

                    {course.parValues.slice(0, 9).map((p, i) => (
                      <th key={`pf-${i}`} style={thMuted}>
                        Par {p}
                      </th>
                    ))}
                    <th style={thMuted}></th>

                    {course.parValues.slice(9).map((p, i) => (
                      <th key={`pb-${i}`} style={thMuted}>
                        Par {p}
                      </th>
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
                      <tr key={p.id} style={tr}>
                        <td style={tdSticky}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <input
                              defaultValue={p.name}
                              onBlur={(e) => updatePlayer(p.id, "name", e.target.value)}
                              style={inputName}
                              disabled={screenshotMode}
                            />

                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <input
                                type="number"
                                defaultValue={p.hcp}
                                onBlur={(e) => updatePlayer(p.id, "hcp", parseFloat(e.target.value || "0"))}
                                style={inputHcp}
                                disabled={screenshotMode}
                              />
                              <span style={effText}>
                                eff {hcpPercent}%: <b style={{ color: "white" }}>{effHcp}</b>
                              </span>

                              {!screenshotMode ? (
                                <button onClick={() => removePlayer(p.id)} style={smallDangerBtn}>
                                  Quitar
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </td>

                        {Array.from({ length: 9 }).map((_, h) => {
                          const shown =
                            editingScores?.[p.id]?.[h] !== undefined ? editingScores[p.id][h] : arr[h] ?? "";
                          const cat = scoreCategory(shown, course.parValues[h]);
                          return (
                            <td key={`sf-${p.id}-${h}`} style={td}>
                              <input
                                inputMode="numeric"
                                value={shown}
                                onChange={(e) => onScoreChange(p.id, h, e.target.value)}
                                onBlur={() => onScoreBlur(p.id, h)}
                                style={{ ...inputScore, ...scoreStyleDark(cat) }}
                                disabled={screenshotMode}
                              />
                            </td>
                          );
                        })}
                        <td style={tdStrong}>{grossF9 || ""}</td>

                        {Array.from({ length: 9 }).map((_, i) => {
                          const h = i + 9;
                          const shown =
                            editingScores?.[p.id]?.[h] !== undefined ? editingScores[p.id][h] : arr[h] ?? "";
                          const cat = scoreCategory(shown, course.parValues[h]);
                          return (
                            <td key={`sb-${p.id}-${h}`} style={td}>
                              <input
                                inputMode="numeric"
                                value={shown}
                                onChange={(e) => onScoreChange(p.id, h, e.target.value)}
                                onBlur={() => onScoreBlur(p.id, h)}
                                style={{ ...inputScore, ...scoreStyleDark(cat) }}
                                disabled={screenshotMode}
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

                  {players.length === 0 ? (
                    <tr>
                      <td style={{ ...tdSticky, padding: 14 }} colSpan={1}>
                        <div style={{ opacity: 0.8, fontWeight: 800 }}>Agrega jugadores para empezar.</div>
                      </td>
                      <td style={{ padding: 14 }} colSpan={22}></td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            {!screenshotMode ? (
              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <InfoChip label="Tips" value="Desliza horizontal para hoyos" />
                <InfoChip label="Safe" value="Inputs estables (sin flicker)" />
              </div>
            ) : null}
          </section>

          {/* COLLAPSABLES (no estorban el scorecard) */}
          {!screenshotMode ? (
            <>
              <Collapsible
                title="Ajustes del grupo"
                subtitle="Pagos Birdie/Eagle/Alb/Greens"
                open={openPayouts}
                setOpen={setOpenPayouts}
              >
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <PayoutInputDark
                    label="Birdie"
                    value={groupSettings.birdiePay ?? 0}
                    onBlur={(v) => updateGroupSetting("birdiePay", v)}
                  />
                  <PayoutInputDark
                    label="Eagle"
                    value={groupSettings.eaglePay ?? 0}
                    onBlur={(v) => updateGroupSetting("eaglePay", v)}
                  />
                  <PayoutInputDark
                    label="Albatross / HIO"
                    value={groupSettings.albatrossPay ?? 0}
                    onBlur={(v) => updateGroupSetting("albatrossPay", v)}
                  />
                  <PayoutInputDark
                    label="Greens"
                    value={groupSettings.greensPay ?? 0}
                    onBlur={(v) => updateGroupSetting("greensPay", v)}
                  />
                </div>

                <div style={hint}>
                  Estos pagos se usan para calcular <b>bonus</b> y <b>greens</b> dentro del grupo.
                </div>
              </Collapsible>

              <Collapsible
                title="Greens (Par 3) + Bola Rosa"
                subtitle={`Hoyos par 3: ${par3Holes.join(", ") || "—"}`}
                open={openGreens}
                setOpen={setOpenGreens}
              >
                {bolaRosaEnabled ? (
                  <div style={{ marginBottom: 12 }}>
                    <div style={label}>Bola Rosa</div>
                    <select
                      value={bolaRosa}
                      onChange={(e) => setBolaRosa(e.target.value)}
                      style={selectDark}
                      disabled={players.length === 0}
                    >
                      <option value="">— Sin ganador —</option>
                      {players.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {players.length < 2 ? (
                  <div style={{ opacity: 0.78 }}>Agrega al menos 2 jugadores para seleccionar ganadores.</div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    {par3Holes.map((holeNumber) => (
                      <div key={holeNumber} style={cardDark}>
                        <div style={{ fontWeight: 900, marginBottom: 8 }}>Hoyo {holeNumber}</div>
                        <select
                          value={greens[String(holeNumber)] || ""}
                          onChange={(e) => setGreenWinner(holeNumber, e.target.value)}
                          style={selectDark}
                        >
                          <option value="">— Sin ganador —</option>
                          {players.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <div style={hintSmall}>
                          El ganador cobra <b>${groupSettings.greensPay}</b> a cada jugador del grupo.
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Collapsible>

              <Collapsible
                title="Matches"
                subtitle="Bet + Doblada F9/B9 · mostramos solo $Total"
                open={openMatches}
                setOpen={setOpenMatches}
              >
                {players.length < 2 ? (
                  <div style={{ opacity: 0.78 }}>Agrega al menos 2 jugadores.</div>
                ) : (
                  <div style={{ display: "grid", gap: 12 }}>
                    {matchesList.map((m) => (
                      <MatchCardDark
                        key={m.key}
                        m={m}
                        onBet={(raw) => setBetAmount(m.a.id, m.b.id, raw)}
                        onDbl={(seg, checked) => toggleDoblada(m.a.id, m.b.id, seg, checked)}
                      />
                    ))}
                  </div>
                )}
              </Collapsible>

              <Collapsible
                title="Totales por jugador"
                subtitle="Matches + Greens + Bonus"
                open={openTotals}
                setOpen={setOpenTotals}
              >
                {players.length === 0 ? (
                  <div style={{ opacity: 0.78 }}>Agrega jugadores.</div>
                ) : (
                  <div style={totalsList}>
                    {moneyRows.map((r) => {
                      const color = r.total > 0 ? "#22c55e" : r.total < 0 ? "#ef4444" : "#e5e7eb";
                      return (
                        <div key={r.id} style={totalRow}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                            <div style={{ fontWeight: 900, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                              {r.name}
                            </div>
                            <div style={{ fontWeight: 1000, color }}>{fmtMoney(r.total)}</div>
                          </div>

                          <div style={miniGrid}>
                            <MiniStat label="Matches" value={fmtMoney(r.matches)} />
                            <MiniStat label="Greens" value={fmtMoney(r.greens)} />
                            <MiniStat label="Bonus" value={fmtMoney(r.bonus)} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Collapsible>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Components ---------------- */

function Collapsible({ title, subtitle, open, setOpen, children }) {
  return (
    <section style={{ ...section, marginTop: 12 }}>
      <button onClick={() => setOpen(!open)} style={collapsibleHead}>
        <div style={{ minWidth: 0 }}>
          <div style={sectionTitle}>{title}</div>
          {subtitle ? <div style={subText2}>{subtitle}</div> : null}
        </div>
        <div style={chev}>{open ? "▾" : "▸"}</div>
      </button>

      {open ? <div style={collapsibleBody}>{children}</div> : null}
    </section>
  );
}

function MatchCardDark({ m, onBet, onDbl }) {
  const aWins = m.pairRes.total > 0;
  const bWins = m.pairRes.total < 0;
  const accent = aWins ? "#22c55e" : bWins ? "#ef4444" : "#94a3b8";

  return (
    <div style={matchCardDark}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 950, fontSize: 15, lineHeight: 1.15 }}>
            <span style={{ color: "white" }}>{m.a.name}</span>{" "}
            <span style={{ opacity: 0.55, fontWeight: 900 }}>vs</span>{" "}
            <span style={{ color: "white" }}>{m.b.name}</span>
          </div>
          <div style={hintSmall}>
            diff HCP: <b style={{ color: "white" }}>{m.pairRes.diff}</b>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={miniFieldDark}>
            <div style={miniLabel}>Bet</div>
            <input
              type="number"
              defaultValue={m.bet.amount}
              onBlur={(e) => onBet(e.target.value)}
              style={miniInputDark}
              inputMode="numeric"
            />
          </div>
        </div>
      </div>

      <div style={toggleRow}>
        <label style={checkPillDark}>
          <input type="checkbox" checked={!!m.dbl.f9} onChange={(e) => onDbl("f9", e.target.checked)} />
          <span style={{ fontWeight: 900 }}>Doblada F9</span>
        </label>

        <label style={checkPillDark}>
          <input type="checkbox" checked={!!m.dbl.b9} onChange={(e) => onDbl("b9", e.target.checked)} />
          <span style={{ fontWeight: 900 }}>Doblada B9</span>
        </label>
      </div>

      <div style={scoreStripWrapDark}>
        <div style={scoreStripHeadDark}>
          <div style={scoreStripH}>F9</div>
          <div style={scoreStripH}>B9</div>
          <div style={scoreStripH}>Total</div>
        </div>

        <div style={scoreStripBodyDark}>
          <div style={{ ...scoreStripV, color: accent }}>{fmtMatch(m.pairRes.front)}</div>
          <div style={{ ...scoreStripV, color: accent }}>{fmtMatch(m.pairRes.back)}</div>
          <div style={{ ...scoreStripV, color: accent }}>{fmtMatch(m.pairRes.total)}</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
        <div style={{ ...moneyPillDark, borderColor: accent, color: accent }}>
          {fmtMoney(m.money.moneyTotal)} <span style={{ opacity: 0.75, fontWeight: 900 }}>total</span>
        </div>
      </div>
    </div>
  );
}

function PayoutInputDark({ label, value, onBlur }) {
  return (
    <div style={pillDark}>
      <div style={pillLabelDark}>{label}</div>
      <input
        type="number"
        defaultValue={value}
        onBlur={(e) => onBlur(e.target.value)}
        style={pillInputDark}
        inputMode="numeric"
      />
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div style={miniStat}>
      <div style={{ opacity: 0.75, fontSize: 11, fontWeight: 900 }}>{label}</div>
      <div style={{ fontWeight: 1000, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function InfoChip({ label, value }) {
  return (
    <div style={infoChip}>
      <div style={{ opacity: 0.75, fontSize: 11, fontWeight: 900 }}>{label}</div>
      <div style={{ fontWeight: 900 }}>{value}</div>
    </div>
  );
}

function scoreStyleDark(cat) {
  // Dark + subtle accents
  if (cat === "albatross") return { borderColor: "rgba(255,119,200,0.9)", background: "rgba(255,119,200,0.14)" };
  if (cat === "eagle") return { borderColor: "rgba(34,197,94,0.9)", background: "rgba(34,197,94,0.14)" };
  if (cat === "birdie") return { borderColor: "rgba(251,146,60,0.95)", background: "rgba(251,146,60,0.14)" };
  if (cat === "bogey") return { borderColor: "rgba(96,165,250,0.9)", background: "rgba(96,165,250,0.14)" };
  if (cat === "double") return { borderColor: "rgba(239,68,68,0.9)", background: "rgba(239,68,68,0.14)" };
  return {};
}

/* ---------------- Styles (mobile-first, premium dark) ---------------- */

const baseCss = `
  * { box-sizing: border-box; }
  input, button, select { font: inherit; }
  input:focus, select:focus { outline: none; }
  table { border-spacing: 0; }
`;

const page = {
  minHeight: "100%",
  background: "radial-gradient(1200px 700px at 10% 0%, rgba(59,130,246,0.10) 0%, rgba(0,0,0,0) 45%), #05070b",
  color: "#e5e7eb",
  paddingTop: "env(safe-area-inset-top)",
  paddingBottom: "env(safe-area-inset-bottom)",
  paddingLeft: "env(safe-area-inset-left)",
  paddingRight: "env(safe-area-inset-right)",
};

const content = {
  padding: 12,
  paddingTop: 10,
  maxWidth: 1100,
  margin: "0 auto",
};

const fallback = { padding: 20, color: "white", background: "#05070b", minHeight: "100vh" };

const appBar = {
  position: "sticky",
  top: 0,
  zIndex: 50,
  padding: "10px 12px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  backdropFilter: "blur(14px)",
  background: "rgba(5,7,11,0.70)",
  borderBottom: "1px solid rgba(148,163,184,0.14)",
};

const titleRow = { display: "flex", alignItems: "center", gap: 10, minWidth: 0 };
const titleText = {
  fontSize: 16,
  fontWeight: 1000,
  letterSpacing: -0.4,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: 220,
};
const subText = { fontSize: 12, opacity: 0.75, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

const savingPill = {
  fontSize: 11,
  fontWeight: 900,
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(59,130,246,0.25)",
  background: "rgba(59,130,246,0.12)",
  color: "#bfdbfe",
};

const iconBtn = {
  width: 38,
  height: 38,
  borderRadius: 14,
  border: "1px solid rgba(148,163,184,0.18)",
  background: "rgba(15,23,42,0.55)",
  color: "white",
  fontWeight: 1000,
};

const chipBtn = {
  height: 38,
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
};

const sectionHead = {
  padding: "12px 12px 10px 12px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  borderBottom: "1px solid rgba(148,163,184,0.12)",
};

const sectionTitle = { fontSize: 14, fontWeight: 1000, letterSpacing: -0.2, color: "white" };
const subText2 = { marginTop: 2, fontSize: 12, opacity: 0.72 };

const smallPrimaryBtn = {
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid rgba(59,130,246,0.35)",
  background: "rgba(59,130,246,0.18)",
  color: "#dbeafe",
  fontWeight: 950,
};

const smallDangerBtn = {
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid rgba(239,68,68,0.30)",
  background: "rgba(239,68,68,0.12)",
  color: "#fecaca",
  fontWeight: 950,
};

const collapsibleHead = {
  width: "100%",
  padding: "12px 12px 12px 12px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  background: "transparent",
  color: "#e5e7eb",
  border: "none",
  textAlign: "left",
};

const chev = { fontSize: 18, opacity: 0.8, fontWeight: 900 };
const collapsibleBody = { padding: 12, paddingTop: 0 };

const tableWrap = { overflowX: "auto", WebkitOverflowScrolling: "touch" };

const table = {
  width: "100%",
  minWidth: 980,
  borderCollapse: "separate",
  borderSpacing: 0,
};

const th = {
  textAlign: "center",
  padding: 8,
  fontSize: 12,
  color: "rgba(226,232,240,0.85)",
  fontWeight: 900,
  background: "rgba(2,6,23,0.35)",
  borderBottom: "1px solid rgba(148,163,184,0.12)",
  whiteSpace: "nowrap",
};

const thMuted = { ...th, opacity: 0.65, fontWeight: 800, fontSize: 11 };
const thStrong = { ...th, color: "#dbeafe", background: "rgba(59,130,246,0.10)" };

const thSticky = {
  ...th,
  position: "sticky",
  left: 0,
  zIndex: 2,
  textAlign: "left",
  minWidth: 250,
  background: "rgba(2,6,23,0.75)",
  backdropFilter: "blur(10px)",
};

const thStickySmall = {
  ...thMuted,
  position: "sticky",
  left: 0,
  zIndex: 2,
  textAlign: "left",
  minWidth: 250,
  background: "rgba(2,6,23,0.75)",
  backdropFilter: "blur(10px)",
};

const tr = { borderTop: "1px solid rgba(148,163,184,0.10)" };

const td = {
  padding: 8,
  textAlign: "center",
  background: "rgba(15,23,42,0.20)",
  color: "#e5e7eb",
  borderBottom: "1px solid rgba(148,163,184,0.08)",
};

const tdSticky = {
  ...td,
  position: "sticky",
  left: 0,
  zIndex: 1,
  textAlign: "left",
  minWidth: 250,
  background: "rgba(2,6,23,0.78)",
  backdropFilter: "blur(10px)",
};

const tdStrong = { ...td, fontWeight: 1000, background: "rgba(59,130,246,0.10)", color: "#dbeafe" };
const tdMutedCell = { ...td, opacity: 0.95, background: "rgba(148,163,184,0.06)", fontWeight: 1000 };

const inputName = {
  width: "100%",
  padding: "10px 10px",
  borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(15,23,42,0.55)",
  color: "white",
  fontWeight: 950,
};

const inputHcp = {
  width: 80,
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(15,23,42,0.55)",
  color: "white",
  fontWeight: 900,
};

const inputScore = {
  width: 42,
  height: 42,
  padding: "8px 6px",
  borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.16)",
  background: "rgba(15,23,42,0.55)",
  color: "white",
  textAlign: "center",
  fontWeight: 1000,
};

const effText = { fontSize: 12, opacity: 0.75, fontWeight: 900 };

const label = { fontWeight: 950, marginBottom: 6, color: "white" };

const hint = {
  marginTop: 10,
  fontSize: 12,
  opacity: 0.78,
  borderTop: "1px solid rgba(148,163,184,0.10)",
  paddingTop: 10,
};

const hintSmall = { marginTop: 8, fontSize: 12, opacity: 0.75 };

const selectDark = {
  padding: "12px 12px",
  borderRadius: 14,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(15,23,42,0.55)",
  color: "white",
  fontWeight: 950,
  width: "100%",
};

const pillDark = {
  padding: "10px 12px",
  borderRadius: 16,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(2,6,23,0.35)",
};

const pillLabelDark = { opacity: 0.78, fontSize: 12, fontWeight: 950 };
const pillInputDark = {
  marginTop: 6,
  width: "100%",
  padding: "12px 10px",
  borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(15,23,42,0.55)",
  color: "white",
  fontWeight: 1000,
  textAlign: "center",
};

const cardDark = {
  border: "1px solid rgba(148,163,184,0.14)",
  borderRadius: 16,
  padding: 12,
  background: "rgba(2,6,23,0.35)",
};

const matchCardDark = {
  borderRadius: 18,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(2,6,23,0.35)",
  padding: 12,
};

const toggleRow = { display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" };

const checkPillDark = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(15,23,42,0.45)",
  userSelect: "none",
};

const miniFieldDark = {
  minWidth: 120,
  borderRadius: 14,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(15,23,42,0.45)",
  padding: "10px 12px",
};

const miniLabel = { fontSize: 12, fontWeight: 950, opacity: 0.75 };
const miniInputDark = {
  marginTop: 6,
  width: "100%",
  padding: "10px 10px",
  borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(2,6,23,0.35)",
  color: "white",
  fontWeight: 1000,
  textAlign: "center",
};

const scoreStripWrapDark = {
  marginTop: 12,
  borderRadius: 16,
  overflow: "hidden",
  border: "1px solid rgba(148,163,184,0.14)",
};

const scoreStripHeadDark = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  background: "rgba(15,23,42,0.55)",
};

const scoreStripBodyDark = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  background: "rgba(2,6,23,0.25)",
};

const scoreStripH = {
  padding: "10px 10px",
  textAlign: "center",
  fontWeight: 950,
  letterSpacing: -0.2,
  opacity: 0.9,
};

const scoreStripV = {
  padding: "14px 10px",
  textAlign: "center",
  fontWeight: 1000,
  fontSize: 22,
  letterSpacing: -0.6,
};

const moneyPillDark = {
  padding: "10px 12px",
  borderRadius: 16,
  border: "2px solid rgba(148,163,184,0.14)",
  background: "rgba(15,23,42,0.45)",
  fontWeight: 1000,
};

const totalsList = { display: "grid", gap: 10 };
const totalRow = {
  borderRadius: 16,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(2,6,23,0.35)",
  padding: 12,
};

const miniGrid = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8, marginTop: 10 };

const miniStat = {
  borderRadius: 14,
  border: "1px solid rgba(148,163,184,0.10)",
  background: "rgba(15,23,42,0.45)",
  padding: 10,
};

const infoChip = {
  borderRadius: 999,
  border: "1px solid rgba(148,163,184,0.12)",
  background: "rgba(2,6,23,0.35)",
  padding: "8px 10px",
  display: "flex",
  gap: 8,
  alignItems: "baseline",
};
