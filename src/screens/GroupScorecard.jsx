// src/screens/GroupScorecard.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase/db";
import { COURSE_DATA, buildHcpAdjustments, sumNet9, sumGross9, sumStableford9 } from "../lib/compute";

function makePlayerId(existingIds = []) {
  for (let i = 1; i <= 6; i++) {
    const id = `p${i}`;
    if (!existingIds.includes(id)) return id;
  }
  return `p${Date.now()}`;
}

const DEFAULT_STATE = {
  players: [],
  scores: {},
  payouts: { birdie: 10, eagle: 20, albatross: 30, greenie: 10 },
  matchBets: {},
  dobladas: {},
  greenies: {},
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
};

export default function GroupScorecard() {
  const { sessionId, groupId } = useParams();
  const navigate = useNavigate();

  const [groupMeta, setGroupMeta] = useState(null);
  const [session, setSession] = useState(null);
  const [state, setState] = useState(undefined); // undefined=loading, null=error, obj=ok
  const [saving, setSaving] = useState(false);

  const sessionRef = useMemo(() => {
    if (!sessionId) return null;
    return doc(db, "sessions", sessionId);
  }, [sessionId]);

  const groupRef = useMemo(() => {
    if (!sessionId || !groupId) return null;
    return doc(db, "sessions", sessionId, "groups", groupId);
  }, [sessionId, groupId]);

  const stateRef = useMemo(() => {
    if (!sessionId || !groupId) return null;
    return doc(db, "sessions", sessionId, "groups", groupId, "state", "main");
  }, [sessionId, groupId]);

  useEffect(() => {
    if (!sessionRef) return;
    return onSnapshot(sessionRef, (snap) => setSession(snap.exists() ? snap.data() : null));
  }, [sessionRef]);

  useEffect(() => {
    if (!groupRef) return;
    return onSnapshot(groupRef, (snap) => setGroupMeta(snap.exists() ? snap.data() : null));
  }, [groupRef]);

  // Listener + auto init
  useEffect(() => {
    if (!stateRef) return;

    const unsub = onSnapshot(stateRef, async (snap) => {
      if (snap.exists()) {
        setState(snap.data());
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

  const players = state?.players || [];
  const scores = state?.scores || {};

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
    if (players.length >= 6) {
      alert("Máximo 6 jugadores por grupo.");
      return;
    }
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

    const greenies = state.greenies || {};
    const newGreenies = { ...greenies };
    Object.keys(newGreenies).forEach((h) => {
      if (newGreenies[h] === playerId) delete newGreenies[h];
    });

    await patchState({ players: newPlayers, scores: newScores, greenies: newGreenies });
  };

  const updatePlayer = async (playerId, field, value) => {
    if (!state) return;
    const newPlayers = players.map((p) => (p.id === playerId ? { ...p, [field]: value } : p));
    await patchState({ players: newPlayers });
  };

  const updateScore = async (playerId, holeIndex, value) => {
    if (!state) return;
    const arr = Array.isArray(scores[playerId]) ? [...scores[playerId]] : Array(18).fill("");
    arr[holeIndex] = value;
    await patchState({ scores: { ...scores, [playerId]: arr } });
  };

  if (!sessionId || !groupId) return <div style={{ padding: 20 }}>Faltan parámetros.</div>;

  if (!groupMeta || state === undefined || !session) return <div style={{ padding: 20 }}>Cargando grupo...</div>;
  if (state === null) return <div style={{ padding: 20 }}>No pude crear state/main (revisa reglas).</div>;

  return (
    <div style={page}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>
            {groupMeta?.name || groupId}
          </h1>
          <div style={{ opacity: 0.8, marginTop: 6 }}>
            Campo: <b>{course.name}</b> · %Hcp: <b>{hcpPercent}</b>
            {saving ? <span style={{ marginLeft: 10 }}>Guardando…</span> : null}
          </div>
        </div>

        <button onClick={() => navigate(`/session/${sessionId}`)} style={btn}>
          ← Volver
        </button>
      </div>

      <hr style={hr} />

      <button onClick={addPlayer} disabled={players.length >= 6} style={btnPrimary}>
        + Agregar jugador ({players.length}/6)
      </button>

      <div style={{ marginTop: 14, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1100 }}>
          <thead>
            <tr>
              <th style={thSticky}>Jugador</th>

              {/* Front 9 */}
              {Array.from({ length: 9 }).map((_, i) => (
                <th key={`f-${i}`} style={th}>{i + 1}</th>
              ))}
              <th style={thStrong}>F9</th>

              {/* Back 9 */}
              {Array.from({ length: 9 }).map((_, i) => (
                <th key={`b-${i}`} style={th}>{i + 10}</th>
              ))}
              <th style={thStrong}>B9</th>

              <th style={thStrong}>Tot</th>
              <th style={thMuted}>Net</th>
              <th style={thMuted}>STB</th>
            </tr>

            <tr>
              <th style={thStickySmall}>Hcp</th>

              {course.parValues.slice(0, 9).map((p, i) => (
                <th key={`pf-${i}`} style={thMuted}>Par {p}</th>
              ))}
              <th style={thMuted}></th>

              {course.parValues.slice(9).map((p, i) => (
                <th key={`pb-${i}`} style={thMuted}>Par {p}</th>
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

              return (
                <tr key={p.id} style={{ borderTop: "1px solid #2a2a2a" }}>
                  <td style={tdSticky}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <input
                        defaultValue={p.name}
                        onBlur={(e) => updatePlayer(p.id, "name", e.target.value)}
                        style={inputName}
                      />
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                          type="number"
                          defaultValue={p.hcp}
                          onBlur={(e) => updatePlayer(p.id, "hcp", parseFloat(e.target.value || "0"))}
                          style={inputHcp}
                        />
                        <button onClick={() => removePlayer(p.id)} style={btnDanger}>
                          Quitar
                        </button>
                      </div>
                    </div>
                  </td>

                  {/* Front 9 holes */}
                  {Array.from({ length: 9 }).map((_, h) => (
                    <td key={`sf-${p.id}-${h}`} style={td}>
                      <input
                        inputMode="numeric"
                        defaultValue={arr[h] ?? ""}
                        onBlur={(e) => updateScore(p.id, h, e.target.value)}
                        style={inputScore}
                      />
                    </td>
                  ))}
                  <td style={tdStrong}>{grossF9 || ""}</td>

                  {/* Back 9 holes */}
                  {Array.from({ length: 9 }).map((_, i) => {
                    const h = i + 9;
                    return (
                      <td key={`sb-${p.id}-${h}`} style={td}>
                        <input
                          inputMode="numeric"
                          defaultValue={arr[h] ?? ""}
                          onBlur={(e) => updateScore(p.id, h, e.target.value)}
                          style={inputScore}
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
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- styles ----------
const page = {
  padding: 16,
  fontFamily: "system-ui",
  maxWidth: 1100,
  margin: "0 auto",
  color: "white",
};

const hr = { margin: "14px 0", borderColor: "#2a2a2a" };

const th = {
  textAlign: "center",
  padding: 8,
  background: "#1a1a1a",
  color: "white",
  fontWeight: 800,
  borderBottom: "1px solid #2a2a2a",
  whiteSpace: "nowrap",
};

const thMuted = { ...th, opacity: 0.7, fontWeight: 700, fontSize: 12 };
const thStrong = { ...th, background: "#111827" };

const thSticky = { ...th, position: "sticky", left: 0, zIndex: 2, textAlign: "left", minWidth: 220 };
const thStickySmall = { ...thMuted, position: "sticky", left: 0, zIndex: 2, textAlign: "left" };

const td = { padding: 6, textAlign: "center", background: "#0f0f0f", color: "white" };
const tdSticky = { ...td, position: "sticky", left: 0, zIndex: 1, textAlign: "left", minWidth: 220 };
const tdStrong = { ...td, fontWeight: 900, background: "#0b1220" };
const tdMutedCell = { ...td, opacity: 0.9, background: "#0b0b0b", fontWeight: 900 };

const inputName = {
  width: "100%",
  padding: "10px 10px",
  borderRadius: 12,
  border: "1px solid #2a2a2a",
  background: "#111",
  color: "white",
  fontWeight: 800,
};

const inputHcp = {
  width: 80,
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid #2a2a2a",
  background: "#111",
  color: "white",
  fontWeight: 700,
};

const inputScore = {
  width: 42,
  padding: "8px 6px",
  borderRadius: 10,
  border: "1px solid #2a2a2a",
  background: "#111",
  color: "white",
  textAlign: "center",
  fontWeight: 700,
};

const btn = {
  padding: "10px 14px",
  borderRadius: 14,
  border: "1px solid #2a2a2a",
  background: "#141414",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};

const btnPrimary = { ...btn, background: "#1f2937", border: "1px solid #374151" };

const btnDanger = {
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid #3a1a1a",
  background: "#1a0f0f",
  color: "#ffb4b4",
  fontWeight: 800,
};
