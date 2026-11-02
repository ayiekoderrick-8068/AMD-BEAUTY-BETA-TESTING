import ResultsList from "../components/ResultsList";
import { tally } from "../utils/tally";

function Switch({ label, hint, on, disabled, onChange }) {
  return (
    <div className="switch-row">
      <div>
        <strong>{label}</strong>
        <span className="muted small">{hint}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        className={`switch ${on ? "on" : ""}`}
        onClick={() => onChange(!on)}
      >
        <span className="knob" />
      </button>
    </div>
  );
}

// Admin overview: attendance, poll controls and live results (all from the server).
export default function OrganizerPage({ overview, polls, busy, onSettings, onResetVotes }) {
  const { total, checkedIn, votes, voters, settings } = overview;
  const percent = total ? Math.round((checkedIn / total) * 100) : 0;
  const answered = Math.max(0, ...polls.map((p) => tally(p, votes).total));

  return (
    <main className="page">
      <div className="stat-pair lifted">
        <section className="stat glass" aria-label="Checked in">
          <p className="eyebrow">Checked in</p>
          <div className="stat-number">{checkedIn}</div>
          <span className="muted small">{percent}% arrived</span>
        </section>
        <section className="stat glass" aria-label="Expected">
          <p className="eyebrow">Expected</p>
          <div className="stat-number">{total}</div>
          <span className="muted small">{total - checkedIn} remaining</span>
        </section>
      </div>

      <section className="stat glass">
        <p className="eyebrow">Poll controls</p>
        <Switch
          label="Poll open"
          hint={settings.pollOpen ? "Attendees can vote" : "Closed: attendees see the waiting screen"}
          on={settings.pollOpen}
          disabled={busy}
          onChange={(v) => onSettings({ pollOpen: v })}
        />
        <Switch
          label="Show results to attendees"
          hint={settings.resultsVisible ? "Results page is visible" : "Results are hidden"}
          on={settings.resultsVisible}
          disabled={busy}
          onChange={(v) => onSettings({ resultsVisible: v })}
        />
        <p className="muted small">
          Participation: {voters} {voters === 1 ? "attendee" : "attendees"} submitted
          {answered !== voters ? ` (${answered} answers counted)` : ""}.
        </p>
      </section>

      <h2 className="section-title row-between">
        Audience poll
        <span className="pill live"><span className="live-dot" /> Live</span>
      </h2>
      {polls.map((poll) => (
        <ResultsList key={poll.id} poll={poll} votes={votes} />
      ))}

      <section className="stat glass">
        <p className="eyebrow">Danger zone</p>
        <p className="muted small">Clears every submitted vote so the poll can be run again.</p>
        <button
          type="button"
          className="btn ghost block"
          disabled={busy}
          onClick={() => window.confirm("Delete all poll votes? This cannot be undone.") && onResetVotes()}
        >
          Reset poll votes
        </button>
      </section>
    </main>
  );
}
