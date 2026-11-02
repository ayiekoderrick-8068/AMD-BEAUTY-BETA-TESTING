import { useState } from "react";
import CodeEntry from "../components/CodeEntry";
import GuestCard from "../components/GuestCard";
import { api } from "../api/client";
import { displayName, formatTime } from "../utils/format";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "in", label: "Checked in" },
  { id: "out", label: "Pending" },
];

// Usher view: search, code entry and check-in only. No guest editing.
export default function UsherPage({ data, error, loading, reload }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [notice, setNotice] = useState(null);

  if (loading && !data) return <main className="page"><p className="empty" role="status">Loading guests…</p></main>;
  if (!data) {
    return (
      <main className="page">
        <div className="msg error" role="alert">{error?.message ?? "Could not load guests."}</div>
        <button type="button" className="btn ghost block" onClick={reload}>Try again</button>
      </main>
    );
  }

  const guests = data.guests;
  const inCount = guests.filter((g) => g.checkedInAt).length;
  const counts = { all: guests.length, in: inCount, out: guests.length - inCount };
  const q = query.trim().toLowerCase();
  const results = guests.filter((g) => {
    const matches = !q || [g.name, g.organization, g.code].some((v) => (v ?? "").toLowerCase().includes(q));
    const status = filter === "all" || (filter === "in") === Boolean(g.checkedInAt);
    return matches && status;
  });
  const percent = counts.all ? Math.round((inCount / counts.all) * 100) : 0;

  async function checkIn(body) {
    try {
      const res = await api("/checkin", { method: "POST", body });
      reload();
      return res;
    } catch (err) {
      return { status: "error", message: err.message };
    }
  }

  async function checkInGuest(id) {
    const res = await checkIn({ guestId: id });
    if (res.status === "ok") setNotice({ type: "ok", text: `Invitation confirmed. Welcome, ${displayName(res.guest)}!` });
    else if (res.status === "revoked") setNotice({ type: "error", text: `${displayName(res.guest)}'s invitation was revoked. Please ask the organizer.` });
    else if (res.status === "already") setNotice({ type: "already", text: `${displayName(res.guest)} already checked in at ${formatTime(res.time)}` });
    else setNotice({ type: "error", text: res.message ?? "Guest not found" });
  }

  function checkInByCode(code) {
    if (!code.trim()) return Promise.resolve({ status: "empty" });
    return checkIn({ code: code.trim() });
  }

  return (
    <main className="page">
      <section className="stat glass lifted" aria-label="Attendance">
        <p className="eyebrow">Arrived</p>
        <div className="arrived">
          <span className="stat-number">{inCount}</span>
          <span className="muted small">of {counts.all} registered guests · {counts.out} pending</span>
        </div>
        <div className="bar-track" aria-hidden="true"><div className="bar-fill" style={{ width: `${percent}%` }} /></div>
      </section>

      {error && <div className="msg error" role="alert">Connection problem: {error.message}</div>}

      <CodeEntry onCheckInByCode={checkInByCode} />

      <h2 className="section-title">Find a guest</h2>
      <input
        className="input"
        type="search"
        placeholder="Search name, company or code"
        aria-label="Search guests by name, organization or code"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="chips" role="group" aria-label="Filter guests">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`chip ${filter === f.id ? "on" : ""}`}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label} ({counts[f.id]})
          </button>
        ))}
      </div>

      {notice && <div className={`msg ${notice.type}`} role="status">{notice.text}</div>}

      <p className="eyebrow list-label">Matching guests</p>
      <ul className="list">
        {results.map((g) => (
          <GuestCard key={g.id} guest={g} checkedAt={g.checkedInAt} onCheckIn={checkInGuest} />
        ))}
      </ul>
      {results.length === 0 && <p className="empty">No guests found</p>}
    </main>
  );
}
