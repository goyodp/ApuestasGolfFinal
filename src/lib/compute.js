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
 * NET + Stableford (per player).
 */
export function buildHcpAdjustments(playerHcp, hcpPercent, strokeIndexes) {
  const strokes = Math.max(0, Math.round((playerHcp || 0) * (toNum(hcpPercent) / 100)));
  return buildStrokeArray(strokes, strokeIndexes);
}

/**
 * For MATCHES we use DIFFERENCE of handicaps between players:
 * If A=1 and B=10 => B receives 9 strokes.
 * Returns { diff, strokesA[18], strokesB[18] }
 * diff = (hcpB - hcpA) * %  => positive means B receives strokes
 */
export function buildMatchStrokesByHcpDiff(hcpA, hcpB, hcpPercent, strokeIndexes) {
  const percent = toNum(hcpPercent) / 100;
  const diff = Math.round((hcpB - hcpA) * percent);

  const strokesA = diff < 0 ? buildStrokeArray(Math.abs(diff), strokeIndexes) : Array(18).fill(0);
  const strokesB = diff > 0 ? buildStrokeArray(diff, strokeIndexes) : Array(18).fill(0);

  return { diff, strokesA, strokesB };
}

// =====================
// Totals (Gross/Net + segments)
// =====================
export function sumGross(arr18) {
  let t = 0;
  for (let i = 0; i < 18; i++) {
    const n = safeInt(arr18?.[i]);
    if (n !== null) t += n;
  }
  return t;
}

export function sumGross9(arr18, startIdx) {
  let t = 0;
  for (let i = startIdx; i < startIdx + 9; i++) {
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
// par -> 2, birdie -> 3, eagle -> 4, bogey -> 1, dbl bogey -> 0
// =====================
export function stablefordForHole({ gross, par, hcpAdj }) {
  const g = safeInt(gross);
  if (g === null) return 0;

  const net = g - (hcpAdj || 0);
  const pts = 2 + (par - net);
  return Math.max(0, pts);
}

export function sumStableford(arr18, parValues, hcpAdj18) {
  let t = 0;
  for (let i = 0; i < 18; i++) {
    t += stablefordForHole({
      gross: arr18?.[i],
      par: parValues?.[i] ?? 4,
      hcpAdj: hcpAdj18?.[i] || 0,
    });
  }
  return t;
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
// - Stableford: higher is better, tie-break lower hcp
// - Net: lower is better, tie-break lower hcp
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
      const net = sumNet(arr, adj);
      const stableford = sumStableford(arr, parValues, adj);

      stablefordRows.push({
        name: p.name || "",
        hcp: p.hcp || 0,
        stableford,
        groupId: g.id,
        playerId: p.id,
      });

      netRows.push({
        name: p.name || "",
        hcp: p.hcp || 0,
        net,
        groupId: g.id,
        playerId: p.id,
      });
    }
  }

  stablefordRows.sort(sortStablefordThenHcpAsc);
  netRows.sort(sortNetThenHcpAsc);

  return { stablefordRows, netRows };
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

export function computeMatchesByGroup({
  groupsFull,
  courseId,
  hcpPercent,
  matchBetsByGroup = {},
  dobladasByGroup = {},
}) {
  const out = {};

  for (const g of groupsFull) {
    const players = g.players || [];
    const scores = g.scores || {};
    const bets = matchBetsByGroup[g.id] || {};
    const dobladas = dobladasByGroup[g.id] || {};

    const res = [];

    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i];
        const b = players[j];

        const r = computeMatchResultForPair({ a, b, scores, courseId, hcpPercent });

        const key = pairKey(a.id, b.id);
        const bet = bets[key] || { f9: 0, b9: 0, total: 0 };
        const dbl = dobladas[key] || { f9By: null, b9By: null, totalBy: null };

        const money = calcMatchMoneyForPair({
          pairResult: r,
          aId: a.id,
          bId: b.id,
          matchBetsForPair: bet,
          dobladasForPair: dbl,
        });

        res.push({ ...r, bet, doblada: dbl, money });
      }
    }

    out[g.id] = res;
  }

  return out;
}

// =====================
// Dobladas / Money
// =====================
function loserIdFromResult(segmentResult, aId, bId) {
  if (segmentResult === 0) return null;
  return segmentResult > 0 ? bId : aId;
}

function segmentMultiplier({ segmentResult, aId, bId, requestedBy }) {
  if (!requestedBy) return 1;
  const loserId = loserIdFromResult(segmentResult, aId, bId);
  if (!loserId) return 1;
  return requestedBy === loserId ? 2 : 1;
}

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
