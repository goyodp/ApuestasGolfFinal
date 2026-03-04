// src/hooks/useCourses.js
import { useEffect, useMemo, useState } from "react";
import { COURSE_DATA } from "../lib/compute";
import { fetchApprovedCourses } from "../lib/coursesFirestore";

export function useCourses() {
  const [remoteCourses, setRemoteCourses] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await fetchApprovedCourses();
        if (alive) setRemoteCourses(data);
      } catch (e) {
        console.error("Error fetching courses:", e);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Firestore gana si se llama igual
  const allCourses = useMemo(() => ({ ...COURSE_DATA, ...remoteCourses }), [remoteCourses]);

  return { allCourses, loading };
}
