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
 * Used for NET leaderboard (per player).
 * Applies handicap % at session level.
 */
export function buildHcpAdjustments(playerHcp, hcpPercent, strokeIndexes) {
  const strokes = Math.max(
    0,
    Math.round((playerHcp || 0) * (toNum(hcpPercent) / 100))
  );
  return buildStrokeArray(strokes, strokeIndexes);
}

/**
 * For MATCHES we use DIFFERENCE of handicaps between players:
 * If A=1 and B=10 => B receives 9 strokes.
 * Returns { strokesA[18], strokesB[18] }
 */
export function buildMatchStrokesByHcpDiff(hcpA, hcpB, hcpPercent, strokeIndexes) {
  const percent = toNum(hcpPercent) / 100;
  const diff = Math.round((hcpB - hcpA) * percent); // positive => B receives, negative => A receives

  const strokesA = diff < 0 ? buildStrokeArray(Math.abs(diff), strokeIndexes) : Array(18).fill(0);
  const strokesB = diff > 0 ? buildStrokeArray(diff, strokeIndexes) : Array(18).fill(0);

  return { diff, strokesA, strokesB };
}

// =====================
// Gross / Net leaderboards
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

/**
 * tie-break: if same gross/net, player with LOWER handicap ranks higher.
 */
export function sortByScoreThenHcpAsc(a, b, scoreKey) {
  if (a[scoreKey] !== b[scoreKey]) return a[scoreKey] - b[scoreKey]; // lower is better
  return (a.hcp || 0) - (b.hcp || 0);
}

/**
 * computeLeaderboards({ groupsFull, courseId, hcpPercent })
 * groupsFull: [{ id, players:[{id,name,hcp}], scores:{[pid]:[18]} }, ...]
 */
export function computeLeaderboards({ groupsFull, courseId, hcpPercent }) {
  const course = COURSE_DATA[courseId] || COURSE_DATA["campestre-slp"];
  const { strokeIndexes } = course;

  const grossRows = [];
  const netRows = [];

  for (const g of groupsFull) {
    const players = g.players || [];
    const scores = g.scores || {};
    for (const p of players) {
      const arr = scores[p.id] || Array(18).fill("");
      const gross = sumGross(arr);

      const adj = buildHcpAdjustments(p.hcp || 0, hcpPercent, strokeIndexes);
      const net = sumNet(arr, adj);

      grossRows.push({ name: p.name || "", hcp: p.hcp || 0, gross, groupId: g.id, playerId: p.id });
      netRows.push({ name: p.name || "", hcp: p.hcp || 0, net, groupId: g.id, playerId: p.id });
    }
  }

  grossRows.sort((a, b) => sortByScoreThenHcpAsc(a, b, "gross"));
  netRows.sort((a, b) => sortByScoreThenHcpAsc(a, b, "net"));

  return { grossRows, netRows };
}

// =====================
// Match play (Front/Back/Total) using handicap difference
// =====================
function holeResult(aAdj, bAdj) {
  if (aAdj < bAdj) return 1;
  if (aAdj > bAdj) return -1;
  return 0;
}

export function computeMatchResultForPair({
  a,
  b,
  scores,        // scores dict { [pid]: [18] }
  courseId,
  hcpPercent,
}) {
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
    diff, // (hcpB-hcpA)*%  => positive means B receives strokes
    front,
    back,
    total: front + back,
  };
}

/**
 * computeMatchesByGroup
 * Returns { [groupId]: [ {label,front,back,total,diff,..., moneyBreakdown } ] }
 */
export function computeMatchesByGroup({
  groupsFull,
  courseId,
  hcpPercent,
  matchBetsByGroup = {},   // { [groupId]: { "p1|p2": {f9,b9,total}, ... } }
  dobladasByGroup = {},    // { [groupId]: { "p1|p2": {f9By,b9By,totalBy}, ... } }
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

        const r = computeMatchResultForPair({
          a,
          b,
          scores,
          courseId,
          hcpPercent,
        });

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
  if (segmentResult === 0) return null;      // AS
  return segmentResult > 0 ? bId : aId;      // if A is winning => B is losing
}

function segmentMultiplier({ segmentResult, aId, bId, requestedBy }) {
  if (!requestedBy) return 1;
  const loserId = loserIdFromResult(segmentResult, aId, bId);
  if (!loserId) return 1;
  return requestedBy === loserId ? 2 : 1;    // only the loser can double
}

/**
 * Money is from A perspective (+ means A wins money, - means A owes money).
 * Doblada doubles that segment ONLY if requestedBy was losing that segment.
 */
export function calcMatchMoneyForPair({
  pairResult,          // {front,back,total}
  aId,
  bId,
  matchBetsForPair,    // {f9,b9,total}
  dobladasForPair      // {f9By,b9By,totalBy}
}) {
  const f9Bet = toNum(matchBetsForPair?.f9);
  const b9Bet = toNum(matchBetsForPair?.b9);
  const tBet  = toNum(matchBetsForPair?.total);

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
  const moneyB9 = pairResult.back  === 0 ? 0 : Math.sign(pairResult.back)  * b9Bet * b9Mult;
  const moneyT  = pairResult.total === 0 ? 0 : Math.sign(pairResult.total) * tBet  * tMult;

  return {
    moneyF9,
    moneyB9,
    moneyT,
    moneyTotal: moneyF9 + moneyB9 + moneyT,
    multipliers: { f9Mult, b9Mult, tMult },
  };
}

// =====================
// Player totals (matches money only)
// =====================
export function computePlayerMatchTotals({
  groupsFull,
  matchesByGroup, // output from computeMatchesByGroup
}) {
  const totals = {}; // { [playerId]: {name, groupId, total} }

  for (const g of groupsFull) {
    const players = g.players || [];
    for (const p of players) {
      totals[p.id] = totals[p.id] || { playerId: p.id, name: p.name || "", groupId: g.id, matchMoney: 0 };
    }

    const matches = matchesByGroup[g.id] || [];
    for (const m of matches) {
      const aId = m.a?.id;
      const bId = m.b?.id;
      const moneyA = toNum(m.money?.moneyTotal);

      // A perspective:
      if (aId && totals[aId]) totals[aId].matchMoney += moneyA;
      if (bId && totals[bId]) totals[bId].matchMoney -= moneyA;
    }
  }

  return Object.values(totals);
}

// =====================
// Format helpers (optional)
// =====================
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
