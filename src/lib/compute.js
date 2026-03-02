// src/lib/compute.js

// =====================
// COURSES (session-level)
// =====================
export const COURSE_DATA = {
  "campestre-slp": {
    name: "Campestre de San Luis",
    parValues: [4, 3, 4, 4, 4, 4, 5, 3, 5, 5, 3, 4, 4, 4, 3, 4, 4, 5],
    strokeIndexes: [3, 13, 15, 7, 5, 1, 17, 11, 9, 4, 12, 6, 14, 18, 8, 2, 16, 10],
  },
  "la-loma": {
    name: "La Loma Golf",
    parValues: [4, 4, 4, 3, 5, 5, 4, 3, 4, 4, 3, 4, 4, 4, 5, 4, 3, 5],
    strokeIndexes: [11, 3, 13, 17, 7, 5, 1, 15, 9, 2, 18, 10, 16, 4, 8, 14, 12, 6],
  },
};

// =====================
// Small utils
// =====================
export function safeInt(v) {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

export function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function pairKey(aId, bId) {
  return [aId, bId].sort().join("|");
}

// =====================
// Handicap / strokes logic
// =====================

/**
 * buildStrokeArray(strokes, strokeIndexes)
 * Distributes `strokes` across holes by strokeIndex 1..18 repeating (supports doubles/triples).
 * Returns array[18] where each cell = number of strokes received on that hole.
 */
export function buildStrokeArray(strokes, strokeIndexes) {
  const abs = Math.abs(Math.round(strokes || 0));
  const arr = Array(18).fill(0);

  for (let k = 0; k < abs; k++) {
    const si = (k % 18) + 1; // 1..18 repeating
    const holeIdx = strokeIndexes.indexOf(si);
    if (holeIdx >= 0) arr[holeIdx] += 1;
  }
  return arr;
}

/**
 * buildHcpAdjustments(playerHcp, hcpPercent, strokeIndexes)
 * Used for NET + STB (per player).
 */
export function buildHcpAdjustments(playerHcp, hcpPercent, strokeIndexes) {
  const strokes = Math.max(0, Math.round((playerHcp || 0) * (toNum(hcpPercent) / 100)));
  return buildStrokeArray(strokes, strokeIndexes);
}

/**
 * For MATCHES we use DIFFERENCE of handicaps between players:
 * If A=1 and B=10 => B receives 9 strokes.
 * Returns { diff, strokesA[18], strokesB[18] }
 * diff > 0 => B receives diff strokes
 * diff < 0 => A receives abs(diff) strokes
 */
export function buildMatchStrokesByHcpDiff(hcpA, hcpB, hcpPercent, strokeIndexes) {
  const percent = toNum(hcpPercent) / 100;
  const diff = Math.round((hcpB - hcpA) * percent);

  const strokesA = diff < 0 ? buildStrokeArray(Math.abs(diff), strokeIndexes) : Array(18).fill(0);
  const strokesB = diff > 0 ? buildStrokeArray(diff, strokeIndexes) : Array(18).fill(0);

  return { diff, strokesA, strokesB };
}

// =====================
// Gross / Net totals
// =====================
export function sumGross(arr18) {
  let t = 0;
  for (let i = 0; i < 18; i++) {
    const n = safeInt(arr18?.[i]);
    if (n !== null) t += n;
  }
  return t;
}

export function sumNet(arr18, hcpAdj18) {
  let t = 0;
  for (let i = 0; i < 18; i++) {
    const g = safeInt(arr18?.[i]);
    if (g !== null) t += g - (hcpAdj18?.[i] || 0);
  }
  return t;
}

// =====================
// Stableford (net) scoring
// diff = par - net
// -2 or worse => 0
// -1 => 1
//  0 => 2
//  1 => 3
//  2 => 4
//  3+ => 5
// =====================
export function stablefordPoints(par, netScore) {
  if (par == null || netScore == null) return 0;
  const diff = par - netScore;

  if (diff <= -2) return 0;
  if (diff === -1) return 1;
  if (diff === 0) return 2;
  if (diff === 1) return 3;
  if (diff === 2) return 4;
  return 5; // diff >= 3
}

export function sumStableford(arr18, hcpAdj18, parValues) {
  let t = 0;
  for (let i = 0; i < 18; i++) {
    const g = safeInt(arr18?.[i]);
    if (g === null) continue;
    const net = g - (hcpAdj18?.[i] || 0);
    t += stablefordPoints(parValues?.[i], net);
  }
  return t;
}

// =====================
// Sorting helpers
// =====================
export function sortAscThenHcpAsc(a, b, key) {
  if (a[key] !== b[key]) return a[key] - b[key];     // lower is better
  return (a.hcp || 0) - (b.hcp || 0);                // tie-break: lower hcp wins
}

export function sortDescThenHcpAsc(a, b, key) {
  if (a[key] !== b[key]) return b[key] - a[key];     // higher is better
  return (a.hcp || 0) - (b.hcp || 0);
}

// =====================
// Leaderboards (Net + Stableford)
// =====================
export function computeLeaderboards({ groupsFull, courseId, hcpPercent }) {
  const course = COURSE_DATA[courseId] || COURSE_DATA["campestre-slp"];
  const { strokeIndexes, parValues } = course;

  const netRows = [];
  const stbRows = [];

  for (const g of groupsFull) {
    const players = g.players || [];
    const scores = g.scores || {};
    for (const p of players) {
      const arr = scores[p.id] || Array(18).fill("");

      const adj = buildHcpAdjustments(p.hcp || 0, hcpPercent, strokeIndexes);
      const net = sumNet(arr, adj);
      const stb = sumStableford(arr, adj, parValues);

      netRows.push({ name: p.name || "", hcp: p.hcp || 0, net, groupId: g.id, playerId: p.id });
      stbRows.push({ name: p.name || "", hcp: p.hcp || 0, stb, groupId: g.id, playerId: p.id });
    }
  }

  netRows.sort((a, b) => sortAscThenHcpAsc(a, b, "net"));
  stbRows.sort((a, b) => sortDescThenHcpAsc(a, b, "stb"));

  return { netRows, stbRows };
}

// =====================
// Match play (Front/Back/Total) using handicap difference
// =====================
function holeResult(aAdj, bAdj) {
  if (aAdj < bAdj) return 1;
  if (aAdj > bAdj) return -1;
  return 0;
}

export function computeMatchResultForPair({ a, b, scores, courseId, hcpPercent }) {
  const course = COURSE_DATA[courseId] || COURSE_DATA["campestre-slp"];
  const { strokeIndexes } = course;

  const grossA = scores[a.id] || Array(18).fill("");
  const grossB = scores[b.id] || Array(18).fill("");

  const { diff, strokesA, strokesB } = buildMatchStrokesByHcpDiff(
    a.hcp || 0,
    b.hcp || 0,
    hcpPercent,
    strokeIndexes
  );

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
// Dobladas / Money (segment fixed bet, doblada duplica ese segmento)
// =====================
function loserIdFromResult(segmentResult, aId, bId) {
  if (segmentResult === 0) return null;
  return segmentResult > 0 ? bId : aId; // if A winning => B losing
}

function segmentMultiplier({ segmentResult, aId, bId, requestedBy }) {
  if (!requestedBy) return 1;
  const loserId = loserIdFromResult(segmentResult, aId, bId);
  if (!loserId) return 1;
  return requestedBy === loserId ? 2 : 1;
}

/**
 * Money is from A perspective (+ means A wins money, - means A owes money).
 */
export function calcMatchMoneyForPair({ pairResult, aId, bId, matchBetsForPair, dobladasForPair }) {
  const f9Bet = toNum(matchBetsForPair?.f9);
  const b9Bet = toNum(matchBetsForPair?.b9);
  const tBet = toNum(matchBetsForPair?.total);

  const f9Mult = segmentMultiplier({
    segmentResult: pairResult.front,
    aId,
    bId,
    requestedBy: dobladasForPair?.f9By || null,
  });

  const b9Mult = segmentMultiplier({
    segmentResult: pairResult.back,
    aId,
    bId,
    requestedBy: dobladasForPair?.b9By || null,
  });

  const tMult = segmentMultiplier({
    segmentResult: pairResult.total,
    aId,
    bId,
    requestedBy: dobladasForPair?.totalBy || null,
  });

  const moneyF9 = pairResult.front === 0 ? 0 : Math.sign(pairResult.front) * f9Bet * f9Mult;
  const moneyB9 = pairResult.back === 0 ? 0 : Math.sign(pairResult.back) * b9Bet * b9Mult;
  const moneyT = pairResult.total === 0 ? 0 : Math.sign(pairResult.total) * tBet * tMult;

  return {
    moneyF9,
    moneyB9,
    moneyT,
    moneyTotal: moneyF9 + moneyB9 + moneyT,
    multipliers: { f9Mult, b9Mult, tMult },
  };
}

export function fmtMatch(v) {
  if (v === 0) return "AS";
  if (v > 0) return `+${v}`;
  return `${v}`;
}

export function fmtMoney(n) {
  const x = toNum(n);
  if (x === 0) return "$0";
  return x > 0 ? `+$${x.toFixed(0)}` : `-$${Math.abs(x).toFixed(0)}`;
}
