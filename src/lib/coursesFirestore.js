// src/lib/coursesFirestore.js
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase/db";

export async function fetchApprovedCourses() {
  const col = collection(db, "courses");
  const qy = query(col, where("approved", "==", true));

  const snap = await getDocs(qy);

  const out = {};
  snap.forEach((doc) => {
    const d = doc.data();
    // Importante: tu compute.js espera parValues + strokeIndexes
    out[doc.id] = {
      name: d.name || doc.id,
      parValues: d.parValues || Array(18).fill(4),
      strokeIndexes: d.strokeIndexes || Array.from({ length: 18 }, (_, i) => i + 1),
      region: d.region || "",
      source: d.source || "user",
    };
  });

  return out;
}
