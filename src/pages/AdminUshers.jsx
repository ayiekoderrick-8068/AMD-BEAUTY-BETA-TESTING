import { useState } from "react";
import { api } from "../api/client";
import useApiData from "../hooks/useApiData";

// One-time display of a temporary password. It is not stored anywhere in the browser.
function TempPassword({ creds, onDone }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(creds.tempPassword);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="msg already temp-pw" role="status">
      <p>Temporary password for <strong>{creds.username}</strong>. It is shown only once. Give it to the usher privately; they must change it at first sign-in.</p>
      <code className="pw">{creds.tempPassword}</code>
      <div className="nav-row">
        <button type="button" className="btn ghost grow" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
        <button type="button" className="btn primary grow" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

export default function AdminUshers() {
  const { data, error, loading, reload } = useApiData("/admin/ushers");
  const [username, setUsername] = useState("");
  const [creds, setCreds] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  async function run(fn) {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setNotice({ type: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  function create(e) {
    e.preventDefault();
    run(async () => {
      setCreds(await api("/admin/ushers", { method: "POST", body: { username: username.trim() } }));
      setUsername("");
    });
  }

  return (
    <main className="page">
      <section className="stat glass lifted">
        <p className="eyebrow">Create usher account</p>
        <form className="code-form" onSubmit={create}>
          <input
            className="input"
            aria-label="New usher username"
            placeholder="e.g. amd.usher02"
            autoCapitalize="none"
            spellCheck="false"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <button className="btn" type="submit" disabled={busy || username.trim().length < 3}>Create</button>
        </form>
        <p className="muted small">3–32 characters: letters, numbers, dot, dash or underscore.</p>
      </section>

      {creds && <TempPassword creds={creds} onDone={() => setCreds(null)} />}
      {notice && <div className={`msg ${notice.type}`} role="alert">{notice.text}</div>}

      <h2 className="section-title">Ushers</h2>
      {loading && !data && <p className="empty" role="status">Loading…</p>}
      {error && !data && <div className="msg error" role="alert">{error.message}</div>}
      <ul className="list">
        {data?.ushers.map((u) => (
          <li key={u.id} className="card glass">
            <div className="card-info">
              <strong>{u.username}</strong>
              <span>
                <span className={`tag ${u.active ? "" : "off"}`}>{u.active ? "Active" : "Deactivated"}</span>
                {u.mustChange ? " · Must set password" : ""}
              </span>
              <span>{u.lastLoginAt ? `Last sign-in ${new Date(u.lastLoginAt).toLocaleString()}` : "Never signed in"}</span>
            </div>
            <div className="row-actions vertical">
              <button
                type="button"
                className={`link-btn ${u.active ? "danger" : ""}`}
                disabled={busy}
                onClick={() => run(() => api(`/admin/ushers/${u.id}`, { method: "PATCH", body: { active: !u.active } }))}
              >
                {u.active ? "Deactivate" : "Activate"}<span className="sr-only"> {u.username}</span>
              </button>
              <button
                type="button"
                className="link-btn"
                disabled={busy}
                onClick={() =>
                  window.confirm(`Reset the password for ${u.username}? They will be signed out.`) &&
                  run(async () => setCreds(await api(`/admin/ushers/${u.id}/reset-password`, { method: "POST" })))
                }
              >
                Reset password<span className="sr-only"> for {u.username}</span>
              </button>
            </div>
          </li>
        ))}
      </ul>
      {data && data.ushers.length === 0 && <p className="empty">No usher accounts yet.</p>}
    </main>
  );
}
