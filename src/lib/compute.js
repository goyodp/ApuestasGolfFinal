// src/lib/compute.js

// =====================
// COURSES
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
 * Builds an 18-length array of stroke adjustments by hole
 * - Positive strokes: player RECEIVES strokes (net = gross - adj)
 * - Negative strokes: player GIVES strokes (adj negative, net increases)
 */
export function buildStrokeArraySigned(strokes, strokeIndexes) {
  const s = Math.round(strokes || 0);
  const abs = Math.abs(s);
  const sign = s === 0 ? 0 : s > 0 ? 1 : -1;

  const arr = Array(18).fill(0);

  for (let k = 0; k < abs; k++) {
    const si = (k % 18) + 1; // 1..18 repeating
    const holeIdx = strokeIndexes.indexOf(si);
    if (holeIdx >= 0) arr[holeIdx] += sign;
  }

  return arr;
}

/**
 * NET + Stableford uses % global
 * Supports negative handicaps (plus) too.
 */
export function buildHcpAdjustments(playerHcp, hcpPercent, strokeIndexes) {
  const percent = toNum(hcpPercent) / 100;
  const strokes = Math.round((playerHcp || 0) * percent); // can be negative
  return buildStrokeArraySigned(strokes, strokeIndexes);
}

/**
 * MATCHES are ALWAYS 100% handicap difference (no global %)
 * (kept as-is: we only assign positive strokes to the higher hcp player)
 */
export function buildMatchStrokesByHcpDiff100(hcpA, hcpB, strokeIndexes) {
  const diff = Math.round((hcpB - hcpA) * 1);

  const strokesA =
    diff < 0 ? buildStrokeArraySigned(Math.abs(diff), strokeIndexes) : Array(18).fill(0);

  const strokesB =
    diff > 0 ? buildStrokeArraySigned(diff, strokeIndexes) : Array(18).fill(0);

  return { diff, strokesA, strokesB };
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

  const net = g - (hcpAdj || 0); // if hcpAdj negative -> net increases (plus handicap)
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
// Entry prizes (global polla)
// - entryFee per player
// - prize pool = entryFee * totalPlayers
// - distribution: 50% 1st Stableford, 30% 2nd Stableford, 20% best Net (excluding previous two)
// =====================
export function computeEntryPrizes({ groupsFull, courseId, hcpPercent, entryFee }) {
  const { stablefordRows, netRows } = computeLeaderboards({ groupsFull, courseId, hcpPercent });

  const totalPlayers = stablefordRows.length;
  const fee = toNum(entryFee);
  const pool = Math.max(0, fee * totalPlayers);

  const paid = {}; // playerKey => amount

  const firstStb = stablefordRows[0] || null;
  const secondStb = stablefordRows[1] || null;

  if (firstStb) paid[firstStb.playerKey] = (paid[firstStb.playerKey] || 0) + pool * 0.5;
  if (secondStb) paid[secondStb.playerKey] = (paid[secondStb.playerKey] || 0) + pool * 0.3;

  const excluded = new Set([firstStb?.playerKey, secondStb?.playerKey].filter(Boolean));
  const bestNet = netRows.find((r) => !excluded.has(r.playerKey)) || null;
  if (bestNet) paid[bestNet.playerKey] = (paid[bestNet.playerKey] || 0) + pool * 0.2;

  const winners = {
    stableford1: firstStb,
    stableford2: secondStb,
    net1: bestNet,
  };

  return { pool, totalPlayers, entryFee: fee, winners, payoutsByPlayerKey: paid };
}

// =====================
// Match play using 100% diff
// =====================
function holeResult(aAdj, bAdj) {
  if (aAdj < bAdj) return 1;
  if (aAdj > bAdj) return -1;
  return 0;
}

export function computeMatchResultForPair({ a, b, scores, courseId }) {
  const course = COURSE_DATA[courseId] || COURSE_DATA["campestre-slp"];
  const { strokeIndexes } = course;

  const grossA = scores[a.id] || Array(18).fill("");
  const grossB = scores[b.id] || Array(18).fill("");

  const { diff, strokesA, strokesB } = buildMatchStrokesByHcpDiff100(
    a.hcp || 0,
    b.hcp || 0,
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
// Money logic
// - Doblada checkbox FREE: doubles segment always
// - bet is single: { amount }
// =====================
function segmentMultiplier(dobladaEnabled) {
  return dobladaEnabled ? 2 : 1;
}

/**
 * money is from A perspective
 */
export function calcMatchMoneyForPair({ pairResult, matchBetsForPair, dobladasForPair }) {
  const bet = toNum(matchBetsForPair?.amount);

  const f9Mult = segmentMultiplier(!!dobladasForPair?.f9);
  const b9Mult = segmentMultiplier(!!dobladasForPair?.b9);

  const moneyF9 = pairResult.front === 0 ? 0 : Math.sign(pairResult.front) * bet * f9Mult;
  const moneyB9 = pairResult.back === 0 ? 0 : Math.sign(pairResult.back) * bet * b9Mult;
  const moneyT = pairResult.total === 0 ? 0 : Math.sign(pairResult.total) * bet;

  return {
    moneyF9,
    moneyB9,
    moneyT,
    moneyTotal: moneyF9 + moneyB9 + moneyT,
    multipliers: { f9Mult, b9Mult },
  };
}

// =====================
// Bonus by player (birdie/eagle/albatross) zero-sum
// =====================
export function computeBonusMoneyByPlayer({ players, scores, parValues, groupSettings }) {
  const n = players.length;
  const net = {};
  players.forEach((p) => (net[p.id] = 0));
  if (n <= 1) return net;

  const birdiePay = toNum(groupSettings?.birdiePay);
  const eaglePay = toNum(groupSettings?.eaglePay);
  const albatrossPay = toNum(groupSettings?.albatrossPay);

  for (const p of players) {
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

      for (const other of players) {
        if (other.id === p.id) net[other.id] += pay * (n - 1);
        else net[other.id] -= pay;
      }
    }
  }

  return net;
}

// =====================
// Greens by player (par3 winners) zero-sum
// =====================
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

// =====================
// Matches money by player (sum across pairs) zero-sum
// =====================
export function computeMatchesMoneyByPlayer({ players, scores, courseId, matchBets, dobladas }) {
  const out = {};
  players.forEach((p) => (out[p.id] = 0));

  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i];
      const b = players[j];
      const key = pairKey(a.id, b.id);

      const bet = matchBets?.[key] || { amount: 0 };
      const dbl = dobladas?.[key] || { f9: false, b9: false };

      const pairRes = computeMatchResultForPair({ a, b, scores, courseId });
      const money = calcMatchMoneyForPair({
        pairResult: pairRes,
        matchBetsForPair: bet,
        dobladasForPair: dbl,
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
