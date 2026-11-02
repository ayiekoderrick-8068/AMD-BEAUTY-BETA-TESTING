import { useState } from "react";
import { api } from "../api/client";
import { displayOrg, displayTicket, formatTime } from "../utils/format";
import { invitationMessage, whatsappUrl, copyText } from "../utils/invite";

const EMPTY = { name: "", organization: "", ticketType: "", phone: "" };
const STATUS = {
  active: { label: "Invite active", className: "tag ok" },
  revoked: { label: "Invite revoked", className: "tag off" },
  expired: { label: "Invite expired", className: "tag warn" },
  none: { label: "No invite", className: "tag off" },
};

function GuestForm({ initial = EMPTY, submitLabel, onSubmit, onCancel }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) return setError("Guest name is required.");
    setBusy(true);
    setError("");
    try {
      await onSubmit(form);
      if (!onCancel) setForm(EMPTY);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="guest-form" onSubmit={submit}>
      <label className="field"><span>Name</span><input className="input" value={form.name} onChange={set("name")} maxLength={120} required /></label>
      <label className="field"><span>Organization</span><input className="input" value={form.organization} onChange={set("organization")} maxLength={120} /></label>
      <label className="field"><span>Ticket type</span><input className="input" list="ticket-types" value={form.ticketType} onChange={set("ticketType")} maxLength={40} /></label>
      <datalist id="ticket-types">
        <option value="VIP" /><option value="General" /><option value="Press" /><option value="Influencer" />
      </datalist>
      <label className="field">
        <span>WhatsApp number <span className="muted small">(optional, with country code)</span></span>
        <input className="input" type="tel" inputMode="tel" placeholder="+254 712 345678" value={form.phone} onChange={set("phone")} maxLength={32} />
      </label>
      {error && <div className="msg error" role="alert">{error}</div>}
      <div className="nav-row">
        {onCancel && <button type="button" className="btn ghost grow" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="btn primary grow" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
      </div>
    </form>
  );
}

// ISO -> value for <input type="datetime-local"> in the admin's time zone.
function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function EventDetails({ event, onSaved }) {
  const [form, setForm] = useState({ when: event.when, venue: event.venue, expiresAt: toLocalInput(event.expiresAt) });
  const [status, setStatus] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setStatus(null);
    try {
      await api("/admin/event", {
        method: "PUT",
        body: { ...form, expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null },
      });
      setStatus({ type: "ok", text: "Invitation details saved." });
      onSaved();
    } catch (err) {
      setStatus({ type: "error", text: err.message });
    }
  }

  return (
    <details className="stat glass">
      <summary className="eyebrow summary">Invitation details</summary>
      <p className="muted small">Shown in invitation messages and on the invitation page. Leave blank to leave them out.</p>
      <form className="guest-form" onSubmit={submit}>
        <label className="field"><span>Date and time</span><input className="input" placeholder="e.g. Saturday 15 November, 6:00 PM" value={form.when} onChange={set("when")} maxLength={120} /></label>
        <label className="field"><span>Venue</span><input className="input" value={form.venue} onChange={set("venue")} maxLength={160} /></label>
        <label className="field">
          <span>Links stop working after <span className="muted small">(optional)</span></span>
          <input className="input" type="datetime-local" value={form.expiresAt} onChange={set("expiresAt")} />
        </label>
        {status && <div className={`msg ${status.type}`} role="status">{status.text}</div>}
        <button type="submit" className="btn primary block">Save details</button>
      </form>
    </details>
  );
}

