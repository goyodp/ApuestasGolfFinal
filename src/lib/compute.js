// src/lib/compute.js

// =====================
// COURSES (global day selection)
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

export function playerKey(groupId, playerId) {
  return `${groupId}::${playerId}`;
}

// =====================
// Score category (for coloring inputs)
// =====================
export function scoreCategory(gross, par) {
  const g = safeInt(gross);
  if (g === null) return "none";
  const d = g - (par ?? 4);
  // -3 or better => albatross/hio bucket
  if (d <= -3) return "albatross";
  if (d === -2) return "eagle";
  if (d === -1) return "birdie";
  if (d === 1) return "bogey";
  if (d >= 2) return "double";
  return "none"; // par (0) or anything else
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

      const pk = playerKey(g.id, p.id);

      stablefordRows.push({
        name: p.name || "",
        hcp: p.hcp || 0,
        stableford,
        groupId: g.id,
        playerId: p.id,
        playerKey: pk,
      });

      netRows.push({
        name: p.name || "",
        hcp: p.hcp || 0,
        net,
        groupId: g.id,
        playerId: p.id,
        playerKey: pk,
      });
    }
  }

  stablefordRows.sort(sortStablefordThenHcpAsc);
  netRows.sort(sortNetThenHcpAsc);

  return { stablefordRows, netRows };
}

// =====================
// Entry prize distribution
// - Pool = entryFee * totalPlayers
// - 50% to 1st Stableford
// - 30% to 2nd Stableford
// - 20% to best Net (excluding previous winners)
// =====================
function roundMoney(n) {
  // keep it simple integer pesos
  return Math.round(toNum(n));
}

export function computeEntryPrizes({ stablefordRows, netRows, entryFee, totalPlayers }) {
  const pool = roundMoney(toNum(entryFee) * toNum(totalPlayers));

  const pct1 = 0.5;
  const pct2 = 0.3;
  const pct3 = 0.2;

  const awards = [];
  const used = new Set();

  const s1 = stablefordRows?.[0] || null;
  if (s1) used.add(s1.playerKey);

  const s2 = stablefordRows?.find((r, idx) => idx > 0 && !used.has(r.playerKey)) || null;
  if (s2) used.add(s2.playerKey);

  const n1 = netRows?.find((r) => !used.has(r.playerKey)) || null;
  if (n1) used.add(n1.playerKey);

  const a1 = roundMoney(pool * pct1);
  const a2 = roundMoney(pool * pct2);
  const a3 = roundMoney(pool * pct3);

  awards.push({
    label: "🥇 1º Stableford (50%)",
    amount: a1,
    name: s1?.name || "",
    meta: s1 ? `STB ${s1.stableford} · HCP ${s1.hcp} · ${s1.groupId}` : "-",
    playerKey: s1?.playerKey || null,
  });

  awards.push({
    label: "🥈 2º Stableford (30%)",
    amount: a2,
    name: s2?.name || "",
    meta: s2 ? `STB ${s2.stableford} · HCP ${s2.hcp} · ${s2.groupId}` : "-",
    playerKey: s2?.playerKey || null,
  });

  awards.push({
    label: "🏅 1º Net (20%)",
    amount: a3,
    name: n1?.name || "",
    meta: n1 ? `NET ${n1.net} · HCP ${n1.hcp} · ${n1.groupId}` : "-",
    playerKey: n1?.playerKey || null,
  });

  return { pool, awards };
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
