const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

function sanitizeSessionId(raw) {
  const s = String(raw || "").trim();
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const isAz = (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
    const is09 = ch >= "0" && ch <= "9";
    const ok = isAz || is09 || ch === "-" || ch === "_";
    if (ok) out += ch;
  }
  return out.slice(0, 60);
}

exports.joinSession = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }

  const sessionId = sanitizeSessionId(request.data?.sessionId);
  if (!sessionId || sessionId.length < 6 || sessionId.length > 60) {
    throw new HttpsError("invalid-argument", "Session ID inválido.");
  }

  const ref = admin.firestore().doc(`sessions/${sessionId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "La sesión no existe.");
  }

  const updates = {
    [`members.${uid}`]: true,
    memberUids: admin.firestore.FieldValue.arrayUnion(uid),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await ref.set(updates, { merge: true });

  return { ok: true, sessionId };
});
