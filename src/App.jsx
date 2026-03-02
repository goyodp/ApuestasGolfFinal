// src/App.jsx
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Home from "./screens/Home";
import Session from "./screens/Session";
import GroupScorecard from "./screens/GroupScorecard";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, err: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, err: error };
  }
  componentDidCatch(error, info) {
    console.error("UI crashed:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16, fontFamily: "system-ui" }}>
          <h2 style={{ margin: 0 }}>Se rompió la UI 😅</h2>
          <div style={{ marginTop: 10, opacity: 0.8 }}>
            Abre la consola para ver el error exacto.
          </div>
          <pre
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 12,
              background: "#0b0b0b",
              color: "white",
              overflow: "auto",
              maxHeight: 320,
            }}
          >
            {String(this.state.err?.message || this.state.err || "Unknown error")}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 12,
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid #2a2a2a",
              background: "#111",
              color: "white",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            Recargar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/session/:sessionId" element={<Session />} />
        <Route path="/session/:sessionId/group/:groupId" element={<GroupScorecard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
