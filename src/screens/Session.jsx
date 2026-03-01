import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/db";

export default function Session() {
  const { sessionId } = useParams();
  const [session, setSession] = useState(null);

  useEffect(() => {
    if (!sessionId) return;

    const unsub = onSnapshot(
      doc(db, "sessions", sessionId),
      (snapshot) => {
        if (snapshot.exists()) {
          setSession(snapshot.data());
        }
      }
    );

    return () => unsub();
  }, [sessionId]);

  if (!session) return <div style={{ padding: 20 }}>Cargando sesión...</div>;

  return (
    <div style={{ padding: 20 }}>
      <h2>{session.name}</h2>
      <p>Status: {session.status}</p>
      <p>Curso: {session.courseId}</p>
    </div>
  );
}
