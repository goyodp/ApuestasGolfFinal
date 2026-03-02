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
// Score category (color)
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
export function buildStrokeArray(strokes, strokeIndexes) {
  const abs = Math.abs(Math.round(strokes || 0));
  const arr = Array(18).fill(0);

  for (let k = 0; k < abs; k++) {
    const si = (k % 18) + 1;
    const holeIdx = strokeIndexes.indexOf(si);
    if (holeIdx >= 0) arr[holeIdx] += 1;
  }
  return arr;
}

export function buildHcpAdjustments(playerHcp, hcpPercent, strokeIndexes) {
  const strokes = Math.max(0, Math.round((playerHcp || 0) * (toNum(hcpPercent) / 100)));
  return buildStrokeArray(strokes, strokeIndexes);
}

export function buildMatchStrokesByHcpDiff(hcpA, hcpB, hcpPercent, strokeIndexes) {
  const percent = toNum(hcpPercent) / 100;
  const diff = Math.round((hcpB - hcpA) * percent);

  const strokesA = diff < 0 ? buildStrokeArray(Math.abs(diff), strokeIndexes) : Array(18).fill(0);
  const strokesB = diff > 0 ? buildStrokeArray(diff, strokeIndexes) : Array(18).fill(0);

  return { diff, strokesA, strokesB };
}

// =====================
// Totals
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
// =====================
function roundMoney(n) {
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

  awards.push({
    label: "🥇 1º Stableford (50%)",
    amount: roundMoney(pool * pct1),
    name: s1?.name || "",
    meta: s1 ? `STB ${s1.stableford} · HCP ${s1.hcp} · ${s1.groupId}` : "-",
    playerKey: s1?.playerKey || null,
  });

  awards.push({
    label: "🥈 2º Stableford (30%)",
    amount: roundMoney(pool * pct2),
    name: s2?.name || "",
    meta: s2 ? `STB ${s2.stableford} · HCP ${s2.hcp} · ${s2.groupId}` : "-",
    playerKey: s2?.playerKey || null,
  });

  awards.push({
    label: "🏅 1º Net (20%)",
    amount: roundMoney(pool * pct3),
    name: n1?.name || "",
    meta: n1 ? `NET ${n1.net} · HCP ${n1.hcp} · ${n1.groupId}` : "-",
    playerKey: n1?.playerKey || null,
  });

  return { pool, awards };
}

// =====================
// Match play
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
// Dobladas / Money (por pareja)
// - checkbox true => "doblada pedida por el que va perdiendo"
// =====================
function loserIdFromResult(segmentResult, aId, bId) {
  if (segmentResult === 0) return null;
  return segmentResult > 0 ? bId : aId;
}

function segmentMultiplier({ segmentResult, aId, bId, dobladaEnabled }) {
  if (!dobladaEnabled) return 1;
  const loserId = loserIdFromResult(segmentResult, aId, bId);
  if (!loserId) return 1;
  // checkbox means loser asked => always valid if there is a loser
  return 2;
}

export function calcMatchMoneyForPair({ pairResult, aId, bId, matchBetsForPair, dobladasForPair }) {
  const f9Bet = toNum(matchBetsForPair?.f9);
  const b9Bet = toNum(matchBetsForPair?.b9);
  const tBet = toNum(matchBetsForPair?.total);

  const f9Mult = segmentMultiplier({
    segmentResult: pairResult.front,
    aId,
    bId,
    dobladaEnabled: !!dobladasForPair?.f9,
  });

  const b9Mult = segmentMultiplier({
    segmentResult: pairResult.back,
    aId,
    bId,
    dobladaEnabled: !!dobladasForPair?.b9,
  });

  const moneyF9 = pairResult.front === 0 ? 0 : Math.sign(pairResult.front) * f9Bet * f9Mult;
  const moneyB9 = pairResult.back === 0 ? 0 : Math.sign(pairResult.back) * b9Bet * b9Mult;
  const moneyT = pairResult.total === 0 ? 0 : Math.sign(pairResult.total) * tBet;

  return {
    moneyF9,
    moneyB9,
    moneyT,
    moneyTotal: moneyF9 + moneyB9 + moneyT,
    multipliers: { f9Mult, b9Mult },
  };
}

// =====================
// BONUS (Birdie/Eagle/Albatross) money by player
// - each occurrence is paid by every other player in the group
// =====================
export function computeBonusMoneyByPlayer({ players, scores, parValues, groupSettings }) {
  const n = players.length;
  const out = {};
  players.forEach((p) => (out[p.id] = 0));
  if (n <= 1) return out;

  const birdiePay = toNum(groupSettings?.birdiePay);
  const eaglePay = toNum(groupSettings?.eaglePay);
  const albatrossPay = toNum(groupSettings?.albatrossPay);

  for (const p of players) {
    const arr = scores[p.id] || Array(18).fill("");
    let money = 0;

    for (let i = 0; i < 18; i++) {
      const g = safeInt(arr[i]);
      if (g === null) continue;

      const par = parValues?.[i] ?? 4;
      const diff = g - par; // -1 birdie, -2 eagle, <=-3 albatross/hio

      if (diff === -1) money += birdiePay * (n - 1);
      else if (diff === -2) money += eaglePay * (n - 1);
      else if (diff <= -3) money += albatrossPay * (n - 1);
    }

    out[p.id] = money;
  }

  // everyone else pays those occurrences implicitly; the net of this system is not zero-sum unless you also subtract payers.
  // But the Excel is effectively zero-sum per category. We’ll make it zero-sum by distributing payments:
  // Net for player i = earned_i - average? No: exact zero-sum is achieved by subtracting each event from all others.
  // Equivalent: out already counts what i receives from others, so total paid by others equals total received.
  // No extra step needed because payers aren't tracked individually; totals across players can exceed 0 if you only sum winners.
  // So we must convert to net: each event adds +pay*(n-1) to winner and -pay to each other.
  // We'll do that now by iterating events again and applying per-player.
  const net = {};
  players.forEach((p) => (net[p.id] = 0));

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

      // winner gets +pay*(n-1), each other pays -pay
      for (const other of players) {
        if (other.id === p.id) net[other.id] += pay * (n - 1);
        else net[other.id] -= pay;
      }
    }
  }

  return net;
}

// =====================
// GREENS money by player
// - per par3 hole, selected winner gets +greensPay*(n-1), each other pays -greensPay
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
// MATCHES money by player (sum across pairs)
// =====================
export function computeMatchesMoneyByPlayer({ players, scores, courseId, hcpPercent, matchBets, dobladas }) {
  const out = {};
  players.forEach((p) => (out[p.id] = 0));

  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i];
      const b = players[j];
      const key = pairKey(a.id, b.id);

      const bet = matchBets?.[key] || { f9: 0, b9: 0, total: 0 };
      const dbl = dobladas?.[key] || { f9: false, b9: false };

      const pairRes = computeMatchResultForPair({ a, b, scores, courseId, hcpPercent });
      const money = calcMatchMoneyForPair({
        pairResult: pairRes,
        aId: a.id,
        bId: b.id,
        matchBetsForPair: bet,
        dobladasForPair: dbl,
      });

      // moneyTotal is from A perspective:
      // + => A wins money, - => A loses money
      out[a.id] += money.moneyTotal;
      out[b.id] -= money.moneyTotal;
    }
  }

  return out;
}