// Copy + WhatsApp are always visible; everything else sits in a compact "More" menu.
function GuestActions({ guest, event, onEdit, act, onNotice }) {
  const [open, setOpen] = useState(false);
  const inv = guest.invitation;
  const url = inv.status === "active" ? inv.url : null;

  async function copy() {
    if (await copyText(url)) onNotice({ type: "ok", text: `Invitation link for ${guest.name} copied.` });
    else onNotice({ type: "already", text: `Copy this link for ${guest.name}:`, link: url });
  }

  const run = (fn, success) => {
    setOpen(false);
    act(fn, success);
  };

  return (
    <>
      <div className="row-actions">
        <button type="button" className="link-btn" onClick={copy} disabled={!url}>
          Copy link<span className="sr-only"> for {guest.name}</span>
        </button>
        {url ? (
          <a className="link-btn" href={whatsappUrl(guest.phone, invitationMessage(guest, url, event))} target="_blank" rel="noopener noreferrer">
            WhatsApp<span className="sr-only"> invitation to {guest.name} (opens WhatsApp)</span>
          </a>
        ) : (
          <button type="button" className="link-btn" disabled>WhatsApp</button>
        )}
        <button type="button" className="link-btn more-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          More<span className="sr-only"> actions for {guest.name}</span> {open ? "▴" : "▾"}
        </button>
      </div>
      {open && (
        <div className="row-actions more-menu" role="group" aria-label={`More actions for ${guest.name}`}>
          <button type="button" className="link-btn" onClick={() => { setOpen(false); onEdit(); }}>Edit guest</button>
          <button
            type="button"
            className="link-btn"
            onClick={() =>
              (inv.status === "revoked" || window.confirm(`Create a new invitation link for ${guest.name}? The current link will stop working.`)) &&
              run(() => api(`/admin/guests/${guest.id}/invitation`, { method: "POST" }), `New invitation link created for ${guest.name}.`)
            }
          >
            {inv.status === "revoked" ? "Restore with new link" : "Regenerate link"}
          </button>
          {inv.status !== "revoked" && (
            <button
              type="button"
              className="link-btn danger"
              onClick={() =>
                window.confirm(`Revoke ${guest.name}'s invitation? Their link will stop working and they cannot be checked in until you create a new link.`) &&
                run(() => api(`/admin/guests/${guest.id}/invitation`, { method: "DELETE" }), `Invitation revoked for ${guest.name}.`)
              }
            >
              Revoke invitation
            </button>
          )}
          {guest.checkedInAt && (
            <button
              type="button"
              className="link-btn"
              onClick={() =>
                window.confirm(`Undo ${guest.name}'s check-in? They will show as not arrived until checked in again.`) &&
                run(() => api(`/admin/guests/${guest.id}/checkin`, { method: "DELETE" }), `Check-in undone for ${guest.name}.`)
              }
            >
              Undo check-in
            </button>
          )}
          <button
            type="button"
            className="link-btn"
            onClick={() =>
              window.confirm(`Generate a new check-in code for ${guest.name}? The old code will stop working.`) &&
              run(() => api(`/admin/guests/${guest.id}/code`, { method: "POST" }), `New code generated for ${guest.name}.`)
            }
          >
            New check-in code
          </button>
          <button
            type="button"
            className="link-btn danger"
            onClick={() =>
              window.confirm(`Delete ${guest.name}? Their invitation and check-in record will also be removed.`) &&
              run(() => api(`/admin/guests/${guest.id}`, { method: "DELETE" }), `Deleted ${guest.name}.`)
            }
          >
            Delete guest
          </button>
        </div>
      )}
    </>
  );
}

export default function AdminGuests({ guests, event, reload }) {
  const [editing, setEditing] = useState(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState(null);
  const [added, setAdded] = useState(null);

  const q = query.trim().toLowerCase();
  const list = guests.filter((g) => !q || [g.name, g.organization, g.code].some((v) => (v ?? "").toLowerCase().includes(q)));
  // The just-added guest, kept fresh from the live list.
  const newGuest = added && guests.find((g) => g.id === added);

  async function add(form) {
    const { guest } = await api("/admin/guests", { method: "POST", body: form });
    setNotice({ type: "ok", text: `Added ${guest.name}. Check-in code: ${guest.code}. Their invitation link is ready.` });
    setAdded(guest.id);
    reload();
  }

  async function save(id, form) {
    await api(`/admin/guests/${id}`, { method: "PUT", body: form });
    setEditing(null);
    setNotice({ type: "ok", text: "Guest updated." });
    reload();
  }

  async function act(fn, success) {
    try {
      await fn();
      setNotice({ type: "ok", text: success });
      reload();
    } catch (err) {
      setNotice({ type: "error", text: err.message });
    }
  }

  return (
    <main className="page">
      <section className="stat glass lifted">
        <p className="eyebrow">Add guest</p>
        <p className="muted small">A unique check-in code and invitation link are created automatically.</p>
        <GuestForm submitLabel="Add guest" onSubmit={add} />
        {newGuest && (
          <div className="new-invite">
            <p className="small"><strong>{newGuest.name}</strong>: send the invitation now</p>
            <GuestActions guest={newGuest} event={event} onEdit={() => setEditing(newGuest.id)} act={act} onNotice={setNotice} />
          </div>
        )}
      </section>

      <EventDetails event={event} onSaved={reload} />

      {notice && (
        <div className={`msg ${notice.type}`} role="status">
          {notice.text}
          {notice.link && <code className="pw">{notice.link}</code>}
        </div>
      )}

      <h2 className="section-title">All guests ({guests.length})</h2>
      <input className="input" type="search" placeholder="Search name, company or code" aria-label="Search guests" value={query} onChange={(e) => setQuery(e.target.value)} />

      <ul className="list">
        {list.map((g) =>
          editing === g.id ? (
            <li key={g.id} className="card glass column">
              <GuestForm
                initial={{ name: g.name, organization: g.organization, ticketType: g.ticketType, phone: g.phone ? `+${g.phone}` : "" }}
                submitLabel="Save"
                onSubmit={(form) => save(g.id, form)}
                onCancel={() => setEditing(null)}
              />
            </li>
          ) : (
            <li key={g.id} className="card glass column">
              <div className="card-info">
                <strong>{g.name}</strong>
                <span>{displayOrg(g)} · {displayTicket(g)}{g.phone ? ` · +${g.phone}` : ""}</span>
                <span>
                  <span className="tag">{g.code}</span>{" "}
                  <span className={STATUS[g.invitation.status].className}>{STATUS[g.invitation.status].label}</span>{" "}
                  {g.checkedInAt ? `Checked in ${formatTime(g.checkedInAt)}` : "Not checked in"}
                </span>
              </div>
              <GuestActions guest={g} event={event} onEdit={() => setEditing(g.id)} act={act} onNotice={setNotice} />
            </li>
          )
        )}
      </ul>
      {list.length === 0 && <p className="empty">No guests found</p>}
    </main>
  );
}
