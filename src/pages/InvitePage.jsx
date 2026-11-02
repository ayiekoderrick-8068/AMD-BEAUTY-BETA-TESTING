import { useState, useEffect } from "react";
import QRCode from "qrcode";
import TopBar from "../components/TopBar";
import { ArrowRight } from "../components/Icons";
import useApiData from "../hooks/useApiData";

// A guest's personal invitation. Opening it only reads the invitation: it never checks anyone in.
export default function InvitePage({ token, onNavigate, theme, onToggleTheme, a11y, onA11yChange }) {
  const invite = useApiData(`/invite/${encodeURIComponent(token)}`);
  const code = invite.data?.code;
  const [qr, setQr] = useState("");

  // QR of the check-in code, for ushers who scan at the door.
  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    QRCode.toDataURL(code, { margin: 1, width: 360, color: { dark: "#3a2230", light: "#ffffff" } })
      .then((url) => !cancelled && setQr(url))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [code]);

  let body;
  if (invite.data) {
    const { guest, event } = invite.data;
    body = (
      <article className="invite-card glass slide-in">
        <p className="eyebrow">You're invited</p>
        <h1 className="serif invite-name">Hello, {guest.name}</h1>
        <p>
          Join us for the <strong>AMD Beauty Product Launch</strong>: an exclusive beauty experience,
          product showcase and live audience poll.
        </p>
        {(event.when || event.venue) && (
          <dl className="invite-details">
            {event.when && (<><dt>When</dt><dd>{event.when}</dd></>)}
            {event.venue && (<><dt>Where</dt><dd>{event.venue}</dd></>)}
          </dl>
        )}
        <div className="invite-pass">
          {qr && <img className="invite-qr" src={qr} alt="" width="180" height="180" />}
          <p className="muted small">Your check-in code</p>
          <p className="invite-code">{code}</p>
          <p className="muted small">Show this at the door. An usher will check you in.</p>
        </div>
        <button type="button" className="btn primary block" onClick={() => onNavigate("showcase")}>
          Continue <ArrowRight />
        </button>
      </article>
    );
  } else if (invite.error) {
    const gone = invite.error.status === 410;
    body = (
      <div className="card-center glass">
        <h1 className="serif">{gone ? "Invitation unavailable" : "Invitation not found"}</h1>
        <p className="muted" role="alert">
          {invite.error.status === 0 || invite.error.status >= 500
            ? invite.error.message
            : `${invite.error.message} Please contact the AMD Beauty team if you think this is a mistake.`}
        </p>
        {(invite.error.status === 0 || invite.error.status >= 500) && (
          <button type="button" className="btn primary block" onClick={invite.reload}>Try again</button>
        )}
        <button type="button" className="btn ghost block" onClick={() => onNavigate("")}>Go to AMD Beauty</button>
      </div>
    );
  } else {
    body = <p className="empty" role="status">Opening your invitation…</p>;
  }

  return (
    <main className="page">
      <TopBar theme={theme} onToggleTheme={onToggleTheme} a11y={a11y} onA11yChange={onA11yChange} />
      {body}
    </main>
  );
}
