import { useState, useEffect, useRef } from "react";
import TopBar from "../components/TopBar";
import WaitingPage from "./WaitingPage";
import { OptionIcon, ArrowLeft, ArrowRight, Check } from "../components/Icons";
import { loadData, saveData, removeData } from "../utils/storage";
import { api } from "../api/client";
import useApiData from "../hooks/useApiData";
import useLive from "../hooks/useLive";

const DRAFT_KEY = "amd_draft";

function Progress({ step, total }) {
  return (
    <div className="steps" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={Math.min(step + 1, total)}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`seg ${i <= step ? "on" : ""}`} />
      ))}
    </div>
  );
}

function ThankYou({ resultsVisible, onNavigate }) {
  return (
    <div className="card-center glass thanks">
      <div className="success" aria-hidden="true"><Check width={36} height={36} strokeWidth={2.4} /></div>
      <h1 className="serif">Thank You!</h1>
      <p>Your responses have been recorded.</p>
      {resultsVisible ? (
        <button type="button" className="btn primary block" onClick={() => onNavigate("results")}>
          View Live Results <ArrowRight />
        </button>
      ) : (
        <p className="muted small">The organizer will share results when they are ready.</p>
      )}
    </div>
  );
}

export default function PollPage({ polls, onNavigate, theme, onToggleTheme, a11y, onA11yChange }) {
  const total = polls.length;
  const live = useLive(["poll"]);
  const status = useApiData("/poll", live.tick);
  // A draft saved against different questions or options is dropped rather than shown as answers.
  const signature = polls.map((p) => `${p.id}:${p.options.map((o) => o.label).join("|")}`).join(";");
  const [draft, setDraft] = useState(() => {
    const saved = loadData(DRAFT_KEY, null);
    if (saved?.signature !== signature) return { answers: {}, step: 0 };
    return { answers: saved.answers ?? {}, step: Math.min(saved.step ?? 0, total) };
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { answers, step } = draft;
  const submitted = Boolean(status.data?.submitted);
  const settings = { pollOpen: Boolean(status.data?.open), resultsVisible: Boolean(status.data?.resultsVisible) };

  // Answers in progress survive a refresh; they only leave the device on Submit.
  useEffect(() => {
    if (!submitted) saveData(DRAFT_KEY, { ...draft, signature });
  }, [draft, submitted, signature]);

  // Move focus to each new question so screen readers read it out (not on first load).
  const headingRef = useRef(null);
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    headingRef.current?.focus();
  }, [step]);

  const shell = (children) => (
    <div className="page">
      <TopBar
        onBack={
          submitted || step === 0
            ? () => onNavigate("showcase")
            : () => setDraft((d) => ({ ...d, step: d.step - 1 }))
        }
        backLabel={step === 0 || submitted ? "Back to products" : "Previous question"}
        theme={theme}
        onToggleTheme={onToggleTheme}
        a11y={a11y}
        onA11yChange={onA11yChange}
      />
      {children}
    </div>
  );

  if (!status.data) {
    return shell(
      status.error ? (
        <div className="card-center glass">
          <h1 className="serif">Can't load the poll</h1>
          <p className="muted" role="alert">{status.error.message}</p>
          <button type="button" className="btn primary block" onClick={status.reload}>Try again</button>
        </div>
      ) : (
        <p className="empty" role="status">Loading poll…</p>
      )
    );
  }

  if (submitted) {
    return shell(<ThankYou resultsVisible={settings.resultsVisible} onNavigate={onNavigate} />);
  }

  // Live updates flip this screen to the poll as soon as the organizer opens it.
  if (!settings.pollOpen) {
    return shell(<WaitingPage onBack={() => onNavigate("showcase")} />);
  }

  const isReview = step >= total;
  const poll = polls[step];
  const selected = poll ? answers[poll.id] : null;

  function choose(label) {
    setError("");
    setDraft((d) => ({ ...d, answers: { ...d.answers, [poll.id]: label } }));
  }

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await api("/poll/vote", { method: "POST", body: { answers } });
      removeData(DRAFT_KEY);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
      status.reload(); // Picks up "submitted" or a closed poll.
    }
  }

  if (isReview) {
    return shell(
      <>
        <div className="poll-head">
          <span className="pill live"><span className="live-dot" /> Live Poll</span>
          <span className="muted small">Review</span>
        </div>
        <Progress step={total - 1} total={total} />
        <h1 className="serif q-title" ref={headingRef} tabIndex={-1}>Review your answers</h1>
        <ul className="review glass slide-in">
          {polls.map((p, i) => (
            <li key={p.id}>
              <div>
                <span className="muted small">{p.text}</span>
                <strong>{answers[p.id] ?? "Not answered"}</strong>
              </div>
              <button type="button" className="link-btn" onClick={() => setDraft((d) => ({ ...d, step: i }))}>
                Edit<span className="sr-only"> answer to: {p.text}</span>
              </button>
            </li>
          ))}
        </ul>
        {error && <div className="msg error" role="alert">{error}</div>}
        <div className="nav-row">
          <button type="button" className="btn ghost" onClick={() => setDraft((d) => ({ ...d, step: total - 1 }))}>
            <ArrowLeft /> Previous
          </button>
          <button
            type="button"
            className="btn primary grow"
            onClick={submit}
            disabled={submitting || polls.some((p) => !answers[p.id])}
          >
            {submitting ? "Submitting…" : "Submit Vote"} <ArrowRight />
          </button>
        </div>
      </>
    );
  }

  const last = step === total - 1;

  return shell(
    <>
      {step === 0 && (
        <div className="band band-inline">
          <h1 className="band-title">Your voice matters.</h1>
          <p className="band-sub">Participate in the moment.</p>
        </div>
      )}
      <div className="poll-head">
        <span className="pill live"><span className="live-dot" /> Live Poll</span>
        <span className="muted small">Question {step + 1} of {total}</span>
      </div>
      <Progress step={step} total={total} />

      {/* key replays the slide-in animation for each new question */}
      <fieldset className="question slide-in" key={poll.id}>
        <legend className="serif q-title" ref={headingRef} tabIndex={-1}>{poll.text}</legend>
        <div className="options">
          {poll.options.map((opt, i) => {
            const on = selected === opt.label;
            return (
              <label key={opt.label} className={`option glass ${on ? "selected" : ""}`}>
                <input
                  type="radio"
                  className="sr-only"
                  name={poll.id}
                  value={opt.label}
                  checked={on}
                  onChange={() => choose(opt.label)}
                />
                <span className="letter" aria-hidden="true">{String.fromCharCode(65 + i)}</span>
                <span className="opt-visual" style={opt.swatch ? { background: opt.swatch } : undefined} aria-hidden="true">
                  {opt.icon && <OptionIcon name={opt.icon} />}
                </span>
                <span className="opt-text">
                  <strong>{opt.label}</strong>
                  <small>{opt.hint}</small>
                </span>
                <span className="opt-radio" aria-hidden="true" />
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="nav-row">
        {step > 0 && (
          <button type="button" className="btn ghost" onClick={() => setDraft((d) => ({ ...d, step: d.step - 1 }))}>
            <ArrowLeft /> Previous
          </button>
        )}
        <button
          type="button"
          className="btn primary grow"
          disabled={!selected}
          onClick={() => setDraft((d) => ({ ...d, step: d.step + 1 }))}
        >
          {last ? "Review answers" : "Next Question"} <ArrowRight />
        </button>
      </div>
    </>
  );
}
