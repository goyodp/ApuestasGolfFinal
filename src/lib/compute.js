// =====================
// COURSES
// =====================
// strokeIndexes: es el "Handicap" por hoyo (1..18) del scorecard
export const COURSE_DATA = {
  "campestre-slp": {
    name: "Campestre de San Luis",
    parValues: [4, 3, 4, 4, 4, 4, 5, 3, 5, 5, 3, 4, 4, 4, 3, 4, 4, 5],
    strokeIndexes: [3, 13, 15, 7, 5, 1, 17, 11, 9, 4, 12, 6, 14, 18, 8, 2, 16, 10],
  },

  "la-loma": {
    name: "La Loma Club de Golf (SLP)",
    parValues: [4, 4, 4, 3, 5, 5, 4, 3, 4, 4, 3, 4, 4, 4, 5, 4, 3, 5],
    // Hoyo 7 = SI 1 (correcto)
    strokeIndexes: [11, 3, 13, 17, 7, 5, 1, 15, 9, 2, 18, 10, 16, 4, 8, 14, 12, 6],
  },

  "club-de-golf-mexico": {
    name: "Club de Golf México (CDMX)",
    parValues: [4, 5, 3, 4, 3, 5, 4, 4, 4, 4, 5, 4, 4, 3, 4, 3, 5, 4],
    strokeIndexes: [13, 3, 17, 1, 15, 5, 11, 9, 7, 6, 4, 10, 14, 16, 8, 18, 2, 12],
  },

  "moon-palace-cancun": {
    name: "Moon Palace Golf (Cancún)",
    parValues: [4, 5, 4, 5, 4, 3, 4, 3, 4, 4, 5, 3, 4, 4, 5, 4, 3, 4],
    strokeIndexes: [17, 7, 9, 5, 3, 15, 13, 11, 1, 16, 2, 8, 10, 14, 4, 12, 18, 6],
  },

  "pga-riviera-maya": {
    name: "PGA Riviera Maya Golf Club (Q. Roo)",
    parValues: [4, 3, 4, 5, 3, 4, 4, 5, 4, 4, 4, 4, 4, 5, 3, 5, 3, 4],
    strokeIndexes: [13, 11, 15, 5, 17, 1, 7, 3, 9, 8, 10, 16, 14, 4, 6, 2, 18, 12],
  },

  // =====================
  // CERCA DE SLP (Centro)
  // =====================

  "san-gil": {
    name: "Club de Golf San Gil (Qro)",
    parValues: [5, 4, 4, 3, 4, 4, 3, 5, 4, 4, 5, 4, 3, 4, 5, 3, 4, 4],
    strokeIndexes: [17, 5, 3, 15, 9, 11, 7, 13, 1, 8, 14, 2, 18, 12, 10, 16, 4, 6],
  },

  "provincia-juriquilla": {
    name: "Club de Golf Provincia Juriquilla (Qro)",
    parValues: [5, 4, 4, 4, 3, 5, 3, 5, 3, 4, 5, 3, 5, 4, 4, 4, 3, 4],
    strokeIndexes: [9, 1, 5, 13, 15, 3, 11, 7, 17, 2, 12, 10, 8, 4, 6, 16, 14, 18],
  },

  "el-campanario": {
    name: "El Campanario (Qro)",
    parValues: [5, 4, 3, 4, 3, 4, 5, 4, 4, 4, 4, 3, 4, 4, 3, 5, 4, 5],
    strokeIndexes: [5, 3, 9, 11, 13, 15, 7, 17, 1, 2, 8, 18, 16, 6, 10, 4, 12, 14],
  },

  "amanali": {
    name: "Club de Golf Amanali (Hgo)",
    parValues: [4, 3, 4, 5, 3, 5, 3, 5, 4, 4, 3, 4, 5, 4, 5, 4, 3, 4],
    strokeIndexes: [5, 17, 9, 7, 13, 3, 15, 1, 11, 10, 18, 6, 2, 12, 4, 14, 16, 8],
  },

  "pulgas-pandas": {
    name: "Club de Golf Pulgas Pandas (Ags)",
    parValues: [4, 5, 3, 4, 3, 4, 5, 4, 4, 4, 5, 3, 4, 3, 4, 5, 4, 4],
    strokeIndexes: [9, 3, 7, 15, 17, 5, 13, 11, 1, 8, 6, 12, 16, 18, 4, 14, 10, 2],
  },

  "campestre-aguascalientes": {
    name: "Club Campestre de Aguascalientes (Ags)",
    parValues: [4, 4, 5, 3, 4, 4, 5, 3, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4],
    strokeIndexes: [5, 11, 7, 17, 13, 9, 1, 15, 3, 10, 14, 16, 6, 12, 4, 18, 8, 2],
  },

  "guadalajara-country-club": {
    name: "Guadalajara Country Club (Gdl)",
    parValues: [5, 4, 4, 3, 4, 4, 4, 3, 5, 4, 4, 5, 4, 4, 3, 4, 3, 5],
    strokeIndexes: [9, 13, 1, 17, 11, 3, 5, 15, 7, 12, 8, 6, 2, 4, 18, 14, 16, 10],
  },

  "las-canadas": {
    name: "Las Cañadas Country Club (Gdl)",
    parValues: [4, 4, 3, 4, 5, 5, 4, 4, 3, 5, 4, 3, 4, 4, 4, 5, 3, 4],
    strokeIndexes: [9, 5, 15, 1, 3, 11, 7, 13, 17, 8, 2, 16, 12, 10, 6, 4, 18, 14],
  },

  "santa-anita": {
    name: "Santa Anita Club de Golf (Gdl)",
    parValues: [5, 4, 4, 4, 3, 4, 5, 4, 3, 4, 3, 4, 5, 4, 3, 4, 5, 4],
    strokeIndexes: [11, 3, 9, 7, 15, 5, 13, 1, 17, 4, 18, 10, 2, 8, 14, 6, 12, 16],
  },

  "campestre-leon": {
    name: "Club Campestre de León (Gto)",
    parValues: [4, 4, 5, 3, 4, 4, 3, 4, 5, 4, 4, 5, 3, 4, 4, 3, 5, 4],
    strokeIndexes: [9, 3, 13, 17, 15, 1, 11, 5, 7, 16, 12, 2, 18, 6, 8, 14, 4, 10],
  },

  "ventanas-san-miguel": {
    name: "Ventanas de San Miguel (SMA, Gto)",
    parValues: [5, 4, 3, 4, 3, 5, 4, 4, 3, 4, 4, 3, 4, 5, 4, 4, 3, 4],
    strokeIndexes: [15, 3, 11, 5, 13, 1, 7, 9, 17, 14, 8, 18, 6, 4, 16, 12, 10, 2],
  },

  "malanquin": {
    name: "Malanquín Club de Golf (SMA, Gto)",
    parValues: [4, 3, 4, 4, 5, 4, 4, 3, 5, 4, 5, 5, 4, 3, 4, 3, 4, 4],
    strokeIndexes: [15, 11, 3, 1, 7, 5, 17, 13, 9, 18, 8, 12, 4, 14, 16, 10, 6, 2],
  },
};

