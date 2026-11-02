import { useState } from "react";
import Header from "../components/Header";
import OrganizerPage from "./OrganizerPage";
import AdminGuests from "./AdminGuests";
import AdminUshers from "./AdminUshers";
import useApiData from "../hooks/useApiData";
import useLive from "../hooks/useLive";
import { api } from "../api/client";
import { polls } from "../data/polls";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "guests", label: "Guests" },
  { id: "ushers", label: "Ushers" },
];
const TITLES = { overview: "Event overview", guests: "Guest list", ushers: "Usher accounts" };

export default function AdminPage({ user, onLogout, theme, onToggleTheme }) {
  const [section, setSection] = useState("overview");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const live = useLive(["poll", "checkins", "guests"]);
  const overview = useApiData("/admin/overview", live.tick);
  const guests = useApiData("/admin/guests", live.tick);

  async function act(fn) {
    setBusy(true);
    setActionError("");
    try {
      await fn();
      overview.reload();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  }

  let body;
  if (section === "ushers") {
    body = <AdminUshers />;
  } else if (section === "guests") {
    body = guests.data
      ? <AdminGuests guests={guests.data.guests} event={guests.data.event} reload={guests.reload} />
      : <main className="page"><p className="empty" role="status">{guests.error?.message ?? "Loading…"}</p></main>;
  } else {
    body = overview.data ? (
      <OrganizerPage
        overview={overview.data}
        polls={polls}
        busy={busy}
        onSettings={(patch) => act(() => api("/admin/settings", { method: "PUT", body: patch }))}
        onResetVotes={() => act(() => api("/admin/poll/reset", { method: "POST" }))}
      />
    ) : (
      <main className="page"><p className="empty" role="status">{overview.error?.message ?? "Loading…"}</p></main>
    );
  }

  return (
    <div className="app staff">
      <Header
        role="Admin"
        title={TITLES[section]}
        user={user}
        onLogout={onLogout}
        tabs={TABS}
        section={section}
        onSection={setSection}
        live={live.connected}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />
      {actionError && <div className="page"><div className="msg error" role="alert">{actionError}</div></div>}
      {body}
    </div>
  );
}
