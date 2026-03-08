// src/screens/Session.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase/db";
import { auth } from "../firebase/auth";

import {
  COURSE_DATA,
  computeLeaderboards,
  computeMatchResultForPair,
  fmtMatch,
  fmtMoney,
  computeEntryPrizes,
} from "../lib/compute";

/* ---------------- tiny utils ---------------- */

function clampInt(n, min, max) {
  const v = Number.isFinite(n) ? n : 0;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

function sanitizeIntInput(raw, { allowNegative = false } = {}) {
  const s = String(raw ?? "");
  let out = s.replace(/[^\d-]/g, "");
  if (!allowNegative) out = out.replace(/-/g, "");
  if (allowNegative) out = out.replace(/(?!^)-/g, "");
  if (out === "-" || out === "") return out;
  const sign = out.startsWith("-") ? "-" : "";
  const digits = out.replace(/-/g, "");
  const normalized = digits.replace(/^0+(?=\d)/, "");
  return sign + normalized;
}

function toast(msg) {
  const el = document.createElement("div");
  el.textContent = msg;
  Object.assign(el.style, {
    position: "fixed",
    left: "50%",
    bottom: "calc(18px + env(safe-area-inset-bottom))",
    transform: "translateX(-50%)",
    background: "rgba(15,23,42,0.92)",
    color: "white",
    padding: "10px 12px",
    borderRadius: "14px",
    border: "1px solid rgba(148,163,184,0.18)",
    fontWeight: 900,
    zIndex: 9999,
    maxWidth: "92vw",
    textAlign: "center",
    boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

function countFilledScores(scoresObj) {
  if (!scoresObj) return 0;
  let n = 0;
  for (const k of Object.keys(scoresObj)) {
    const arr = Array.isArray(scoresObj[k]) ? scoresObj[k] : [];
    for (const v of arr) if (String(v ?? "").trim() !== "") n++;
  }
  return n;
}

function parse18Numbers(raw) {
  const nums = String(raw ?? "")
    .replace(/\n/g, " ")
    .replace(/;/g, ",")
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => Number(x));

  if (nums.length !== 18) return null;
  if (!nums.every(Number.isFinite)) return null;
  return nums;
}

function validateCoursePayload({ name, parValues, strokeIndexes }) {
  const nm = String(name || "").trim();
  if (nm.length < 3) return "Nombre inválido (mínimo 3 letras)";

  if (!Array.isArray(parValues) || parValues.length !== 18) return "Par debe tener 18 números";
  if (!parValues.every((p) => Number.isFinite(p) && p >= 3 && p <= 6)) return "Par inválido (debe ser 3..6)";

  if (!Array.isArray(strokeIndexes) || strokeIndexes.length !== 18) return "SI debe tener 18 números";
  const siOk = strokeIndexes.every((s) => Number.isFinite(s) && s >= 1 && s <= 18);
  if (!siOk) return "SI inválido (debe ser 1..18)";
  const set = new Set(strokeIndexes);
  if (set.size !== 18) return "SI inválido: no puede repetir números (1..18 una sola vez)";

  return null;
}

/* ---------------- main ---------------- */

export default function Session() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState(null);
  const [settings, setSettings] = useState(null);
  const [groups, setGroups] = useState([]);
  const [groupsStateMap, setGroupsStateMap] = useState({});

  const [creatingGroup, setCreatingGroup] = useState(false);
  const [savingCourse, setSavingCourse] = useState(false);
  const [savingHistory, setSavingHistory] = useState(false);
  const [savingEntry, setSavingEntry] = useState(false);
  const [savingBolaRosa, setSavingBolaRosa] = useState(false);
  const [savingManualDiffs, setSavingManualDiffs] = useState(false);

  const [sessionError, setSessionError] = useState("");

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const [remoteCourses, setRemoteCourses] = useState({});
  const [coursesLoading, setCoursesLoading] = useState(true);

  const [openAddCourse, setOpenAddCourse] = useState(false);
  const [addingCourse, setAddingCourse] = useState(false);
  const [newCourseName, setNewCourseName] = useState("");
  const [newCourseRegion, setNewCourseRegion] = useState("");
  const [newCourseParText, setNewCourseParText] = useState("");
  const [newCourseSiText, setNewCourseSiText] = useState("");

  const [openSession, setOpenSession] = useState(true);
  const [openH2H, setOpenH2H] = useState(false);
  const [openLeaderboards, setOpenLeaderboards] = useState(true);
  const [openGroups, setOpenGroups] = useState(true);

  const [h2hA, setH2hA] = useState("");
  const [h2hB, setH2hB] = useState("");

  const [lbTab, setLbTab] = useState("stb");
  const [lbShowAll, setLbShowAll] = useState(false);

  const sessionRef = useMemo(() => {
    if (!sessionId) return null;
    return doc(db, "sessions", sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionRef) return;

    setSessionError("");

    return onSnapshot(
      sessionRef,
      (snap) => {
        setSession(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      },
      (err) => {
        console.error("session onSnapshot error:", err);
        const code = String(err?.code || "");
        if (code.includes("permission-denied")) {
          setSessionError("No tienes acceso a esta sesión. Ve a Home y únete con el Session ID.");
        } else {
          setSessionError(err?.message || "Error cargando sesión.");
        }
        setSession(null);
      }
    );
  }, [sessionRef]);

  useEffect(() => {
    setNameDraft(String(session?.name || ""));
  }, [session?.name]);

  useEffect(() => {
    if (!sessionId) return;
    const settingsRef = doc(db, "sessions", sessionId, "settings", "main");
    return onSnapshot(
      settingsRef,
      (snap) => setSettings(snap.exists() ? snap.data() : null),
      (err) => console.error("settings onSnapshot error:", err)
    );
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const groupsRef = collection(db, "sessions", sessionId, "groups");
    const q = query(groupsRef, orderBy("order", "asc"));
    return onSnapshot(
      q,
      (snap) => {
        setGroups(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => console.error("groups onSnapshot error:", err)
    );
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    const unsubs = [];
    groups.forEach((g) => {
      const ref = doc(db, "sessions", sessionId, "groups", g.id, "state", "main");
      const unsub = onSnapshot(
        ref,
        (snap) => {
          const data = snap.exists() ? snap.data() : null;
          setGroupsStateMap((prev) => ({ ...prev, [g.id]: data }));
        },
        (err) => console.error("group state onSnapshot error:", err)
      );
      unsubs.push(unsub);
    });

    return () => unsubs.forEach((u) => u && u());
  }, [sessionId, groups]);

  useEffect(() => {
    setCoursesLoading(true);
    const qy = query(collection(db, "courses"), where("approved", "==", true));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const out = {};
        snap.docs.forEach((d) => {
          const data = d.data() || {};
          out[d.id] = {
            name: data.name || d.id,
            region: data.region || "",
            parValues: Array.isArray(data.parValues) ? data.parValues : Array(18).fill(4),
            strokeIndexes: Array.isArray(data.strokeIndexes)
              ? data.strokeIndexes
              : Array.from({ length: 18 }, (_, i) => i + 1),
            source: data.source || "user",
          };
        });
        setRemoteCourses(out);
        setCoursesLoading(false);
      },
      (err) => {
        console.error("courses onSnapshot error:", err);
        setRemoteCourses({});
        setCoursesLoading(false);
      }
    );
    return () => unsub && unsub();
  }, []);

  const courseId = session?.courseId || "campestre-slp";
  const hcpPercent = session?.hcpPercent ?? 100;
  const entryFee = settings?.entryFee ?? 0;
  const bolaRosaEnabled = !!settings?.bolaRosaEnabled;
  const manualMatchDiffsEnabled =
    !!session?.manualMatchDiffsEnabled ||
    !!session?.allowManualMatchDiffs ||
    !!session?.allowManualAdvantages ||
    !!session?.historyHcpEnabled ||
    !!session?.useHistoricalHcp ||
    !!session?.editableVentajas;

  const uid = auth.currentUser?.uid || null;
  const isOwner = !!uid && session?.createdBy === uid;

  const ALL_COURSES = useMemo(() => {
    return { ...COURSE_DATA, ...remoteCourses };
  }, [remoteCourses]);

  const COURSES = useMemo(() => {
    return Object.entries(ALL_COURSES)
      .map(([id, c]) => ({
        id,
        label: `${c.name || id}${c.region ? ` (${c.region})` : ""}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [ALL_COURSES]);

  const courseLabel = COURSES.find((c) => c.id === courseId)?.label || courseId;

  const [hcpDraft, setHcpDraft] = useState(String(hcpPercent));
  const [entryDraft, setEntryDraft] = useState(String(entryFee));

  useEffect(() => setHcpDraft(String(hcpPercent)), [hcpPercent]);
  useEffect(() => setEntryDraft(String(entryFee)), [entryFee]);

  const copySessionId = async () => {
    try {
      await navigator.clipboard.writeText(sessionId);
      toast("Session ID copiado ✅");
    } catch {
      alert("No pude copiar. Cópialo manual: " + sessionId);
    }
  };

  const ensureSettingsDoc = async () => {
    if (!sessionId) return;
    const ref = doc(db, "sessions", sessionId, "settings", "main");
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(
        ref,
        {
          entryFee: 0,
          bolaRosaEnabled: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
  };

  const changeCourse = async (newCourseId) => {
    if (!sessionRef) return;
    setSavingCourse(true);
    try {
      await updateDoc(sessionRef, { courseId: newCourseId, updatedAt: serverTimestamp() });
      toast("Campo actualizado ✅");
    } catch (e) {
      console.error(e);
      alert(e?.message || "No se pudo actualizar el campo");
    } finally {
      setSavingCourse(false);
    }
  };

  const commitHcpPercent = async (raw) => {
    if (!sessionRef) return;
    const cleaned = sanitizeIntInput(raw, { allowNegative: false });
    if (cleaned === "") {
      setHcpDraft(String(hcpPercent));
      return;
    }
    const v = clampInt(parseInt(cleaned, 10), 0, 100);
    setHcpDraft(String(v));
    try {
      await updateDoc(sessionRef, { hcpPercent: v, updatedAt: serverTimestamp() });
      toast("%Hcp actualizado ✅");
    } catch (e) {
      console.error(e);
      alert(e?.message || "No se pudo actualizar handicap %");
      setHcpDraft(String(hcpPercent));
    }
  };

  const commitEntryFee = async (raw) => {
    if (!sessionId) return;
    setSavingEntry(true);
    try {
      const cleaned = sanitizeIntInput(raw, { allowNegative: false });
      const v = cleaned === "" ? 0 : Math.max(0, parseInt(cleaned, 10));
      setEntryDraft(String(v));
      await ensureSettingsDoc();
      const ref = doc(db, "sessions", sessionId, "settings", "main");
      await updateDoc(ref, { entryFee: v, updatedAt: serverTimestamp() });
      toast("Entry actualizado ✅");
    } catch (e) {
      console.error(e);
      alert(e?.message || "No se pudo actualizar entry fee");
      setEntryDraft(String(entryFee));
    } finally {
      setSavingEntry(false);
    }
  };

  const toggleBolaRosa = async (checked) => {
    if (!sessionId) return;
    setSavingBolaRosa(true);
    try {
      await ensureSettingsDoc();
      const ref = doc(db, "sessions", sessionId, "settings", "main");
      await updateDoc(ref, { bolaRosaEnabled: !!checked, updatedAt: serverTimestamp() });
      toast(`Bola Rosa ${checked ? "ON ✅" : "OFF ✅"}`);
    } catch (e) {
      console.error(e);
      alert(e?.message || "No se pudo actualizar Bola Rosa");
    } finally {
      setSavingBolaRosa(false);
    }
  };

  const toggleManualMatchDiffs = async (checked) => {
    if (!sessionRef) return;
    setSavingManualDiffs(true);
    try {
      await updateDoc(sessionRef, {
        manualMatchDiffsEnabled: !!checked,
        updatedAt: serverTimestamp(),
      });
      toast(`Ventajas manuales ${checked ? "ON ✅" : "OFF ✅"}`);
    } catch (e) {
      console.error(e);
      alert(e?.message || "No se pudo actualizar la opción de ventajas manuales");
    } finally {
      setSavingManualDiffs(false);
    }
  };

  const commitSessionName = async () => {
    if (!sessionRef || !isOwner) return;

    const cleaned = String(nameDraft || "")
      .trim()
      .slice(0, 50);

    if (!cleaned) {
      alert("Pon un nombre.");
      return;
    }

    setRenaming(true);
    try {
      await updateDoc(sessionRef, { name: cleaned, updatedAt: serverTimestamp() });
      toast("Nombre actualizado ✅");
    } catch (e) {
      console.error(e);
      alert(e?.message || "No se pudo renombrar la sesión");
      setNameDraft(String(session?.name || ""));
    } finally {
      setRenaming(false);
    }
  };

  const addGroup = async () => {
    if (!sessionId) return;
    setCreatingGroup(true);
    try {
      const nextOrder = (groups?.length ? Math.max(...groups.map((g) => g.order || 0)) : 0) + 1;
      const groupDocId = `group-${nextOrder}`;

      await setDoc(doc(db, "sessions", sessionId, "groups", groupDocId), {
        order: nextOrder,
        name: `Grupo ${nextOrder}`,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await updateDoc(doc(db, "sessions", sessionId), { updatedAt: serverTimestamp() });
      toast("Grupo creado ✅");
      navigate(`/session/${sessionId}/group/${groupDocId}`);
    } catch (e) {
      console.error(e);
      alert(e?.message || "Error creando grupo");
    } finally {
      setCreatingGroup(false);
    }
  };

  const createCourse = async () => {
    if (addingCourse) return;

    const currentUid = auth.currentUser?.uid || null;
    if (!currentUid) {
      alert("Necesitas iniciar sesión para agregar campos.");
      return;
    }

    const parValues = parse18Numbers(newCourseParText);
    const strokeIndexes = parse18Numbers(newCourseSiText);

    if (!parValues) {
      alert("Par inválido: pega 18 números.");
      return;
    }
    if (!strokeIndexes) {
      alert("SI inválido: pega 18 números.");
      return;
    }

    const err = validateCoursePayload({ name: newCourseName, parValues, strokeIndexes });
    if (err) {
      alert(err);
      return;
    }

    setAddingCourse(true);
    try {
      await addDoc(collection(db, "courses"), {
        name: String(newCourseName || "").trim(),
        region: String(newCourseRegion || "").trim(),
        parValues,
        strokeIndexes,
        approved: true,
        source: "user",
        createdBy: currentUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      toast("Campo creado ✅");
      setOpenAddCourse(false);
      setNewCourseName("");
      setNewCourseRegion("");
      setNewCourseParText("");
      setNewCourseSiText("");
    } catch (e) {
      console.error(e);
      alert(e?.message || "No se pudo crear el campo");
    } finally {
      setAddingCourse(false);
    }
  };

  const buildSnapshot = async () => {
    const sessionSnap = await getDoc(doc(db, "sessions", sessionId));
    const sessionData = sessionSnap.exists() ? sessionSnap.data() : {};

    const settingsSnap = await getDoc(doc(db, "sessions", sessionId, "settings", "main"));
    const settingsData = settingsSnap.exists() ? settingsSnap.data() : {};

    const groupsSnap = await getDocs(
      query(collection(db, "sessions", sessionId, "groups"), orderBy("order", "asc"))
    );
    const groupsMeta = groupsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const groupsFull = [];
    for (const g of groupsMeta) {
      const st = await getDoc(doc(db, "sessions", sessionId, "groups", g.id, "state", "main"));
      groupsFull.push({
        id: g.id,
        name: g.name || g.id,
        order: g.order || 0,
        ...(st.exists() ? st.data() : {}),
      });
    }

    const snapshotCourseId = sessionData?.courseId || "campestre-slp";
    const snapshotHcpPercent = sessionData?.hcpPercent ?? 100;

    const { stablefordRows, netRows } = computeLeaderboards({
      groupsFull,
      courseId: snapshotCourseId,
      hcpPercent: snapshotHcpPercent,
    });

    const matchesByGroup = {};
    for (const g of groupsFull) {
      const ps = g.players || [];
      const sc = g.scores || {};
      const manualDiffs = g.manualMatchDiffs || {};

      const res = [];
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i];
          const b = ps[j];
          const key = [a.id, b.id].sort().join("|");

          const r = computeMatchResultForPair({
            a,
            b,
            scores: sc,
            courseId: snapshotCourseId,
            manualDiff: manualDiffs[key],
          });

          res.push(r);
        }
      }
      matchesByGroup[g.id] = res;
    }

    const prizes = computeEntryPrizes({
      groupsFull,
      courseId: snapshotCourseId,
      hcpPercent: snapshotHcpPercent,
      entryFee: settingsData?.entryFee ?? 0,
    });

    return {
      session: {
        name: sessionData?.name || "",
        status: sessionData?.status || "",
        courseId: snapshotCourseId,
        hcpPercent: snapshotHcpPercent,
        manualMatchDiffsEnabled: !!sessionData?.manualMatchDiffsEnabled,
      },
      settings: settingsData,
      groups: groupsFull,
      computed: {
        leaderboardStableford: stablefordRows,
        leaderboardNet: netRows,
        matchesByGroup,
        entryPrizes: prizes,
      },
    };
  };

  const saveHistory = async () => {
    if (!sessionId) return;
    setSavingHistory(true);
    try {
      const snapshot = await buildSnapshot();
      await addDoc(collection(db, "sessions", sessionId, "history"), {
        ...snapshot,
        createdAt: serverTimestamp(),
        createdByUid: auth.currentUser?.uid || null,
      });
      toast("Historial guardado ✅");
    } catch (e) {
      console.error(e);
      alert(e?.message || "No pude guardar historial");
    } finally {
      setSavingHistory(false);
    }
  };

  if (!sessionId) {
    return (
      <div style={page}>
        <div style={fallbackCard}>
          <div style={{ fontWeight: 1000, fontSize: 18 }}>Falta Session ID</div>
          <button style={btn} onClick={() => navigate("/")}>
            Volver
          </button>
        </div>
      </div>
    );
  }

  if (sessionError) {
    return (
      <div style={page}>
        <div style={fallbackCard}>
          <div style={{ fontWeight: 1000, fontSize: 18, color: "white" }}>Sin acceso</div>
          <div style={{ marginTop: 8, opacity: 0.8 }}>{sessionError}</div>
          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button style={btn} onClick={() => navigate("/")}>
              Volver a Home
            </button>
            <button
              style={btn}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(sessionId);
                  toast("Session ID copiado ✅");
                } catch {
                  alert("Copia manual: " + sessionId);
                }
              }}
            >
              Copiar ID
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!session) return <div style={page}>Cargando sesión...</div>;

  const groupsFull = groups.map((g) => ({
    id: g.id,
    name: g.name || g.id,
    order: g.order || 0,
    ...(groupsStateMap[g.id] || {}),
  }));

  const { stablefordRows, netRows } = computeLeaderboards({ groupsFull, courseId, hcpPercent });
  const prizes = computeEntryPrizes({ groupsFull, courseId, hcpPercent, entryFee });

  const allPlayers = [];
  for (const g of groupsFull) {
    const ps = g.players || [];
    for (const p of ps) {
      allPlayers.push({
        key: `${g.id}::${p.id}`,
        groupId: g.id,
        playerId: p.id,
        name: p.name || p.id,
        hcp: p.hcp || 0,
      });
    }
  }

  const pickA = allPlayers.find((x) => x.key === h2hA) || null;
  const pickB = allPlayers.find((x) => x.key === h2hB) || null;

  let h2hRes = null;
  if (pickA && pickB && pickA.key !== pickB.key) {
    const gA = groupsFull.find((g) => g.id === pickA.groupId);
    const gB = groupsFull.find((g) => g.id === pickB.groupId);
    const scoresA = gA?.scores?.[pickA.playerId] || Array(18).fill("");
    const scoresB = gB?.scores?.[pickB.playerId] || Array(18).fill("");

    const a = { id: `A__${pickA.groupId}__${pickA.playerId}`, name: pickA.name, hcp: pickA.hcp };
    const b = { id: `B__${pickB.groupId}__${pickB.playerId}`, name: pickB.name, hcp: pickB.hcp };

    const scores = { [a.id]: scoresA, [b.id]: scoresB };
    h2hRes = computeMatchResultForPair({ a, b, scores, courseId });
  }

  const stbToShow = lbShowAll ? stablefordRows : stablefordRows.slice(0, 12);
  const netToShow = lbShowAll ? netRows : netRows.slice(0, 12);

  return (
    <div style={page}>
      <style>{baseCss}</style>

      {openAddCourse ? (
        <Modal
          title="Agregar campo"
          subtitle="Pega Par y SI (18 valores) · se guarda para todos"
          onClose={() => setOpenAddCourse(false)}
        >
          <div style={grid2}>
            <div style={field}>
              <div style={label}>Nombre</div>
              <input
                style={{ ...inputDark, width: "100%" }}
                value={newCourseName}
                onChange={(e) => setNewCourseName(e.target.value)}
                placeholder="Ej. La Loma Club de Golf"
              />
            </div>

            <div style={field}>
              <div style={label}>Región</div>
              <input
                style={{ ...inputDark, width: "100%" }}
                value={newCourseRegion}
                onChange={(e) => setNewCourseRegion(e.target.value)}
                placeholder="Ej. San Luis Potosí"
              />
            </div>

            <div style={field}>
              <div style={label}>Par (18 números)</div>
              <textarea
                style={textareaDark}
                value={newCourseParText}
                onChange={(e) => setNewCourseParText(e.target.value)}
                placeholder="Ej: 4,4,4,3,5,5,4,3,4,4,3,4,4,4,5,4,3,5"
                rows={4}
              />
              <div style={hint}>Puedes separar por coma, espacio o salto de línea.</div>
            </div>

            <div style={field}>
              <div style={label}>Stroke Index / Handicap (18 números 1..18)</div>
              <textarea
                style={textareaDark}
                value={newCourseSiText}
                onChange={(e) => setNewCourseSiText(e.target.value)}
                placeholder="Ej: 11,3,13,17,7,5,1,15,9,2,18,10,16,4,8,14,12,6"
                rows={4}
              />
              <div style={hint}>No se puede repetir ningún número.</div>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={smallBtn} onClick={() => setOpenAddCourse(false)} type="button">
                Cancelar
              </button>
              <button style={smallPrimaryBtn} onClick={createCourse} disabled={addingCourse} type="button">
                {addingCourse ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      <div style={appBar}>
        <button onClick={() => navigate("/")} style={iconBtn} aria-label="Home">
          ←
        </button>

        <div style={{ minWidth: 0 }}>
          <div style={barTitle}>{session.name || "Sesión"}</div>
          <div style={barSub}>
            {courseLabel} · %Hcp {hcpPercent} · {groups.length} grupos
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={copySessionId} style={chipBtn}>
            Copiar ID
          </button>
          <button onClick={saveHistory} disabled={savingHistory} style={chipBtnPrimary}>
            {savingHistory ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>

      <div style={content}>
        <Collapsible
          title="Configuración"
          subtitle={`Status ${session.status || "live"} · Entry ${fmtMoney(entryFee)} · Bola Rosa ${bolaRosaEnabled ? "On" : "Off"}`}
          open={openSession}
          setOpen={setOpenSession}
        >
          <div style={grid2}>
            <div style={field}>
              <div style={label}>Nombre de sesión</div>
              <input
                style={{ ...inputDark, width: "100%" }}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Ej: Animalario Domingo"
                disabled={!isOwner}
                onBlur={() => {
                  if (isOwner) commitSessionName();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                maxLength={50}
              />
              <div style={hint}>
                {isOwner ? (renaming ? "Guardando…" : "Solo tú puedes cambiarlo.") : "Solo el owner puede cambiarlo."}
              </div>
            </div>

            <div style={field}>
              <div style={label}>Session ID</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <code style={codePill}>{sessionId}</code>
                <button onClick={copySessionId} style={smallBtn} type="button">
                  Copiar
                </button>
              </div>
            </div>

            <div style={field}>
              <div style={label}>Campo</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select
                  value={courseId}
                  onChange={(e) => changeCourse(e.target.value)}
                  style={selectDark}
                  disabled={savingCourse || coursesLoading}
                >
                  {coursesLoading ? (
                    <option value={courseId}>Cargando campos…</option>
                  ) : (
                    COURSES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))
                  )}
                </select>

                <button type="button" onClick={() => setOpenAddCourse(true)} style={smallPrimaryBtn} title="Agregar campo">
                  + Campo
                </button>
              </div>

              {savingCourse ? <div style={hint}>Guardando…</div> : null}
            </div>

            <div style={field}>
              <div style={label}>% Handicap (Net/STB)</div>
              <input
                type="text"
                value={hcpDraft}
                onChange={(e) => setHcpDraft(sanitizeIntInput(e.target.value, { allowNegative: false }))}
                onBlur={() => commitHcpPercent(hcpDraft)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                style={inputDark}
                inputMode="numeric"
                placeholder="0–100"
              />
              <div style={hint}>Matches siempre 100%.</div>
            </div>

            <div style={field}>
              <div style={label}>Entry fee (por jugador)</div>
              <input
                type="text"
                value={entryDraft}
                onChange={(e) => setEntryDraft(sanitizeIntInput(e.target.value, { allowNegative: false }))}
                onBlur={() => commitEntryFee(entryDraft)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                style={inputDark}
                inputMode="numeric"
                placeholder="0"
              />
              {savingEntry ? <div style={hint}>Guardando…</div> : null}
            </div>

            <div style={{ ...field, gridColumn: "1 / -1" }}>
              <label style={togglePill}>
                <input
                  type="checkbox"
                  checked={manualMatchDiffsEnabled}
                  onChange={(e) => toggleManualMatchDiffs(e.target.checked)}
                />
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontWeight: 950, color: "white" }}>Permitir ventajas manuales por grupo</span>
                  <span style={{ fontSize: 12, opacity: 0.75 }}>
                    Si está activo, en cada grupo podrás editar la ventaja de cada match.
                  </span>
                </div>
              </label>
              {savingManualDiffs ? <div style={hint}>Guardando…</div> : null}
            </div>

            <div style={{ ...field, gridColumn: "1 / -1" }}>
              <div style={label}>Pool & Premios</div>

              <div style={prizesGrid}>
                <div style={poolCard}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontWeight: 950, opacity: 0.85 }}>Pool</div>
                    <div style={chipTiny}>{prizes.totalPlayers} jugadores</div>
                  </div>

                  <div style={poolBig}>${Math.round(prizes.pool)}</div>

                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <div style={miniPill}>
                      <div style={miniPillTop}>STB 1º</div>
                      <div style={miniPillVal}>
                        {fmtMoney(prizes.payoutsByPlayerKey[prizes.winners.stableford1?.playerKey] || 0)}
                      </div>
                    </div>
                    <div style={miniPill}>
                      <div style={miniPillTop}>STB 2º</div>
                      <div style={miniPillVal}>
                        {fmtMoney(prizes.payoutsByPlayerKey[prizes.winners.stableford2?.playerKey] || 0)}
                      </div>
                    </div>
                    <div style={miniPill}>
                      <div style={miniPillTop}>Net 1º</div>
                      <div style={miniPillVal}>
                        {fmtMoney(prizes.payoutsByPlayerKey[prizes.winners.net1?.playerKey] || 0)}
                      </div>
                    </div>
                  </div>
                </div>

                <div style={winnersCard}>
                  <WinnerRow
                    badge="🥇"
                    title="Stableford 1º"
                    name={prizes.winners.stableford1?.name}
                    sub={prizes.winners.stableford1?.groupId ? `Grupo ${prizes.winners.stableford1.groupId}` : ""}
                    money={prizes.payoutsByPlayerKey[prizes.winners.stableford1?.playerKey] || 0}
                  />
                  <div style={sep} />
                  <WinnerRow
                    badge="🥈"
                    title="Stableford 2º"
                    name={prizes.winners.stableford2?.name}
                    sub={prizes.winners.stableford2?.groupId ? `Grupo ${prizes.winners.stableford2.groupId}` : ""}
                    money={prizes.payoutsByPlayerKey[prizes.winners.stableford2?.playerKey] || 0}
                  />
                  <div style={sep} />
                  <WinnerRow
                    badge="🏆"
                    title="Net 1º"
                    name={prizes.winners.net1?.name}
                    sub="Excluye ganadores STB"
                    money={prizes.payoutsByPlayerKey[prizes.winners.net1?.playerKey] || 0}
                  />
                </div>
              </div>
            </div>

            <div style={{ ...field, gridColumn: "1 / -1" }}>
              <label style={togglePill}>
                <input type="checkbox" checked={bolaRosaEnabled} onChange={(e) => toggleBolaRosa(e.target.checked)} />
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontWeight: 950, color: "white" }}>Habilitar Bola Rosa</span>
                  <span style={{ fontSize: 12, opacity: 0.75 }}>Activa selección de ganador en cada grupo.</span>
                </div>
              </label>
              {savingBolaRosa ? <div style={hint}>Guardando…</div> : null}
            </div>
          </div>
        </Collapsible>

        <Collapsible
          title="Head-to-Head (cross-group)"
          subtitle="Cualquier jugador vs cualquier jugador · F9/B9/Total"
          open={openH2H}
          setOpen={setOpenH2H}
        >
          <div style={cardDark}>
            <div style={h2hPickGrid}>
              <div>
                <div style={label}>Player A</div>
                <select value={h2hA} onChange={(e) => setH2hA(e.target.value)} style={selectDark}>
                  <option value="">— Selecciona —</option>
                  {allPlayers.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name} · {p.groupId} · hcp {p.hcp}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div style={label}>Player B</div>
                <select value={h2hB} onChange={(e) => setH2hB(e.target.value)} style={selectDark}>
                  <option value="">— Selecciona —</option>
                  {allPlayers.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name} · {p.groupId} · hcp {p.hcp}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              {!h2hRes ? (
                <div style={{ opacity: 0.75 }}>Elige dos jugadores y te calculo F9/B9/Total.</div>
              ) : (
                <div style={h2hStrip}>
                  <div style={{ fontWeight: 950, marginBottom: 8 }}>
                    {h2hRes.label} <span style={{ opacity: 0.7, fontWeight: 800 }}>· diff {h2hRes.diff}</span>
                  </div>
                  <div style={h2hGrid}>
                    <div style={h2hCell}>
                      <div style={h2hHead}>F9</div>
                      <div style={h2hVal(h2hRes.front)}>{fmtMatch(h2hRes.front)}</div>
                    </div>
                    <div style={h2hCell}>
                      <div style={h2hHead}>B9</div>
                      <div style={h2hVal(h2hRes.back)}>{fmtMatch(h2hRes.back)}</div>
                    </div>
                    <div style={h2hCell}>
                      <div style={h2hHead}>Total</div>
                      <div style={h2hVal(h2hRes.total)}>{fmtMatch(h2hRes.total)}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Collapsible>

        <Collapsible title="Leaderboards" subtitle="General (Stableford / Net)" open={openLeaderboards} setOpen={setOpenLeaderboards}>
          <div style={cardDark}>
            <div style={lbTopRow}>
              <div style={{ minWidth: 0 }}>
                <div style={lbTitle}>Ranking</div>
                <div style={lbSub}>Empates: gana el HCP menor.</div>
              </div>

              <div style={segmented}>
                <button
                  style={{ ...segBtn, ...(lbTab === "stb" ? segBtnActive : null) }}
                  onClick={() => setLbTab("stb")}
                  type="button"
                >
                  STB
                </button>
                <button
                  style={{ ...segBtn, ...(lbTab === "net" ? segBtnActive : null) }}
                  onClick={() => setLbTab("net")}
                  type="button"
                >
                  Net
                </button>
              </div>
            </div>

            <div style={tableWrap}>
              <table style={lbTable}>
                <thead>
                  <tr>
                    <th style={lbThRank}>#</th>
                    <th style={lbThLeft}>Jugador</th>
                    <th style={lbTh}>HCP</th>
                    <th style={lbTh}>{lbTab === "stb" ? "STB" : "Net"}</th>
                    <th style={lbThRight}>Grupo</th>
                  </tr>
                </thead>
                <tbody>
                  {(lbTab === "stb" ? stbToShow : netToShow).map((r, i) => (
                    <tr key={`${r.playerKey}-${i}`} style={lbTr}>
                      <td style={lbTdRank}>
                        <span style={rankPill(i)}>{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</span>
                      </td>
                      <td style={lbTdLeft}>
                        <div style={nameCell}>
                          <span style={nameMain}>{r.name}</span>
                        </div>
                      </td>
                      <td style={lbTd}>{r.hcp}</td>
                      <td style={lbTdVal}>
                        {lbTab === "stb" ? <b style={{ color: "white" }}>{r.stableford}</b> : <b style={{ color: "white" }}>{r.net}</b>}
                      </td>
                      <td style={lbTdRight}>
                        <span style={groupPill}>G{String(r.groupId || "").replace("group-", "") || "-"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={lbBottomRow}>
              <button style={linkBtn} onClick={() => setLbShowAll((s) => !s)} type="button">
                {lbShowAll ? "Ver menos" : "Ver todos"}
              </button>
              <div style={{ opacity: 0.7, fontSize: 12 }}>
                Mostrando {lbTab === "stb" ? stbToShow.length : netToShow.length} de {lbTab === "stb" ? stablefordRows.length : netRows.length}
              </div>
            </div>
          </div>
        </Collapsible>

        <Collapsible
          title="Groups"
          subtitle={`${groups.length} grupos · tap para abrir scorecard`}
          open={openGroups}
          setOpen={setOpenGroups}
          right={
            <button onClick={addGroup} disabled={creatingGroup} style={smallPrimaryBtn} type="button">
              {creatingGroup ? "Creando…" : "+ Grupo"}
            </button>
          }
        >
          <div style={{ display: "grid", gap: 12 }}>
            {groups.length === 0 ? (
              <div style={{ opacity: 0.78 }}>No hay grupos todavía.</div>
            ) : (
              groups.map((g) => (
                <GroupCard
                  key={g.id}
                  group={g}
                  state={groupsStateMap[g.id]}
                  onOpen={() => navigate(`/session/${sessionId}/group/${g.id}`)}
                />
              ))
            )}
          </div>
        </Collapsible>

        <div style={{ height: 16 }} />
      </div>
    </div>
  );
}

/* ---------------- UI helpers ---------------- */

function Collapsible({ title, subtitle, open, setOpen, right, children }) {
  return (
    <section style={section}>
      <button onClick={() => setOpen(!open)} style={collapsibleHead} type="button">
        <div style={{ minWidth: 0 }}>
          <div style={sectionTitle}>{title}</div>
          {subtitle ? <div style={subText2}>{subtitle}</div> : null}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {right ? <div onClick={(e) => e.stopPropagation()}>{right}</div> : null}
          <div style={chev}>{open ? "▾" : "▸"}</div>
        </div>
      </button>
      {open ? <div style={collapsibleBody}>{children}</div> : null}
    </section>
  );
}

function GroupCard({ group, state, onOpen }) {
  const players = state?.players || [];
  const filled = countFilledScores(state?.scores);
  return (
    <button style={groupCardBtn} onClick={onOpen} type="button">
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 1000,
              fontSize: 16,
              color: "white",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {group.name || group.id}
          </div>
          <div style={{ marginTop: 6, opacity: 0.78, fontSize: 12 }}>
            {players.length}/6 jugadores · {filled} scores capturados
          </div>
        </div>
        <div style={openPill}>Abrir</div>
      </div>
    </button>
  );
}

function WinnerRow({ badge, title, name, sub, money }) {
  return (
    <div style={winnerRow}>
      <div style={winnerBadge}>{badge}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={winnerTitle}>{title}</div>
        <div style={winnerName} title={name || "-"}>
          {name || "-"}
        </div>
        {sub ? <div style={winnerSub}>{sub}</div> : null}
      </div>
      <div style={winnerMoney}>{fmtMoney(money)}</div>
    </div>
  );
}

function rankPill(i) {
  const isTop = i <= 2;
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    height: 26,
    minWidth: 34,
    padding: "0 8px",
    borderRadius: 999,
    border: isTop ? "1px solid rgba(59,130,246,0.35)" : "1px solid rgba(148,163,184,0.14)",
    background: isTop ? "rgba(59,130,246,0.14)" : "rgba(2,6,23,0.30)",
    color: "white",
    fontWeight: 950,
    fontSize: 12,
  };
}

function Modal({ title, subtitle, onClose, children }) {
  return (
    <div style={modalOverlay} onMouseDown={onClose} role="dialog" aria-modal="true">
      <div style={modalCard} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 1000, color: "white", fontSize: 16, letterSpacing: -0.3 }}>{title}</div>
            {subtitle ? <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>{subtitle}</div> : null}
          </div>
          <button style={iconBtn} onClick={onClose} type="button" aria-label="Cerrar">
            ✕
          </button>
        </div>
        <div style={{ marginTop: 12 }}>{children}</div>
      </div>
    </div>
  );
}

/* ---------------- Styles ---------------- */

const baseCss = `
  * { box-sizing: border-box; }
  input, button, select, textarea { font: inherit; }
  button { -webkit-tap-highlight-color: transparent; cursor: pointer; }
  input:focus, select:focus, textarea:focus { outline: none; }
  table { border-spacing: 0; }
`;

const page = {
  minHeight: "100%",
  background: "radial-gradient(1200px 700px at 10% 0%, rgba(59,130,246,0.10) 0%, rgba(0,0,0,0) 45%), #05070b",
  color: "#e5e7eb",
  paddingTop: "env(safe-area-inset-top)",
  paddingBottom: "env(safe-area-inset-bottom)",
  paddingLeft: "env(safe-area-inset-left)",
  paddingRight: "env(safe-area-inset-right)",
};

const content = { padding: 12, maxWidth: 1100, margin: "0 auto" };

const appBar = {
  position: "sticky",
  top: 0,
  zIndex: 50,
  padding: "10px 12px",
  display: "flex",
  alignItems: "center",
  gap: 10,
  justifyContent: "space-between",
  backdropFilter: "blur(14px)",
  background: "rgba(5,7,11,0.70)",
  borderBottom: "1px solid rgba(148,163,184,0.14)",
};

const iconBtn = {
  width: 40,
  height: 40,
  borderRadius: 14,
  border: "1px solid rgba(148,163,184,0.18)",
  background: "rgba(15,23,42,0.55)",
  color: "white",
  fontWeight: 1000,
};

const barTitle = {
  fontSize: 16,
  fontWeight: 1000,
  letterSpacing: -0.4,
  color: "white",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: 220,
};

const barSub = {
  fontSize: 12,
  opacity: 0.75,
  marginTop: 2,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: 260,
};

const chipBtn = {
  height: 40,
  padding: "0 12px",
  borderRadius: 999,
  border: "1px solid rgba(148,163,184,0.18)",
  background: "rgba(15,23,42,0.55)",
  color: "white",
  fontWeight: 950,
};

const chipBtnPrimary = {
  ...chipBtn,
  border: "1px solid rgba(59,130,246,0.35)",
  background: "rgba(59,130,246,0.18)",
  color: "#dbeafe",
};

const section = {
  borderRadius: 18,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "linear-gradient(180deg, rgba(15,23,42,0.55) 0%, rgba(2,6,23,0.35) 100%)",
  boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
  overflow: "hidden",
  marginTop: 12,
};

const collapsibleHead = {
  width: "100%",
  padding: "12px 12px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  background: "transparent",
  color: "#e5e7eb",
  border: "none",
  textAlign: "left",
};

const collapsibleBody = { padding: 12, paddingTop: 0 };

const sectionTitle = { fontSize: 14, fontWeight: 1000, letterSpacing: -0.2, color: "white" };
const subText2 = { marginTop: 2, fontSize: 12, opacity: 0.72 };
const chev = { fontSize: 18, opacity: 0.8, fontWeight: 900 };

const grid2 = { display: "grid", gridTemplateColumns: "1fr", gap: 12 };
const field = { display: "flex", flexDirection: "column", gap: 8 };

const label = { fontWeight: 950, color: "white" };
const hint = { fontSize: 12, opacity: 0.75 };

const selectDark = {
  padding: "12px 12px",
  borderRadius: 14,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(15,23,42,0.55)",
  color: "white",
  fontWeight: 950,
  width: "100%",
};

const inputDark = {
  padding: "12px 12px",
  borderRadius: 14,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(15,23,42,0.55)",
  color: "white",
  fontWeight: 950,
  width: 140,
};

const textareaDark = {
  padding: "12px 12px",
  borderRadius: 14,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(15,23,42,0.55)",
  color: "white",
  fontWeight: 900,
  width: "100%",
  resize: "vertical",
  minHeight: 90,
};

const codePill = {
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(2,6,23,0.35)",
  color: "white",
  fontWeight: 900,
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const smallBtn = {
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(15,23,42,0.55)",
  color: "white",
  fontWeight: 950,
};

const smallPrimaryBtn = {
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid rgba(59,130,246,0.35)",
  background: "rgba(59,130,246,0.18)",
  color: "#dbeafe",
  fontWeight: 950,
  whiteSpace: "nowrap",
};

const cardDark = {
  borderRadius: 16,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(2,6,23,0.35)",
  padding: 12,
};

const togglePill = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  padding: "12px 12px",
  borderRadius: 16,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(15,23,42,0.45)",
  userSelect: "none",
};

const tableWrap = { overflowX: "auto", WebkitOverflowScrolling: "touch" };

const prizesGrid = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: 12,
};

const poolCard = {
  borderRadius: 18,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "linear-gradient(180deg, rgba(59,130,246,0.14) 0%, rgba(2,6,23,0.35) 55%)",
  padding: 14,
};

const winnersCard = {
  borderRadius: 18,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(2,6,23,0.35)",
  padding: 14,
};

const chipTiny = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(2,6,23,0.35)",
  fontWeight: 900,
  fontSize: 12,
  opacity: 0.9,
};

const poolBig = {
  marginTop: 10,
  fontSize: 36,
  fontWeight: 1000,
  letterSpacing: -1,
  color: "white",
  lineHeight: 1.05,
};

const miniPill = {
  flex: "1 1 110px",
  borderRadius: 16,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(15,23,42,0.45)",
  padding: 10,
  minWidth: 110,
};

const miniPillTop = { fontSize: 12, opacity: 0.75, fontWeight: 900 };
const miniPillVal = { marginTop: 4, fontWeight: 1000, color: "white" };

const winnerRow = { display: "flex", gap: 12, alignItems: "center" };
const winnerBadge = {
  width: 40,
  height: 40,
  borderRadius: 14,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(15,23,42,0.45)",
  display: "grid",
  placeItems: "center",
  fontSize: 18,
};

const winnerTitle = { fontWeight: 950, opacity: 0.9, fontSize: 12 };
const winnerName = {
  marginTop: 2,
  fontWeight: 1000,
  color: "white",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: "52vw",
};
const winnerSub = { marginTop: 3, fontSize: 12, opacity: 0.72 };
const winnerMoney = { fontWeight: 1000, color: "white", marginLeft: "auto", whiteSpace: "nowrap" };

const sep = {
  height: 1,
  background: "rgba(148,163,184,0.12)",
  margin: "12px 0",
};

const lbTopRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  flexWrap: "wrap",
};

const lbTitle = { fontWeight: 1000, color: "white", fontSize: 14 };
const lbSub = { marginTop: 3, fontSize: 12, opacity: 0.72 };

const segmented = {
  display: "flex",
  borderRadius: 999,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(2,6,23,0.25)",
  padding: 4,
  gap: 4,
};

const segBtn = {
  padding: "8px 12px",
  borderRadius: 999,
  border: "1px solid transparent",
  background: "transparent",
  color: "rgba(226,232,240,0.88)",
  fontWeight: 950,
};

const segBtnActive = {
  border: "1px solid rgba(59,130,246,0.35)",
  background: "rgba(59,130,246,0.18)",
  color: "white",
};

const lbTable = {
  width: "100%",
  borderCollapse: "separate",
  borderSpacing: 0,
  fontSize: 13,
  minWidth: 420,
};

const lbThBase = {
  padding: "10px 10px",
  borderBottom: "1px solid rgba(148,163,184,0.14)",
  opacity: 0.85,
  whiteSpace: "nowrap",
  fontWeight: 900,
  fontSize: 12,
  background: "rgba(15,23,42,0.35)",
  position: "sticky",
  top: 0,
  zIndex: 1,
};

const lbThRank = { ...lbThBase, textAlign: "center", width: 56 };
const lbThLeft = { ...lbThBase, textAlign: "left" };
const lbTh = { ...lbThBase, textAlign: "center", width: 70 };
const lbThRight = { ...lbThBase, textAlign: "right", width: 84 };

const lbTr = { background: "rgba(2,6,23,0.20)" };

const lbTdBase = {
  padding: "10px 10px",
  borderBottom: "1px solid rgba(148,163,184,0.08)",
  whiteSpace: "nowrap",
  verticalAlign: "middle",
};

const lbTdRank = { ...lbTdBase, textAlign: "center" };
const lbTdLeft = { ...lbTdBase, textAlign: "left", minWidth: 160 };
const lbTd = { ...lbTdBase, textAlign: "center", opacity: 0.95 };
const lbTdVal = { ...lbTdBase, textAlign: "center" };
const lbTdRight = { ...lbTdBase, textAlign: "right" };

const nameCell = { display: "flex", alignItems: "center", gap: 8, minWidth: 0 };
const nameMain = {
  fontWeight: 950,
  color: "white",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const groupPill = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  height: 26,
  padding: "0 10px",
  borderRadius: 999,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(2,6,23,0.30)",
  fontWeight: 900,
  fontSize: 12,
  color: "rgba(226,232,240,0.92)",
};

const lbBottomRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  marginTop: 10,
  flexWrap: "wrap",
};

const linkBtn = {
  border: "none",
  background: "transparent",
  color: "#dbeafe",
  fontWeight: 950,
  padding: 0,
  textDecoration: "underline",
  textUnderlineOffset: 3,
};

const h2hPickGrid = { display: "grid", gridTemplateColumns: "1fr", gap: 10 };
const h2hStrip = {
  padding: 12,
  borderRadius: 16,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(15,23,42,0.45)",
};

const h2hGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 10,
  marginTop: 8,
};

const h2hCell = {
  borderRadius: 14,
  border: "1px solid rgba(148,163,184,0.12)",
  background: "rgba(2,6,23,0.35)",
  padding: 10,
  textAlign: "center",
};

const h2hHead = { opacity: 0.7, fontWeight: 950, fontSize: 12 };
const h2hVal = (v) => ({
  marginTop: 6,
  fontWeight: 1000,
  fontSize: 22,
  letterSpacing: -0.4,
  color: v > 0 ? "#22c55e" : v < 0 ? "#ef4444" : "#e5e7eb",
});

const groupCardBtn = {
  width: "100%",
  borderRadius: 18,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(2,6,23,0.35)",
  padding: 12,
  textAlign: "left",
};

const openPill = {
  padding: "8px 10px",
  borderRadius: 999,
  border: "1px solid rgba(59,130,246,0.35)",
  background: "rgba(59,130,246,0.18)",
  color: "#dbeafe",
  fontWeight: 950,
};

const fallbackCard = {
  borderRadius: 18,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "rgba(2,6,23,0.35)",
  padding: 16,
};

const btn = {
  marginTop: 10,
  padding: "10px 14px",
  borderRadius: 14,
  border: "1px solid rgba(148,163,184,0.18)",
  background: "rgba(15,23,42,0.55)",
  color: "white",
  fontWeight: 900,
};

const modalOverlay = {
  position: "fixed",
  inset: 0,
  zIndex: 200,
  background: "rgba(0,0,0,0.55)",
  backdropFilter: "blur(10px)",
  display: "grid",
  placeItems: "center",
  padding: 14,
};

const modalCard = {
  width: "min(720px, 96vw)",
  borderRadius: 18,
  border: "1px solid rgba(148,163,184,0.14)",
  background: "linear-gradient(180deg, rgba(15,23,42,0.80) 0%, rgba(2,6,23,0.55) 100%)",
  boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
  padding: 12,
};

if (typeof window !== "undefined") {
  const mq = window.matchMedia?.("(min-width: 860px)");
  if (mq?.matches) {
    prizesGrid.gridTemplateColumns = "1.1fr 0.9fr";
    h2hPickGrid.gridTemplateColumns = "1fr 1fr";
  }
}