// =====================
// Utils
// =====================
export function safeInt(v) {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

export function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function pairKey(aId, bId) {
  return [aId, bId].sort().join("|");
}

export function playerKey(groupId, playerId) {
  return `${groupId}::${playerId}`;
}

// =====================
// Score category (UI colors)
// =====================
export function scoreCategory(gross, par) {
  const g = safeInt(gross);
  if (g === null) return "none";
  const d = g - (par ?? 4);
  if (d <= -3) return "albatross";
  if (d === -2) return "eagle";
  if (d === -1) return "birdie";
  if (d === 1) return "bogey";
  if (d >= 2) return "double";
  return "none";
}

// =====================
// Handicap / strokes
// =====================
/**
 * buildStrokeArray supports POSITIVE and NEGATIVE strokes.
 * - Positive strokes: assign 1..18 (hardest holes first: SI 1,2,3...)
 * - Negative strokes (plus handicap): assign 18..1
 *
 * Returned array is SIGNED:
 * - +1 means you RECEIVE a stroke (net = gross - 1)
 * - -1 means you GIVE a stroke (net = gross + 1)
 */
export function buildStrokeArray(strokes, strokeIndexes) {
  const s = Math.round(strokes || 0);
  const abs = Math.abs(s);
  const sign = s === 0 ? 0 : s > 0 ? 1 : -1;

  const arr = Array(18).fill(0);
  if (!abs || !sign) return arr;

  for (let k = 0; k < abs; k++) {
    const si = sign > 0 ? (k % 18) + 1 : 18 - (k % 18);
    const holeIdx = strokeIndexes.indexOf(si);
    if (holeIdx >= 0) arr[holeIdx] += 1 * sign;
  }
  return arr;
}

/**
 * NET + Stableford uses % global, including negative HCP (plus handicap).
 */
export function buildHcpAdjustments(playerHcp, hcpPercent, strokeIndexes) {
  const percent = toNum(hcpPercent) / 100;
  const strokes = Math.round((playerHcp || 0) * percent);
  return buildStrokeArray(strokes, strokeIndexes);
}

/**
 * For matches:
 * diff > 0 => B receives strokes
 * diff < 0 => A receives strokes
 */
export function buildMatchStrokesByDiff(diff, strokeIndexes) {
  const d = Math.round(diff || 0);

  const strokesA = d < 0 ? buildStrokeArray(Math.abs(d), strokeIndexes) : Array(18).fill(0);
  const strokesB = d > 0 ? buildStrokeArray(d, strokeIndexes) : Array(18).fill(0);

  return {
    diff: d,
    strokesA: strokesA.map((x) => Math.max(0, x)),
    strokesB: strokesB.map((x) => Math.max(0, x)),
  };
}

/**
 * MATCHES are ALWAYS 100% handicap difference by default
 */
export function buildMatchStrokesByHcpDiff100(hcpA, hcpB, strokeIndexes) {
  const diff = Math.round((hcpB - hcpA) * 1);
  return buildMatchStrokesByDiff(diff, strokeIndexes);
}

// =====================
// Totals helpers
// =====================
export function sumGross9(arr18, startIdx) {
  let t = 0;
  for (let i = startIdx; i < startIdx + 9; i++) {
    const n = safeInt(arr18?.[i]);
    if (n !== null) t += n;
  }
  return t;
}

export function sumNet9(arr18, hcpAdj18, startIdx) {
  let t = 0;
  for (let i = startIdx; i < startIdx + 9; i++) {
    const g = safeInt(arr18?.[i]);
    if (g !== null) t += g - (hcpAdj18?.[i] || 0);
  }
  return t;
}

// =====================
// Stableford (NET Stableford)
// points = max(0, 2 + (par - netScore))
// =====================
export function stablefordForHole({ gross, par, hcpAdj }) {
  const g = safeInt(gross);
  if (g === null) return 0;

  const net = g - (hcpAdj || 0);
  const pts = 2 + (par - net);
  return Math.max(0, pts);
}

export function sumStableford9(arr18, parValues, hcpAdj18, startIdx) {
  let t = 0;
  for (let i = startIdx; i < startIdx + 9; i++) {
    t += stablefordForHole({
      gross: arr18?.[i],
      par: parValues?.[i] ?? 4,
      hcpAdj: hcpAdj18?.[i] || 0,
    });
  }
  return t;
}

// =====================
// Sorting rules
// =====================
export function sortStablefordThenHcpAsc(a, b) {
  if (a.stableford !== b.stableford) return b.stableford - a.stableford;
  return (a.hcp || 0) - (b.hcp || 0);
}

export function sortNetThenHcpAsc(a, b) {
  if (a.net !== b.net) return a.net - b.net;
  return (a.hcp || 0) - (b.hcp || 0);
}

// =====================
// Leaderboards
// =====================
export function computeLeaderboards({ groupsFull, courseId, hcpPercent }) {
  const course = COURSE_DATA[courseId] || COURSE_DATA["campestre-slp"];
  const { strokeIndexes, parValues } = course;

  const stablefordRows = [];
  const netRows = [];

  for (const g of groupsFull) {
    const players = g.players || [];
    const scores = g.scores || {};

    for (const p of players) {
      const arr = scores[p.id] || Array(18).fill("");
      const adj = buildHcpAdjustments(p.hcp || 0, hcpPercent, strokeIndexes);

      let net = 0;
      let stableford = 0;

      for (let i = 0; i < 18; i++) {
        const gv = safeInt(arr?.[i]);
        if (gv === null) continue;

        net += gv - (adj[i] || 0);
        stableford += stablefordForHole({
          gross: gv,
          par: parValues?.[i] ?? 4,
          hcpAdj: adj[i] || 0,
        });
      }

      stablefordRows.push({
        name: p.name || "",
        hcp: p.hcp || 0,
        stableford,
        groupId: g.id,
        playerId: p.id,
        playerKey: playerKey(g.id, p.id),
      });

      netRows.push({
        name: p.name || "",
        hcp: p.hcp || 0,
        net,
        groupId: g.id,
        playerId: p.id,
        playerKey: playerKey(g.id, p.id),
      });
    }
  }

  stablefordRows.sort(sortStablefordThenHcpAsc);
  netRows.sort(sortNetThenHcpAsc);

  return { stablefordRows, netRows };
}

// =====================
// Entry prizes
// =====================
export function computeEntryPrizes({ groupsFull, courseId, hcpPercent, entryFee }) {
  const { stablefordRows, netRows } = computeLeaderboards({ groupsFull, courseId, hcpPercent });

  const totalPlayers = stablefordRows.length;
  const fee = toNum(entryFee);
  const pool = Math.max(0, fee * totalPlayers);

  const paid = {};

  const firstStb = stablefordRows[0] || null;
  const secondStb = stablefordRows[1] || null;

  if (firstStb) paid[firstStb.playerKey] = (paid[firstStb.playerKey] || 0) + pool * 0.5;
  if (secondStb) paid[secondStb.playerKey] = (paid[secondStb.playerKey] || 0) + pool * 0.3;

  const excluded = new Set([firstStb?.playerKey, secondStb?.playerKey].filter(Boolean));
  const bestNet = netRows.find((r) => !excluded.has(r.playerKey)) || null;
  if (bestNet) paid[bestNet.playerKey] = (paid[bestNet.playerKey] || 0) + pool * 0.2;

  const winners = { stableford1: firstStb, stableford2: secondStb, net1: bestNet };
  return { pool, totalPlayers, entryFee: fee, winners, payoutsByPlayerKey: paid };
}

// =====================
// Match play using 100% diff or manual diff
// =====================
function holeResult(aAdj, bAdj) {
  if (aAdj < bAdj) return 1;
  if (aAdj > bAdj) return -1;
  return 0;
}

export function computeMatchResultForPair({ a, b, scores, courseId, manualDiff = null }) {
  const course = COURSE_DATA[courseId] || COURSE_DATA["campestre-slp"];
  const { strokeIndexes } = course;

  const grossA = scores[a.id] || Array(18).fill("");
  const grossB = scores[b.id] || Array(18).fill("");

  const useManual = Number.isFinite(Number(manualDiff));
  const { diff, strokesA, strokesB } = useManual
    ? buildMatchStrokesByDiff(Number(manualDiff), strokeIndexes)
    : buildMatchStrokesByHcpDiff100(a.hcp || 0, b.hcp || 0, strokeIndexes);

  let front = 0;
  let back = 0;

  for (let i = 0; i < 18; i++) {
    const ga = safeInt(grossA[i]);
    const gb = safeInt(grossB[i]);
    if (ga === null || gb === null) continue;

    const aAdj = ga - (strokesA[i] || 0);
    const bAdj = gb - (strokesB[i] || 0);

    const r = holeResult(aAdj, bAdj);
    if (i < 9) front += r;
    else back += r;
  }

  return {
    label: `${a.name} vs ${b.name}`,
    a: { id: a.id, name: a.name, hcp: a.hcp || 0 },
    b: { id: b.id, name: b.name, hcp: b.hcp || 0 },
    diff,
    front,
    back,
    total: front + back,
  };
}

// =====================
// Money logic
// =====================
function segmentMultiplier(dobladaEnabled) {
  return dobladaEnabled ? 2 : 1;
}

export function calcMatchMoneyForPair({
  pairResult,
  matchBetsForPair,
  dobladasForPair,
  carrySettings,
}) {
  const bet = toNum(matchBetsForPair?.amount);

  const f9Mult = segmentMultiplier(!!dobladasForPair?.f9);
  const b9Mult = segmentMultiplier(!!dobladasForPair?.b9);

  const carryF9ToTotal = !!carrySettings?.carryF9ToTotal;
  const carryB9ToTotal = !!carrySettings?.carryB9ToTotal;

  const moneyF9 = pairResult.front === 0 ? 0 : Math.sign(pairResult.front) * bet * f9Mult;
  const moneyB9 = pairResult.back === 0 ? 0 : Math.sign(pairResult.back) * bet * b9Mult;

  const carryToTotal =
    (pairResult.front === 0 && carryF9ToTotal ? bet * f9Mult : 0) +
    (pairResult.back === 0 && carryB9ToTotal ? bet * b9Mult : 0);

  const totalStake = bet + carryToTotal;
  const moneyT = pairResult.total === 0 ? 0 : Math.sign(pairResult.total) * totalStake;

  return {
    moneyF9,
    moneyB9,
    moneyT,
    moneyTotal: moneyF9 + moneyB9 + moneyT,
    totalStake,
    carryToTotal,
    multipliers: { f9Mult, b9Mult },
  };
}

// =====================
// Bonus / Greens / Matches totals
// =====================
export function computeBonusMoneyByPlayer({ players, scores, parValues, groupSettings }) {
  const out = {};
  players.forEach((p) => (out[p.id] = 0));

  const eligiblePlayers = players.filter((p) => p.bonusEligible !== false);
  const n = eligiblePlayers.length;
  if (n <= 1) return out;

  const birdiePay = toNum(groupSettings?.birdiePay);
  const eaglePay = toNum(groupSettings?.eaglePay);
  const albatrossPay = toNum(groupSettings?.albatrossPay);

  for (const p of eligiblePlayers) {
    const arr = scores[p.id] || Array(18).fill("");

    for (let i = 0; i < 18; i++) {
      const g = safeInt(arr[i]);
      if (g === null) continue;

      const par = parValues?.[i] ?? 4;
      const diff = g - par;

      let pay = 0;
      if (diff === -1) pay = birdiePay;
      else if (diff === -2) pay = eaglePay;
      else if (diff <= -3) pay = albatrossPay;
      if (!pay) continue;

      for (const other of eligiblePlayers) {
        if (other.id === p.id) out[other.id] += pay * (n - 1);
        else out[other.id] -= pay;
      }
    }
  }

  return out;
}

export function computeGreensMoneyByPlayer({ players, greens, greensPay }) {
  const n = players.length;
  const out = {};
  players.forEach((p) => (out[p.id] = 0));
  if (n <= 1) return out;

  const pay = toNum(greensPay);
  const winners = Object.values(greens || {}).filter(Boolean);

  for (const winnerId of winners) {
    for (const p of players) {
      if (p.id === winnerId) out[p.id] += pay * (n - 1);
      else out[p.id] -= pay;
    }
  }

  return out;
}

export function computeMatchesMoneyByPlayer({
  players,
  scores,
  courseId,
  matchBets,
  dobladas,
  manualDiffs,
  groupSettings,
}) {
  const out = {};
  players.forEach((p) => (out[p.id] = 0));

  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i];
      const b = players[j];
      const key = pairKey(a.id, b.id);

      const bet = matchBets?.[key] || { amount: 0 };
      const dbl = dobladas?.[key] || { f9: false, b9: false };
      const manualDiff = manualDiffs?.[key];

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
        carrySettings: {
          carryF9ToTotal: !!groupSettings?.carryF9ToTotal,
          carryB9ToTotal: !!groupSettings?.carryB9ToTotal,
        },
      });

      out[a.id] += money.moneyTotal;
      out[b.id] -= money.moneyTotal;
    }
  }

  return out;
}

// =====================
// Formatting
// =====================
export function fmtMatch(v) {
  if (v === 0) return "AS";
  if (v > 0) return `+${v}`;
  return `${v}`;
}

export function fmtMoney(n) {
  const x = toNum(n);
  if (x === 0) return "$0";
  return x > 0 ? `+$${Math.round(x)}` : `-$${Math.abs(Math.round(x))}`;
}
