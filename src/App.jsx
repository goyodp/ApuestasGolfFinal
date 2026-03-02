// src/App.jsx
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Home from "./screens/Home";
import Session from "./screens/Session";
import GroupScorecard from "./screens/GroupScorecard";

import { Capacitor } from "@capacitor/core";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";

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
  const [busy, setBusy] = React.useState(false);

  const testGoogleLogin = async () => {
    // Esto ayuda a confirmar que el handler sí corre
    alert("CLICK GOOGLE TEST ✅");
    console.log(">>> CLICK GOOGLE TEST");

    // Si estás en navegador normal, esto no va a funcionar (debe ser Capacitor native)
    const isNative = Capacitor.isNativePlatform();
    console.log(">>> isNativePlatform:", isNative, "platform:", Capacitor.getPlatform());

    if (!isNative) {
      alert(
        "Esto solo funciona en iOS/Android (Capacitor). En web no. Corre en Xcode/Android Studio."
      );
      return;
    }

    try {
      setBusy(true);
      console.log(">>> START signInWithGoogle");

      const res = await FirebaseAuthentication.signInWithGoogle();

      console.log(">>> OK signInWithGoogle", res);

      const email =
        res?.user?.email ||
        res?.additionalUserInfo?.profile?.email ||
        res?.credential?.idToken?.slice?.(0, 12) ||
        "OK";

      alert("Google OK ✅\n" + email);
    } catch (e) {
      console.log(">>> ERROR signInWithGoogle", e);
      alert("Google ERROR ❌\n" + (e?.message ?? JSON.stringify(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ErrorBoundary>
      {/* Botón flotante para testear Google Login en cualquier pantalla */}
      <button
        onClick={testGoogleLogin}
        disabled={busy}
        style={{
          position: "fixed",
          right: 12,
          bottom: 12,
          zIndex: 99999,
          padding: "12px 14px",
          borderRadius: 999,
          border: "1px solid rgba(0,0,0,0.15)",
          background: busy ? "#999" : "#111",
          color: "white",
          fontWeight: 900,
          cursor: busy ? "not-allowed" : "pointer",
          boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
        }}
        title="Test Google Login (Capacitor)"
      >
        {busy ? "Google..." : "Test Google"}
      </button>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/session/:sessionId" element={<Session />} />
        <Route
          path="/session/:sessionId/group/:groupId"
          element={<GroupScorecard />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
