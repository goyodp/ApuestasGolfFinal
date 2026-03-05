const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

exports.joinSession = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }

  const sessionId = String(request.data?.sessionId || "").trim();
  if (!sessionId || sessionId.length < 6 || sessionId.length > 60) {
    throw new HttpsError("invalid-argument", "Session ID inválido.");
  }

  const ref = admin.firestore().doc(`sessions/${sessionId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "La sesión no existe.");
  }

  // Updates atómicos y seguros
  const updates = {
    [`members.${uid}`]: true,
    memberUids: admin.firestore.FieldValue.arrayUnion(uid),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await ref.set(updates, { merge: true });

  return { ok: true, sessionId };
});
