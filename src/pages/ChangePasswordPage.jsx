import { useState } from "react";

// Shown after login until a temporary password has been replaced.
export default function ChangePasswordPage({ user, onChange, onLogout }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (next !== confirm) return setError("New passwords do not match.");
    setBusy(true);
    setError("");
    try {
      await onChange(current, next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <header className="band">
        <div className="band-top">
          <span className="band-brand">LaunchPad</span>
          <span className="band-chip">{user.role === "admin" ? "Admin" : "Usher"}</span>
        </div>
        <h1 className="band-title">Set your password</h1>
        <p className="band-sub">Signed in as {user.username}</p>
      </header>

      <form className="auth-card glass lifted" onSubmit={submit}>
        <p className="muted small">
          You signed in with a temporary password. Choose a new one (at least 10 characters) to continue.
        </p>
        <label className="field">
          <span>Temporary password</span>
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label className="field">
          <span>New password</span>
          <input className="input" type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required />
        </label>
        <label className="field">
          <span>Confirm new password</span>
          <input className="input" type="password" autoComplete="new-password" minLength={10} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
        {error && <div className="msg error" role="alert">{error}</div>}
        <button className="btn primary block" type="submit" disabled={busy || !current || next.length < 10 || !confirm}>
          {busy ? "Saving…" : "Save password"}
        </button>
        <button className="btn ghost block" type="button" onClick={onLogout}>Log out</button>
      </form>
    </main>
  );
}
