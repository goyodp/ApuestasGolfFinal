import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../firebase/db";

// Ajusta si luego metes courses dinámicos
const parValues = [4, 3, 4, 4, 4, 4, 5, 3, 5, 5, 3, 4, 4, 4, 3, 4, 4, 5];

function makePlayerId(existingIds = []) {
  // p1..p6, el primero libre
  for (let i = 1; i <= 6; i++) {
    const id = `p${i}`;
    if (!existingIds.includes(id)) return id;
  }
  return `p${Date.now()}`;
}

export default function GroupScorecard() {
  const { sessionId, groupId } = useParams();
  const navigate = useNavigate();

  const [state, setState] = useState(null);
  const [groupMeta, setGroupMeta] = useState(null);
  const [saving, setSaving] = useState(false);

  const groupRef = useMemo(() => {
    if (!sessionId || !groupId) return null;
    return doc(db, "sessions", sessionId, "groups", groupId);
  }, [sessionId, groupId]);

  const stateRef = useMemo(() => {
    if (!sessionId || !groupId) return null;
    return doc(db, "sessions", sessionId, "groups", groupId, "state", "main");
  }, [sessionId, groupId]);

  useEffect(() => {
    if (!groupRef) return;
    const unsub = onSnapshot(groupRef, (snap) => {
      setGroupMeta(snap.exists() ? snap.data() : null);
    });
    return () => unsub();
  }, [groupRef]);

  useEffect(() => {
    if (!stateRef) return;
    const unsub = onSnapshot(stateRef, (snap) => {
      setState(snap.exists() ? snap.data() : null);
    });
    return () => unsub();
  }, [stateRef]);

  const players = state?.players || [];
  const scores = state?.scores || {};

  const patchState = async (patch) => {
    if (!stateRef) return;
    setSaving(true);
    try {
      await updateDoc(stateRef, {
        ...patch,
        updatedAt: serverTimestamp(),
      });
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

    // Limpia greenies si ese player estaba seleccionado
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

    await patchState({
      scores: { ...scores, [playerId]: arr },
    });
  };

  if (!sessionId || !groupId) return <div style={{ padding: 20 }}>Faltan parámetros.</div>;
  if (!groupMeta || !state) return <div style={{ padding: 20 }}>Cargando grupo...</div>;

  return (
    <div style={{ padding: 20, fontFamily: "system-ui", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>
            {groupMeta.name || groupId}
          </h1>
          <div style={{ opacity: 0.8, marginTop: 6 }}>
            Session: <code>{sessionId}</code> · Group: <code>{groupId}</code>
            {saving ? <span style={{ marginLeft: 10 }}>Guardando…</span> : null}
          </div>
        </div>

        <button onClick={() => navigate(`/session/${sessionId}`)} style={{ padding: "8px 12px" }}>
          ← Volver
        </button>
      </div>

      <hr style={{ margin: "18px 0" }} />

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={addPlayer} disabled={players.length >= 6} style={{ padding: "10px 14px" }}>
          + Agregar jugador ({players.length}/6)
        </button>
      </div>

      <div style={{ marginTop: 16, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
          <thead>
            <tr>
              <th style={thSticky}>Jugador</th>
              {Array.from({ length: 18 }).map((_, i) => (
                <th key={i} style={th}>{i + 1}</th>
              ))}
              <th style={th}>Total</th>
            </tr>
            <tr>
              <th style={thStickySmall}>Hcp</th>
              {parValues.map((p, i) => (
                <th key={i} style={thMuted}>Par {p}</th>
              ))}
              <th style={thMuted}></th>
            </tr>
          </thead>

          <tbody>
            {players.map((p) => {
              const arr = scores[p.id] || Array(18).fill("");
              const total = arr.reduce((acc, v) => acc + (parseInt(v) || 0), 0);

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
                        <button
                          onClick={() => removePlayer(p.id)}
                          style={btnDanger}
                          title="Quitar jugador"
                        >
                          Quitar
                        </button>
                      </div>
                    </div>
                  </td>

                  {Array.from({ length: 18 }).map((_, h) => (
                    <td key={h} style={td}>
                      <input
                        inputMode="numeric"
                        defaultValue={arr[h] ?? ""}
                        onBlur={(e) => updateScore(p.id, h, e.target.value)}
                        style={inputScore}
                      />
                    </td>
                  ))}

                  <td style={{ ...td, fontWeight: 900 }}>{total || ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th = {
  textAlign: "center",
  padding: 8,
  background: "#1a1a1a",
  color: "white",
  fontWeight: 800,
  borderBottom: "1px solid #2a2a2a",
};

const thMuted = { ...th, opacity: 0.7, fontWeight: 600, fontSize: 12 };
const thSticky = { ...th, position: "sticky", left: 0, zIndex: 2, textAlign: "left", minWidth: 220 };
const thStickySmall = { ...thMuted, position: "sticky", left: 0, zIndex: 2, textAlign: "left" };

const td = { padding: 6, textAlign: "center", background: "#0f0f0f", color: "white" };
const tdSticky = { ...td, position: "sticky", left: 0, zIndex: 1, textAlign: "left", minWidth: 220 };

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
  width: 44,
  padding: "8px 6px",
  borderRadius: 10,
  border: "1px solid #2a2a2a",
  background: "#111",
  color: "white",
  textAlign: "center",
  fontWeight: 700,
};

const btnDanger = {
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid #3a1a1a",
  background: "#1a0f0f",
  color: "#ffb4b4",
  fontWeight: 800,
};
