import { Routes, Route } from "react-router-dom";
import Home from "./screens/Home";
import Session from "./screens/Session";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/session/:sessionId" element={<Session />} />
    </Routes>
  );
}
