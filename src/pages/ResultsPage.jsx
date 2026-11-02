import TopBar from "../components/TopBar";
import ResultsList from "../components/ResultsList";
import useApiData from "../hooks/useApiData";
import useLive from "../hooks/useLive";

export default function ResultsPage({ polls, onNavigate, theme, onToggleTheme, a11y, onA11yChange }) {
  const live = useLive(["poll"]);
  const results = useApiData("/poll/results", live.tick);
  const hidden = results.error?.status === 403;

  let body;
  if (results.data && !hidden) {
    body = (
      <>
        <p className="muted small center results-count">
          {results.data.voters} {results.data.voters === 1 ? "person has" : "people have"} voted
          {live.connected ? " · updating live" : ""}
        </p>
        {polls.map((poll) => <ResultsList key={poll.id} poll={poll} votes={results.data.votes} heading="h2" />)}
      </>
    );
  } else if (hidden) {
    body = (
      <div className="card-center glass">
        <h2 className="serif">Results are hidden</h2>
        <p className="muted">The organizer will share results when they are ready.</p>
      </div>
    );
  } else if (results.error) {
    body = (
      <div className="card-center glass">
        <h2 className="serif">Can't load results</h2>
        <p className="muted" role="alert">{results.error.message}</p>
        <button type="button" className="btn primary block" onClick={results.reload}>Try again</button>
      </div>
    );
  } else {
    body = <p className="empty" role="status">Loading results…</p>;
  }

  return (
    <main className="page">
      <TopBar
        onBack={() => onNavigate("poll")}
        backLabel="Back to poll"
        theme={theme}
        onToggleTheme={onToggleTheme}
        a11y={a11y}
        onA11yChange={onA11yChange}
      />
      <div className="poll-head">
        <span className="pill live"><span className="live-dot" /> Live Results</span>
      </div>
      <h1 className="serif q-title">What everyone thinks</h1>
      {body}
    </main>
  );
}
