import { useState } from "react";
import ThemeToggle from "../components/ThemeToggle";

// Shared by /staff/login (ushers) and /admin/login (admins). Not linked from any public page.
export default function LoginPage({ portal, onLogin, notice, theme, onToggleTheme }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isAdmin = portal === "admin";

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onLogin(username.trim(), password, portal);
    } catch (err) {
      setError(err.message);
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <header className="band">
        <div className="band-top">
          <span className="band-brand">LaunchPad</span>
          <span className="band-chip">{isAdmin ? "Admin" : "Usher"}</span>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>
        <h1 className="band-title">{isAdmin ? "Admin sign in" : "Staff sign in"}</h1>
        <p className="band-sub">AMD Beauty product launch</p>
      </header>

      <form className="auth-card glass lifted" onSubmit={submit} noValidate>
        {notice && <div className="msg already" role="status">{notice}</div>}
        <label className="field">
          <span>Username</span>
          <input
            className="input"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck="false"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <div className="msg error" role="alert">{error}</div>}
        <button className="btn primary block" type="submit" disabled={busy || !username.trim() || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
