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

/* ---------------- Helpers ---------------- */

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
  carryF9ToTotal: false,
  carryB9ToTotal: false,
};

const DEFAULT_BET_AMOUNT = 50;

const DEFAULT_STATE = {
  players: [],
  scores: {},
  groupSettings: { ...DEFAULT_GROUP_SETTINGS },
  matchBets: {},
  dobladas: {},
  greens: {},
  bolaRosa: "",
  manualMatchDiffs: {},
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
};

function sanitizeSignedNumberStr(raw) {
  const s = String(raw ?? "").trim();
  if (s === "" || s === "-" || s === "." || s === "-.") return "";
  let out = "";
  let dot = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (i === 0 && ch === "-") {
      out += "-";
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      out += ch;
      continue;
    }
    if (ch === "." && !dot) {
      dot = true;
      out += ".";
      continue;
    }
  }
  if (out === "" || out === "-" || out === "." || out === "-.") return "";
  return out;
}

function toSignedNumber(raw, fallback = 0) {
  const s = sanitizeSignedNumberStr(raw);
  if (s === "") return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeNonNegIntStr(raw) {
  const s = String(raw ?? "").trim();
  if (s === "") return "";
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch >= "0" && ch <= "9") out += ch;
  }
  return out;
}

function toNonNegInt(raw, fallback = 0) {
  const s = sanitizeNonNegIntStr(raw);
  if (s === "") return fallback;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}

function sanitizeScoreStr(raw, maxLen = 2) {
  const s = String(raw ?? "");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch >= "0" && ch <= "9") out += ch;
  }
  if (maxLen && out.length > maxLen) out = out.slice(0, maxLen);
  return out;
}

