// src/lib/compute.js
export function buildStrokeArray(diff, strokeIndexes) {
  // diff > 0 => Player A recibe diff golpes (se le resta en net)
  // diff < 0 => Player B recibe |diff| golpes
  const abs = Math.abs(Math.round(diff || 0));
  const strokes = Array(18).fill(0);
  for (let k = 0; k < abs; k++) {
    const si = (k % 18) + 1;                // 1..18
    const holeIdx = strokeIndexes.indexOf(si);
    if (holeIdx >= 0) strokes[holeIdx] += 1; // se repite si diff > 18 => dobles
  }
  return strokes;
}

export function calcNetScores(grossArr, strokesReceivedArr) {
  // net = gross - strokesReceived
  return grossArr.map((g, i) => {
    const gg = parseInt(g);
    if (Number.isNaN(gg)) return "";
    return gg - (strokesReceivedArr[i] || 0);
  });
}

export function stablefordPoints(net, par) {
  // clásico: net vs par
  // diff = par - net: 0=>2, 1=>3, 2=>4, 3+=>5, -1=>1, -2 o menos=>0
  const n = parseInt(net);
  if (Number.isNaN(n)) return 0;
  const d = par - n;
  if (d <= -2) return 0;
  if (d === -1) return 1;
  if (d === 0) return 2;
  if (d === 1) return 3;
  if (d === 2) return 4;
  return 5; // d >= 3
}

export function calcStablefordTotal(grossArr, hcpAdjArr, parValues) {
  let total = 0;
  for (let i = 0; i < 18; i++) {
    const g = parseInt(grossArr?.[i]);
    if (Number.isNaN(g)) continue;
    const net = g - (hcpAdjArr[i] || 0);
    total += stablefordPoints(net, parValues[i]);
  }
  return total;
}

export function calcNetTotal(grossArr, hcpAdjArr) {
  let total = 0;
  for (let i = 0; i < 18; i++) {
    const g = parseInt(grossArr?.[i]);
    if (Number.isNaN(g)) continue;
    total += g - (hcpAdjArr[i] || 0);
  }
  return total;
}

export function buildHcpAdjustments(playerHcp, hcpPercent, strokeIndexes) {
  // Ajuste tipo “Sheet”: reparte handicap por stroke index
  // totalStrokes puede ser > 18 => dobles
  const totalStrokes = Math.max(0, Math.round((playerHcp || 0) * (hcpPercent || 100) / 100));
  const adj = Array(18).fill(0);
  for (let s = 0; s < totalStrokes; s++) {
    const si = (s % 18) + 1;
    const holeIdx = strokeIndexes.indexOf(si);
    if (holeIdx >= 0) adj[holeIdx] += 1;
  }
  return adj;
}

export function matchPlayResult(netA, netB) {
  // retorna +1 si A gana, -1 si pierde, 0 empate (por hoyo)
  const a = parseInt(netA);
  const b = parseInt(netB);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  if (a < b) return 1;
  if (a > b) return -1;
  return 0;
}

export function calcMatchPair({ grossA, grossB, hcpAdjA, hcpAdjB }) {
  let front = 0, back = 0;
  for (let i = 0; i < 9; i++) {
    front += matchPlayResult(
      parseInt(grossA[i]) - (hcpAdjA[i] || 0),
      parseInt(grossB[i]) - (hcpAdjB[i] || 0)
    );
  }
  for (let i = 9; i < 18; i++) {
    back += matchPlayResult(
      parseInt(grossA[i]) - (hcpAdjA[i] || 0),
      parseInt(grossB[i]) - (hcpAdjB[i] || 0)
    );
  }
  return { front, back, total: front + back };
}
