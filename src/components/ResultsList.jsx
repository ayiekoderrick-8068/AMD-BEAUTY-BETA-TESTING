import { useState, useEffect } from "react";
import { tally } from "../utils/tally";

// `heading` is the level of the question title: h3 under an h2 section (admin), h2 straight under the page h1.
export default function ResultsList({ poll, votes, heading: Heading = "h3" }) {
  const { total, rows } = tally(poll, votes);
  const [ready, setReady] = useState(false);

  // Start bars at 0 so they animate in on first paint.
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <section className="results-card glass" aria-label={poll.text}>
      <div className="results-head">
        <Heading>{poll.text}</Heading>
        <span className="pill" aria-live="polite">
          {total} {total === 1 ? "vote" : "votes"}
        </span>
      </div>
      {total === 0 && <p className="muted small">No votes yet.</p>}
      <ul className="results-rows">
        {rows.map((r, i) => (
          <li key={r.label} className={r.leading ? "leading" : ""}>
            <div className="result-label">
              <span className="result-name">
                <span className="letter">{String.fromCharCode(65 + i)}</span>
                {r.label}
                {r.leading && <span className="lead-tag">Leading</span>}
              </span>
              <span className="result-pct">{r.pct}%</span>
            </div>
            <div className="bar-track" aria-hidden="true">
              <div className="bar-fill" style={{ width: ready ? `${r.pct}%` : "0%" }} />
            </div>
            <span className="muted small">
              {r.n} {r.n === 1 ? "vote" : "votes"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
