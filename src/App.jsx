import { Routes, Route, Navigate } from "react-router-dom";
import Home from "./screens/Home";
import Session from "./screens/Session";
import GroupScorecard from "./screens/GroupScorecard";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/session/:sessionId" element={<Session />} />
      <Route path="/session/:sessionId/group/:groupId" element={<GroupScorecard />} />

      {/* fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