function getStoredTheme() {
  try {
    const v = localStorage.getItem("apuestasGolf_groupTheme");
    return v === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function segmentColorClass(v) {
  if (v > 0) return "seg-pos";
  if (v < 0) return "seg-neg";
  return "seg-as";
}

/* ---------------- Screen ---------------- */

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
  const [themeMode, setThemeMode] = useState(getStoredTheme());

  const [syncPending, setSyncPending] = useState(false);
  const [fromCache, setFromCache] = useState(false);

  const [stickyCompact, setStickyCompact] = useState(false);
  const tableWrapRef = useRef(null);

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
    try {
      localStorage.setItem("apuestasGolf_groupTheme", themeMode);
    } catch {}
  }, [themeMode]);

  useEffect(() => {
    if (!sessionRef) return;
    return onSnapshot(sessionRef, { includeMetadataChanges: true }, (snap) => {
      setSession(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
  }, [sessionRef]);

  useEffect(() => {
    if (!settingsRef) return;
    return onSnapshot(settingsRef, { includeMetadataChanges: true }, (snap) => {
      setSettings(snap.exists() ? snap.data() : null);
    });
  }, [settingsRef]);

  useEffect(() => {
    if (!groupRef) return;
    return onSnapshot(groupRef, { includeMetadataChanges: true }, (snap) => {
      setGroupMeta(snap.exists() ? snap.data() : null);
    });
  }, [groupRef]);

  useEffect(() => {
    if (!stateRef) return;

    const unsub = onSnapshot(
      stateRef,
      { includeMetadataChanges: true },
      async (snap) => {
        setSyncPending(snap.metadata.hasPendingWrites);
        setFromCache(snap.metadata.fromCache);

        if (snap.exists()) {
          const data = snap.data();

          const rawPlayers = Array.isArray(data.players) ? data.players : [];
          const migratedPlayers = rawPlayers.map((p) => ({
            ...p,
            bonusesEnabled: typeof p?.bonusesEnabled === "boolean" ? p.bonusesEnabled : true,
          }));

          const gs = data.groupSettings || {};
          const nextGs = { ...DEFAULT_GROUP_SETTINGS, ...gs };

          const migratedGreens = data.greens || data.greenies || {};
          const migratedBolaRosa = typeof data.bolaRosa === "string" ? data.bolaRosa : "";
          const migratedManualDiffs = data.manualMatchDiffs || data.matchDiffOverrides || {};

          const needsPatch =
            !data.groupSettings ||
            !data.greens ||
            !("bolaRosa" in data) ||
            !("manualMatchDiffs" in data) ||
            rawPlayers.some((p) => typeof p?.bonusesEnabled !== "boolean") ||
            nextGs.birdiePay !== gs.birdiePay ||
            nextGs.eaglePay !== gs.eaglePay ||
            nextGs.albatrossPay !== gs.albatrossPay ||
            nextGs.greensPay !== gs.greensPay ||
            nextGs.carryF9ToTotal !== gs.carryF9ToTotal ||
            nextGs.carryB9ToTotal !== gs.carryB9ToTotal;

          if (needsPatch) {
            try {
              await updateDoc(stateRef, {
                players: migratedPlayers,
                groupSettings: nextGs,
                greens: migratedGreens,
                bolaRosa: migratedBolaRosa,
                manualMatchDiffs: migratedManualDiffs,
                updatedAt: serverTimestamp(),
              });
            } catch {}
          }

          setState({
            ...data,
            players: migratedPlayers,
            groupSettings: nextGs,
            greens: migratedGreens,
            bolaRosa: migratedBolaRosa,
            manualMatchDiffs: migratedManualDiffs,
          });
          return;
        }

        try {
          await setDoc(stateRef, DEFAULT_STATE, { merge: true });
        } catch (e) {
          console.error(e);
          setState(null);
        }
      }
    );

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
  const manualMatchDiffs = state?.manualMatchDiffs || {};

  const allowManualMatchDiffs =
    !!session?.allowManualMatchDiffs ||
    !!session?.allowManualAdvantages ||
    !!session?.historyHcpEnabled ||
    !!session?.useHistoricalHcp ||
    !!session?.editableVentajas;

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

  useEffect(() => {
    if (!state || players.length < 2) return;

    const need = {};
    let changed = false;

    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const key = pairKey(players[i].id, players[j].id);
        const existing = matchBets[key];
        if (!existing || typeof existing.amount !== "number") {
          need[key] = { ...(existing || {}), amount: DEFAULT_BET_AMOUNT };
          changed = true;
        }
      }
    }

    if (changed) patchState({ matchBets: { ...matchBets, ...need } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players.map((p) => p.id).join("|"), state]);

  const addPlayer = async () => {
    if (!state) return;
    if (players.length >= 6) return alert("Máximo 6 jugadores por grupo.");

    const existingIds = players.map((p) => p.id);
    const id = makePlayerId(existingIds);

    const newPlayers = [
      ...players,
      {
        id,
        name: `Player ${players.length + 1}`,
        hcp: 0,
        bonusesEnabled: true,
      },
    ];
    const newScores = { ...scores, [id]: Array(18).fill("") };

    await patchState({ players: newPlayers, scores: newScores });
  };

  const removePlayer = async (playerId) => {
    if (!state) return;

    const p = players.find((x) => x.id === playerId);
    const ok = window.confirm(`¿Seguro que quieres quitar a "${p?.name || playerId}"?\n\nEsto borra sus scores y apuestas relacionadas.`);
    if (!ok) return;

    const newPlayers = players.filter((pp) => pp.id !== playerId);

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

    const newManualDiffs = { ...manualMatchDiffs };
    Object.keys(newManualDiffs).forEach((k) => {
      if (k.split("|").includes(playerId)) delete newManualDiffs[k];
    });

    const newBolaRosa = bolaRosa === playerId ? "" : bolaRosa;

    await patchState({
      players: newPlayers,
      scores: newScores,
      greens: newGreens,
      matchBets: newMatchBets,
      dobladas: newDobladas,
      bolaRosa: newBolaRosa,
      manualMatchDiffs: newManualDiffs,
    });
  };

  const updatePlayer = async (playerId, field, value) => {
    if (!state) return;
    const newPlayers = players.map((p) => (p.id === playerId ? { ...p, [field]: value } : p));
    await patchState({ players: newPlayers });
  };

  const togglePlayerBonuses = async (playerId, checked) => {
    if (!state) return;
    const newPlayers = players.map((p) =>
      p.id === playerId ? { ...p, bonusesEnabled: !!checked } : p
    );
    await patchState({ players: newPlayers });
  };

  const commitScore = async (playerId, holeIndex, value) => {
    if (!state) return;
    const arr = Array.isArray(scores[playerId]) ? [...scores[playerId]] : Array(18).fill("");
    arr[holeIndex] = value;
    await patchState({ scores: { ...scores, [playerId]: arr } });
  };

  const onScoreChange = (playerId, holeIndex, raw) => {
    const v = sanitizeScoreStr(raw, 2);
    setEditingScores((prev) => ({
      ...prev,
      [playerId]: { ...(prev[playerId] || {}), [holeIndex]: v },
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
    const value = toNonNegInt(raw, 0);
    await patchState({ groupSettings: { ...groupSettings, [field]: value } });
  };

  const updateGroupToggle = async (field, checked) => {
    await patchState({ groupSettings: { ...groupSettings, [field]: !!checked } });
  };

  const setGreenWinner = async (holeNumber, playerIdOrEmpty) => {
    const next = { ...greens };
    if (!playerIdOrEmpty) delete next[String(holeNumber)];
    else next[String(holeNumber)] = playerIdOrEmpty;
    await patchState({ greens: next });
  };

  const setBetAmount = async (aId, bId, raw) => {
    const key = pairKey(aId, bId);
    const n = toNonNegInt(raw, DEFAULT_BET_AMOUNT);
    const prev = matchBets[key] || { amount: DEFAULT_BET_AMOUNT };
    await patchState({ matchBets: { ...matchBets, [key]: { ...prev, amount: n } } });
  };

  const toggleDoblada = async (aId, bId, seg, checked) => {
    const key = pairKey(aId, bId);
    const prev = dobladas[key] || { f9: false, b9: false };
    await patchState({ dobladas: { ...dobladas, [key]: { ...prev, [seg]: !!checked } } });
  };

  const setManualDiff = async (aId, bId, raw) => {
    const key = pairKey(aId, bId);
    const value = sanitizeSignedNumberStr(raw);
    const next = { ...manualMatchDiffs };

    if (value === "" || value === "-0" || value === "0") delete next[key];
    else next[key] = Number(value);

    await patchState({ manualMatchDiffs: next });
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

  const onTableScroll = (e) => {
    const sl = e.currentTarget.scrollLeft || 0;
    setStickyCompact(sl > 10);
  };

  if (!sessionId || !groupId) return <div className="gs-fallback">Faltan parámetros.</div>;
  if (!groupMeta || state === undefined || !session) return <div className="gs-fallback">Cargando grupo...</div>;
  if (state === null) return <div className="gs-fallback">No pude crear state/main (revisa reglas).</div>;

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
    groupSettings,
    manualMatchDiffs,
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

  const matchesList = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i];
      const b = players[j];
      const key = pairKey(a.id, b.id);

      const bet = matchBets[key] || { amount: DEFAULT_BET_AMOUNT };
      const dbl = dobladas[key] || { f9: false, b9: false };
      const manualDiff = manualMatchDiffs[key];

      const pairRes = computeMatchResultForPair({
        a,
        b,
        scores,
        courseId,
        manualDiff,
      });

      const money = calcMatchMoneyForPair({
        pairResult: pairRes,
        matchBetsForPair: bet,
        dobladasForPair: dbl,
        groupSettings,
      });

      matchesList.push({ key, a, b, pairRes, bet, dbl, money, manualDiff });
    }
  }

  const subtitle = `${course.name} · %Hcp ${hcpPercent} · ${players.length}/6 jugadores`;
  const stickyW = stickyCompact ? 205 : 310;

  return (
    <div className="gs-page" data-theme={themeMode}>
      <style>{styles}</style>

      <div className="gs-appbar">
        <div className="gs-appbar-left">
          <button onClick={() => navigate(`/session/${sessionId}`)} className="gs-icon-btn" aria-label="Volver">
            ←
          </button>

          <div className="gs-title-wrap">
            <div className="gs-title-row">
              <div className="gs-title-text">{groupMeta?.name || groupId}</div>
              {saving ? <div className="gs-pill gs-pill-saving">Guardando…</div> : null}
              {!saving && syncPending ? <div className="gs-pill gs-pill-sync">Sync…</div> : null}
              {!saving && !syncPending && fromCache ? <div className="gs-pill gs-pill-offline">Offline</div> : null}
            </div>
            <div className="gs-subtitle">{subtitle}</div>
          </div>
        </div>

        <div className="gs-appbar-actions">
          <button
            onClick={() => setThemeMode((t) => (t === "dark" ? "light" : "dark"))}
            className="gs-chip-btn"
            type="button"
          >
            {themeMode === "dark" ? "☀️ Light" : "🌙 Dark"}
          </button>

          <button
            onClick={() => setScreenshotMode((s) => !s)}
            className="gs-chip-btn"
            type="button"
          >
            {screenshotMode ? "Normal" : "Screenshot"}
          </button>

          <button onClick={exportPNG} className="gs-chip-btn gs-chip-btn-primary" type="button">
            Export
          </button>
        </div>
      </div>

      <div className="gs-content">
        <div ref={captureRef}>
          <section className="gs-section">
            <div className="gs-section-head">
              <div className="gs-section-title">Scorecard</div>
              {!screenshotMode ? (
                <button onClick={addPlayer} disabled={players.length >= 6} className="gs-btn-primary" type="button">
                  + Jugador
                </button>
              ) : null}
            </div>

            <div ref={tableWrapRef} className="gs-table-wrap" onScroll={onTableScroll}>
              <table className="gs-table">
                <thead>
                  <tr>
                    <th className="gs-th gs-th-sticky" style={{ minWidth: stickyW, width: stickyW }}>
                      Jugador
                    </th>

                    {Array.from({ length: 9 }).map((_, i) => (
                      <th key={`h-${i}`} className="gs-th">
                        {i + 1}
                      </th>
                    ))}
                    <th className="gs-th gs-th-strong">F9</th>

                    {Array.from({ length: 9 }).map((_, i) => (
                      <th key={`h2-${i}`} className="gs-th">
                        {i + 10}
                      </th>
                    ))}
                    <th className="gs-th gs-th-strong">B9</th>

                    <th className="gs-th gs-th-strong">Tot</th>
                    <th className="gs-th gs-th-muted">Net</th>
                    <th className="gs-th gs-th-muted">STB</th>
                  </tr>

                  <tr>
                    <th className="gs-th gs-th-muted gs-th-sticky" style={{ minWidth: stickyW, width: stickyW }}>
                      Hcp
                    </th>

                    {course.parValues.slice(0, 9).map((p, i) => (
                      <th key={`pf-${i}`} className="gs-th gs-th-muted">
                        Par {p}
                      </th>
                    ))}
                    <th className="gs-th gs-th-muted"></th>

                    {course.parValues.slice(9).map((p, i) => (
                      <th key={`pb-${i}`} className="gs-th gs-th-muted">
                        Par {p}
                      </th>
                    ))}
                    <th className="gs-th gs-th-muted"></th>

                    <th className="gs-th gs-th-muted"></th>
                    <th className="gs-th gs-th-muted"></th>
                    <th className="gs-th gs-th-muted"></th>
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
                      <tr key={p.id}>
                        <td className="gs-td gs-td-sticky" style={{ minWidth: stickyW, width: stickyW }}>
                          <div className="gs-player-box">
                            <input
                              defaultValue={p.name}
                              onBlur={(e) => updatePlayer(p.id, "name", e.target.value)}
                              className="gs-input gs-input-name"
                              disabled={screenshotMode}
                            />

                            <div className="gs-player-meta">
                              <input
                                type="text"
                                inputMode="decimal"
                                defaultValue={String(p.hcp ?? 0)}
                                onChange={(e) => {
                                  e.target.value = sanitizeSignedNumberStr(e.target.value);
                                }}
                                onBlur={(e) => updatePlayer(p.id, "hcp", toSignedNumber(e.target.value, 0))}
                                className="gs-input gs-input-hcp"
                                disabled={screenshotMode}
                              />

                              {!stickyCompact ? (
                                <span className="gs-eff-text">
                                  eff {hcpPercent}%: <b>{effHcp}</b>
                                </span>
                              ) : null}
                            </div>

                            {!screenshotMode ? (
                              <div className="gs-player-flags">
                                <label className="gs-check-pill">
                                  <input
                                    type="checkbox"
                                    checked={p.bonusesEnabled !== false}
                                    onChange={(e) => togglePlayerBonuses(p.id, e.target.checked)}
                                  />
                                  <span>Bonus</span>
                                </label>

                                <button onClick={() => removePlayer(p.id)} className="gs-btn-danger" type="button">
                                  {stickyCompact ? "✕" : "Quitar"}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </td>

                        {Array.from({ length: 9 }).map((_, h) => {
                          const shown = editingScores?.[p.id]?.[h] !== undefined ? editingScores[p.id][h] : arr[h] ?? "";
                          const cat = scoreCategory(shown, course.parValues[h]);
                          return (
                            <td key={`sf-${p.id}-${h}`} className="gs-td">
                              <input
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={shown}
                                onChange={(e) => onScoreChange(p.id, h, e.target.value)}
                                onBlur={() => onScoreBlur(p.id, h)}
                                className={`gs-input gs-score-input ${scoreStyleClass(cat)} ${shown ? "filled" : "empty"}`}
                                disabled={screenshotMode}
                              />
                            </td>
                          );
                        })}
                        <td className="gs-td gs-td-strong">{grossF9 || ""}</td>

                        {Array.from({ length: 9 }).map((_, i) => {
                          const h = i + 9;
                          const shown = editingScores?.[p.id]?.[h] !== undefined ? editingScores[p.id][h] : arr[h] ?? "";
                          const cat = scoreCategory(shown, course.parValues[h]);
                          return (
                            <td key={`sb-${p.id}-${h}`} className="gs-td">
                              <input
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={shown}
                                onChange={(e) => onScoreChange(p.id, h, e.target.value)}
                                onBlur={() => onScoreBlur(p.id, h)}
                                className={`gs-input gs-score-input ${scoreStyleClass(cat)} ${shown ? "filled" : "empty"}`}
                                disabled={screenshotMode}
                              />
                            </td>
                          );
                        })}
                        <td className="gs-td gs-td-strong">{grossB9 || ""}</td>

                        <td className="gs-td gs-td-strong">{grossT || ""}</td>
                        <td className="gs-td gs-td-muted-cell">{netT || ""}</td>
                        <td className="gs-td gs-td-muted-cell">{stbT || ""}</td>
                      </tr>
                    );
                  })}

                  {players.length === 0 ? (
                    <tr>
                      <td className="gs-td gs-td-sticky" style={{ padding: 14, minWidth: stickyW, width: stickyW }}>
                        <div className="gs-empty-state">Agrega jugadores para empezar.</div>
                      </td>
                      <td className="gs-td" style={{ padding: 14 }} colSpan={22}></td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          {!screenshotMode ? (
            <>
              <Collapsible
                title="Ajustes del grupo"
                subtitle="Pagos + carry del match total"
                open={openPayouts}
                setOpen={setOpenPayouts}
              >
                <div className="gs-grid-2">
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

                <div className="gs-grid-2" style={{ marginTop: 12 }}>
                  <label className="gs-toggle-card">
                    <input
                      type="checkbox"
                      checked={!!groupSettings.carryF9ToTotal}
                      onChange={(e) => updateGroupToggle("carryF9ToTotal", e.target.checked)}
                    />
                    <div>
                      <div className="gs-toggle-title">Carry F9 → Total</div>
                      <div className="gs-toggle-sub">Si F9 queda AS, no afecta. Si no queda AS, se arrastra al total.</div>
                    </div>
                  </label>

                  <label className="gs-toggle-card">
                    <input
                      type="checkbox"
                      checked={!!groupSettings.carryB9ToTotal}
                      onChange={(e) => updateGroupToggle("carryB9ToTotal", e.target.checked)}
                    />
                    <div>
                      <div className="gs-toggle-title">Carry B9 → Total</div>
                      <div className="gs-toggle-sub">Misma lógica para la vuelta del 10–18.</div>
                    </div>
                  </label>
                </div>

                <div className="gs-hint">
                  “Bonus” por jugador te deja excluirlo de birdies/eagles/albatross sin quitarlo del grupo.
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
                    <div className="gs-label">Bola Rosa</div>
                    <select
                      value={bolaRosa}
                      onChange={(e) => setBolaRosa(e.target.value)}
                      className="gs-input gs-select"
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
                  <div className="gs-soft-text">Agrega al menos 2 jugadores para seleccionar ganadores.</div>
                ) : (
                  <div className="gs-grid-2">
                    {par3Holes.map((holeNumber) => (
                      <div key={holeNumber} className="gs-card-dark">
                        <div className="gs-card-title">Hoyo {holeNumber}</div>
                        <select
                          value={greens[String(holeNumber)] || ""}
                          onChange={(e) => setGreenWinner(holeNumber, e.target.value)}
                          className="gs-input gs-select"
                        >
                          <option value="">— Sin ganador —</option>
                          {players.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <div className="gs-hint-small">
                          El ganador cobra <b>${groupSettings.greensPay}</b> a cada jugador del grupo.
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Collapsible>

              <Collapsible
                title="Matches"
                subtitle={`Bet default $${DEFAULT_BET_AMOUNT} · color por F9/B9/Total · mostramos solo $Total`}
                open={openMatches}
                setOpen={setOpenMatches}
              >
                {players.length < 2 ? (
                  <div className="gs-soft-text">Agrega al menos 2 jugadores.</div>
                ) : (
                  <div className="gs-stack">
                    {matchesList.map((m) => (
                      <MatchCardDark
                        key={m.key}
                        m={m}
                        allowManualMatchDiffs={allowManualMatchDiffs}
                        onBet={(raw) => setBetAmount(m.a.id, m.b.id, raw)}
                        onDbl={(seg, checked) => toggleDoblada(m.a.id, m.b.id, seg, checked)}
                        onManualDiff={(raw) => setManualDiff(m.a.id, m.b.id, raw)}
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
                  <div className="gs-soft-text">Agrega jugadores.</div>
                ) : (
                  <div className="gs-totals-list">
                    {moneyRows.map((r) => {
                      const moneyClass = r.total > 0 ? "money-pos" : r.total < 0 ? "money-neg" : "money-even";
                      return (
                        <div key={r.id} className="gs-total-row">
                          <div className="gs-total-row-top">
                            <div className="gs-total-name">{r.name}</div>
                            <div className={`gs-total-money ${moneyClass}`}>{fmtMoney(r.total)}</div>
                          </div>

                          <div className="gs-mini-grid">
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
    <section className="gs-section gs-mt-12">
      <button onClick={() => setOpen(!open)} className="gs-collapsible-head" type="button">
        <div className="gs-collapsible-copy">
          <div className="gs-section-title">{title}</div>
          {subtitle ? <div className="gs-section-sub">{subtitle}</div> : null}
        </div>
        <div className="gs-chevron">{open ? "▾" : "▸"}</div>
      </button>
      {open ? <div className="gs-collapsible-body">{children}</div> : null}
    </section>
  );
}

function MatchCardDark({ m, onBet, onDbl, allowManualMatchDiffs, onManualDiff }) {
  const frontClass = segmentColorClass(m.pairRes.front);
  const backClass = segmentColorClass(m.pairRes.back);
  const totalClass = segmentColorClass(m.pairRes.total);
  const totalMoneyClass =
    m.money.moneyTotal > 0 ? "money-pos" : m.money.moneyTotal < 0 ? "money-neg" : "money-even";

  return (
    <div className="gs-match-card">
      <div className="gs-match-top">
        <div className="gs-match-copy">
          <div className="gs-match-title">
            <span>{m.a.name}</span> <span className="gs-vs">vs</span> <span>{m.b.name}</span>
          </div>
          <div className="gs-hint-small">
            diff HCP auto: <b>{m.pairRes.diff}</b>
            {allowManualMatchDiffs && m.manualDiff !== undefined && m.manualDiff !== null ? (
              <>
                {" "}
                · manual: <b>{m.manualDiff}</b>
              </>
            ) : null}
          </div>
        </div>

        <div className="gs-match-side">
          <div className="gs-mini-field">
            <div className="gs-mini-label">Bet</div>
            <input
              type="text"
              inputMode="numeric"
              defaultValue={String(m.bet.amount ?? 50)}
              onChange={(e) => {
                e.target.value = sanitizeNonNegIntStr(e.target.value);
              }}
              onBlur={(e) => onBet(e.target.value)}
              className="gs-input gs-mini-input"
            />
          </div>

          {allowManualMatchDiffs ? (
            <div className="gs-mini-field">
              <div className="gs-mini-label">Ventaja manual</div>
              <input
                type="text"
                inputMode="decimal"
                defaultValue={m.manualDiff ?? ""}
                onChange={(e) => {
                  e.target.value = sanitizeSignedNumberStr(e.target.value);
                }}
                onBlur={(e) => onManualDiff(e.target.value)}
                className="gs-input gs-mini-input"
                placeholder="auto"
              />
            </div>
          ) : (
            <div className="gs-mini-field gs-mini-field-locked">
              <div className="gs-mini-label">Ventaja</div>
              <div className="gs-locked-text">Auto</div>
            </div>
          )}
        </div>
      </div>

      <div className="gs-toggle-row">
        <label className="gs-check-pill">
          <input type="checkbox" checked={!!m.dbl.f9} onChange={(e) => onDbl("f9", e.target.checked)} />
          <span>Doblada F9</span>
        </label>

        <label className="gs-check-pill">
          <input type="checkbox" checked={!!m.dbl.b9} onChange={(e) => onDbl("b9", e.target.checked)} />
          <span>Doblada B9</span>
        </label>
      </div>

      <div className="gs-strip">
        <div className="gs-strip-head">
          <div>F9</div>
          <div>B9</div>
          <div>Total</div>
        </div>

        <div className="gs-strip-body">
          <div className={`gs-strip-val ${frontClass}`}>{fmtMatch(m.pairRes.front)}</div>
          <div className={`gs-strip-val ${backClass}`}>{fmtMatch(m.pairRes.back)}</div>
          <div className={`gs-strip-val ${totalClass}`}>{fmtMatch(m.pairRes.total)}</div>
        </div>
      </div>

      <div className="gs-match-money-wrap">
        <div className={`gs-money-pill ${totalMoneyClass}`}>
          {fmtMoney(m.money.moneyTotal)} <span>total</span>
        </div>
      </div>
    </div>
  );
}

function PayoutInputDark({ label, value, onBlur }) {
  return (
    <div className="gs-pill-dark">
      <div className="gs-pill-label">{label}</div>
      <input
        type="text"
        inputMode="numeric"
        defaultValue={String(value ?? 0)}
        onChange={(e) => {
          e.target.value = sanitizeNonNegIntStr(e.target.value);
        }}
        onBlur={(e) => onBlur(e.target.value)}
        className="gs-input gs-pill-input"
      />
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="gs-mini-stat">
      <div className="gs-mini-stat-label">{label}</div>
      <div className="gs-mini-stat-value">{value}</div>
    </div>
  );
}

function scoreStyleClass(cat) {
  if (cat === "albatross") return "score-albatross";
  if (cat === "eagle") return "score-eagle";
  if (cat === "birdie") return "score-birdie";
  if (cat === "bogey") return "score-bogey";
  if (cat === "double") return "score-double";
  return "score-none";
}

/* ---------------- Styles ---------------- */

const styles = `
  * { box-sizing: border-box; }
  .gs-page {
    min-height: 100%;
    background: var(--bg-page);
    color: var(--text-main);
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
    --radius-xl: 18px;
    --radius-lg: 16px;
    --radius-md: 14px;
    --radius-sm: 12px;
    --shadow: 0 18px 50px rgba(0,0,0,.22);
  }

  .gs-page[data-theme="dark"] {
    --bg-page:
      radial-gradient(1200px 700px at 10% 0%, rgba(59,130,246,.10) 0%, rgba(0,0,0,0) 45%),
      #05070b;
    --bg-panel: linear-gradient(180deg, rgba(15,23,42,.55) 0%, rgba(2,6,23,.35) 100%);
    --bg-card: rgba(2,6,23,.35);
    --bg-card-2: rgba(15,23,42,.45);
    --bg-card-3: rgba(15,23,42,.55);
    --bg-sticky: rgba(2,6,23,.78);
    --bg-sticky-head: rgba(2,6,23,.75);
    --bg-table-strong: rgba(59,130,246,.10);
    --bg-table-muted: rgba(148,163,184,.06);
    --border: rgba(148,163,184,.14);
    --border-soft: rgba(148,163,184,.10);
    --text-main: #e5e7eb;
    --text-strong: #ffffff;
    --text-soft: rgba(226,232,240,.75);
    --text-soft-2: rgba(226,232,240,.88);
    --blue: #dbeafe;
    --blue-bg: rgba(59,130,246,.18);
    --blue-border: rgba(59,130,246,.35);
    --danger: #fecaca;
    --danger-bg: rgba(239,68,68,.12);
    --danger-border: rgba(239,68,68,.30);
    --score-border: rgba(255,255,255,.82);
    --score-border-filled: rgba(148,163,184,.16);
    --score-bg: rgba(15,23,42,.55);
  }

  .gs-page[data-theme="light"] {
    --bg-page:
      radial-gradient(1100px 600px at 10% 0%, rgba(59,130,246,.10) 0%, rgba(255,255,255,0) 45%),
      #f3f7fb;
    --bg-panel: linear-gradient(180deg, rgba(255,255,255,.95) 0%, rgba(248,250,252,.92) 100%);
    --bg-card: rgba(255,255,255,.90);
    --bg-card-2: rgba(248,250,252,.94);
    --bg-card-3: rgba(255,255,255,.96);
    --bg-sticky: rgba(255,255,255,.96);
    --bg-sticky-head: rgba(255,255,255,.96);
    --bg-table-strong: rgba(59,130,246,.10);
    --bg-table-muted: rgba(148,163,184,.08);
    --border: rgba(15,23,42,.12);
    --border-soft: rgba(15,23,42,.08);
    --text-main: #0f172a;
    --text-strong: #020617;
    --text-soft: rgba(15,23,42,.70);
    --text-soft-2: rgba(15,23,42,.88);
    --blue: #1d4ed8;
    --blue-bg: rgba(59,130,246,.12);
    --blue-border: rgba(59,130,246,.28);
    --danger: #b91c1c;
    --danger-bg: rgba(239,68,68,.10);
    --danger-border: rgba(239,68,68,.20);
    --score-border: rgba(15,23,42,.45);
    --score-border-filled: rgba(15,23,42,.16);
    --score-bg: rgba(255,255,255,.98);
  }

  .gs-fallback {
    padding: 20px;
    min-height: 100vh;
    background: var(--bg-page);
    color: var(--text-strong);
  }

  .gs-content {
    padding: 12px;
    padding-top: 10px;
    max-width: 1100px;
    margin: 0 auto;
  }

  .gs-appbar {
    position: sticky;
    top: 0;
    z-index: 50;
    padding: 10px 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    backdrop-filter: blur(14px);
    background: color-mix(in srgb, var(--bg-card-3) 72%, transparent);
    border-bottom: 1px solid var(--border);
  }

  .gs-appbar-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .gs-title-wrap { min-width: 0; }
  .gs-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .gs-title-text {
    font-size: 16px;
    font-weight: 1000;
    letter-spacing: -.4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-strong);
    max-width: 240px;
  }

  .gs-subtitle {
    font-size: 12px;
    opacity: .8;
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-soft);
    max-width: 320px;
  }

  .gs-appbar-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .gs-pill {
    font-size: 11px;
    font-weight: 900;
    padding: 6px 10px;
    border-radius: 999px;
    white-space: nowrap;
  }

  .gs-pill-saving {
    border: 1px solid rgba(59,130,246,.25);
    background: rgba(59,130,246,.12);
    color: #bfdbfe;
  }

  .gs-pill-sync {
    border: 1px solid rgba(251,146,60,.28);
    background: rgba(251,146,60,.12);
    color: #fdba74;
  }

  .gs-pill-offline {
    border: 1px solid rgba(148,163,184,.22);
    background: rgba(148,163,184,.10);
    color: var(--text-soft-2);
  }

  .gs-icon-btn,
  .gs-chip-btn,
  .gs-chip-btn-primary,
  .gs-btn-primary,
  .gs-btn-danger {
    cursor: pointer;
    font: inherit;
  }

  .gs-icon-btn {
    width: 38px;
    height: 38px;
    border-radius: 14px;
    border: 1px solid var(--border);
    background: var(--bg-card-3);
    color: var(--text-strong);
    font-weight: 1000;
  }

  .gs-chip-btn {
    height: 38px;
    padding: 0 12px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg-card-3);
    color: var(--text-strong);
    font-weight: 950;
  }

  .gs-chip-btn-primary,
  .gs-btn-primary {
    border: 1px solid var(--blue-border);
    background: var(--blue-bg);
    color: var(--blue);
    font-weight: 950;
  }

  .gs-chip-btn-primary {
    height: 38px;
    padding: 0 12px;
    border-radius: 999px;
  }

  .gs-btn-primary {
    padding: 8px 10px;
    border-radius: 12px;
  }

  .gs-btn-danger {
    padding: 8px 10px;
    border-radius: 12px;
    border: 1px solid var(--danger-border);
    background: var(--danger-bg);
    color: var(--danger);
    font-weight: 950;
  }

  .gs-section {
    border-radius: var(--radius-xl);
    border: 1px solid var(--border);
    background: var(--bg-panel);
    box-shadow: var(--shadow);
    overflow: hidden;
  }

  .gs-mt-12 { margin-top: 12px; }

  .gs-section-head {
    padding: 12px 12px 10px 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    border-bottom: 1px solid var(--border-soft);
  }

  .gs-section-title {
    font-size: 14px;
    font-weight: 1000;
    letter-spacing: -.2px;
    color: var(--text-strong);
  }

  .gs-section-sub {
    margin-top: 2px;
    font-size: 12px;
    color: var(--text-soft);
  }

  .gs-collapsible-head {
    width: 100%;
    padding: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    background: transparent;
    color: var(--text-main);
    border: none;
    text-align: left;
  }

  .gs-collapsible-copy { min-width: 0; }
  .gs-chevron {
    font-size: 18px;
    opacity: .8;
    font-weight: 900;
    color: var(--text-soft);
  }

  .gs-collapsible-body {
    padding: 12px;
    padding-top: 0;
  }

  .gs-table-wrap {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .gs-table {
    width: 100%;
    min-width: 1080px;
    border-collapse: separate;
    border-spacing: 0;
  }

  .gs-th,
  .gs-td {
    padding: 8px;
    text-align: center;
    white-space: nowrap;
  }

  .gs-th {
    font-size: 12px;
    font-weight: 900;
    color: var(--text-soft-2);
    background: var(--bg-card);
    border-bottom: 1px solid var(--border);
  }

  .gs-th-muted {
    opacity: .72;
    font-size: 11px;
    font-weight: 800;
  }

  .gs-th-strong {
    background: var(--bg-table-strong);
    color: var(--blue);
  }

  .gs-th-sticky {
    position: sticky;
    left: 0;
    z-index: 2;
    text-align: left;
    background: var(--bg-sticky-head);
    backdrop-filter: blur(10px);
  }

  .gs-td {
    background: color-mix(in srgb, var(--bg-card-2) 92%, transparent);
    color: var(--text-main);
    border-bottom: 1px solid var(--border-soft);
  }

  .gs-td-sticky {
    position: sticky;
    left: 0;
    z-index: 1;
    text-align: left;
    background: var(--bg-sticky);
    backdrop-filter: blur(10px);
  }

  .gs-td-strong {
    font-weight: 1000;
    background: var(--bg-table-strong);
    color: var(--blue);
  }

  .gs-td-muted-cell {
    opacity: .96;
    background: var(--bg-table-muted);
    font-weight: 1000;
  }

  .gs-player-box {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .gs-player-meta,
  .gs-player-flags {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }

  .gs-eff-text {
    font-size: 12px;
    color: var(--text-soft);
    font-weight: 900;
  }

  .gs-eff-text b {
    color: var(--text-strong);
  }

  .gs-input {
    font: inherit;
    outline: none;
  }

  .gs-input-name,
  .gs-input-hcp,
  .gs-select,
  .gs-pill-input,
  .gs-mini-input {
    border: 1px solid var(--border);
    background: var(--bg-card-3);
    color: var(--text-strong);
  }

  .gs-input-name {
    width: 100%;
    padding: 10px;
    border-radius: 12px;
    font-weight: 950;
  }

  .gs-input-hcp {
    width: 80px;
    padding: 8px 10px;
    border-radius: 12px;
    font-weight: 900;
  }

  .gs-score-input {
    width: 42px;
    height: 42px;
    padding: 8px 6px;
    border-radius: 12px;
    text-align: center;
    font-weight: 1000;
    background: var(--score-bg);
    color: var(--text-strong);
  }

  .gs-score-input.empty {
    border: 1.5px solid var(--score-border);
  }

  .gs-score-input.filled {
    border: 1.5px solid var(--score-border-filled);
  }

  .score-none {}
  .score-albatross { border-color: rgba(255,119,200,.90) !important; background: rgba(255,119,200,.14) !important; }
  .score-eagle { border-color: rgba(34,197,94,.90) !important; background: rgba(34,197,94,.14) !important; }
  .score-birdie { border-color: rgba(251,146,60,.95) !important; background: rgba(251,146,60,.14) !important; }
  .score-bogey { border-color: rgba(96,165,250,.90) !important; background: rgba(96,165,250,.14) !important; }
  .score-double { border-color: rgba(239,68,68,.90) !important; background: rgba(239,68,68,.14) !important; }

  .gs-empty-state {
    opacity: .82;
    font-weight: 800;
    color: var(--text-soft-2);
  }

  .gs-grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .gs-pill-dark,
  .gs-card-dark,
  .gs-match-card,
  .gs-total-row,
  .gs-mini-stat,
  .gs-mini-field,
  .gs-toggle-card {
    border: 1px solid var(--border);
    background: var(--bg-card);
  }

  .gs-pill-dark {
    padding: 10px 12px;
    border-radius: 16px;
  }

  .gs-pill-label {
    opacity: .78;
    font-size: 12px;
    font-weight: 950;
    color: var(--text-soft);
  }

  .gs-pill-input {
    margin-top: 6px;
    width: 100%;
    padding: 12px 10px;
    border-radius: 12px;
    text-align: center;
    font-weight: 1000;
  }

  .gs-toggle-card {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 12px;
    border-radius: 16px;
  }

  .gs-toggle-title {
    font-weight: 950;
    color: var(--text-strong);
  }

  .gs-toggle-sub {
    margin-top: 4px;
    font-size: 12px;
    color: var(--text-soft);
  }

  .gs-label {
    font-weight: 950;
    margin-bottom: 6px;
    color: var(--text-strong);
  }

  .gs-select {
    padding: 12px;
    border-radius: 14px;
    width: 100%;
    font-weight: 950;
  }

  .gs-card-dark {
    border-radius: 16px;
    padding: 12px;
  }

  .gs-card-title {
    font-weight: 900;
    margin-bottom: 8px;
    color: var(--text-strong);
  }

  .gs-hint {
    margin-top: 10px;
    font-size: 12px;
    color: var(--text-soft);
    border-top: 1px solid var(--border-soft);
    padding-top: 10px;
  }

  .gs-hint-small {
    margin-top: 8px;
    font-size: 12px;
    color: var(--text-soft);
  }

  .gs-soft-text {
    opacity: .82;
    color: var(--text-soft-2);
  }

  .gs-stack,
  .gs-totals-list {
    display: grid;
    gap: 12px;
  }

  .gs-match-card {
    border-radius: 18px;
    padding: 12px;
  }

  .gs-match-top {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .gs-match-copy {
    min-width: 0;
    flex: 1;
  }

  .gs-match-title {
    font-weight: 950;
    font-size: 15px;
    line-height: 1.15;
    color: var(--text-strong);
  }

  .gs-vs {
    opacity: .55;
    font-weight: 900;
    color: var(--text-soft);
  }

  .gs-match-side {
    display: flex;
    gap: 8px;
    align-items: stretch;
    flex-wrap: wrap;
  }

  .gs-mini-field {
    min-width: 120px;
    border-radius: 14px;
    padding: 10px 12px;
  }

  .gs-mini-field-locked {
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .gs-mini-label {
    font-size: 12px;
    font-weight: 950;
    opacity: .75;
    color: var(--text-soft);
  }

  .gs-mini-input {
    margin-top: 6px;
    width: 100%;
    padding: 10px 10px;
    border-radius: 12px;
    text-align: center;
    font-weight: 1000;
  }

  .gs-locked-text {
    margin-top: 8px;
    font-weight: 1000;
    color: var(--text-strong);
  }

  .gs-toggle-row {
    display: flex;
    gap: 10px;
    margin-top: 10px;
    flex-wrap: wrap;
  }

  .gs-check-pill {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 14px;
    border: 1px solid var(--border);
    background: var(--bg-card-2);
    user-select: none;
    color: var(--text-strong);
    font-weight: 900;
  }

  .gs-strip {
    margin-top: 12px;
    border-radius: 16px;
    overflow: hidden;
    border: 1px solid var(--border);
  }

  .gs-strip-head,
  .gs-strip-body {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
  }

  .gs-strip-head {
    background: var(--bg-card-3);
  }

  .gs-strip-body {
    background: color-mix(in srgb, var(--bg-card) 88%, transparent);
  }

  .gs-strip-head > div {
    padding: 10px;
    text-align: center;
    font-weight: 950;
    opacity: .9;
    color: var(--text-soft-2);
  }

  .gs-strip-val {
    padding: 14px 10px;
    text-align: center;
    font-weight: 1000;
    font-size: 22px;
    letter-spacing: -.6px;
  }

  .seg-pos { color: #22c55e; }
  .seg-neg { color: #ef4444; }
  .seg-as { color: var(--text-soft-2); }

  .gs-match-money-wrap {
    display: flex;
    justify-content: flex-end;
    margin-top: 10px;
  }

  .gs-money-pill {
    padding: 10px 12px;
    border-radius: 16px;
    border: 2px solid var(--border);
    background: var(--bg-card-2);
    font-weight: 1000;
  }

  .gs-money-pill span {
    opacity: .75;
    font-weight: 900;
  }

  .money-pos { color: #22c55e; }
  .money-neg { color: #ef4444; }
  .money-even { color: var(--text-soft-2); }

  .gs-total-row {
    border-radius: 16px;
    padding: 12px;
  }

  .gs-total-row-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .gs-total-name {
    font-weight: 900;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-strong);
  }

  .gs-total-money {
    font-weight: 1000;
  }

  .gs-mini-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0,1fr));
    gap: 8px;
    margin-top: 10px;
  }

  .gs-mini-stat {
    border-radius: 14px;
    padding: 10px;
  }

  .gs-mini-stat-label {
    opacity: .75;
    font-size: 11px;
    font-weight: 900;
    color: var(--text-soft);
  }

  .gs-mini-stat-value {
    font-weight: 1000;
    margin-top: 2px;
    color: var(--text-strong);
  }

  @media (max-width: 860px) {
    .gs-grid-2 {
      grid-template-columns: 1fr;
    }

    .gs-title-text {
      max-width: 150px;
    }

    .gs-subtitle {
      max-width: 180px;
    }

    .gs-appbar {
      align-items: flex-start;
      flex-direction: column;
    }

    .gs-appbar-actions {
      width: 100%;
      justify-content: flex-start;
    }

    .gs-match-side {
      width: 100%;
    }

    .gs-mini-field {
      flex: 1 1 140px;
    }
  }
`;
