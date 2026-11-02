import { useEffect } from "react";
import "./App.css";
import "./styles/attendee.css";
import { polls } from "./data/polls";
import useRoute from "./hooks/useRoute";
import useTheme from "./hooks/useTheme";
import useA11y from "./hooks/useA11y";
import useAuth from "./hooks/useAuth";
import useApiData from "./hooks/useApiData";
import useLive from "./hooks/useLive";
import Header from "./components/Header";
import LandingPage from "./pages/LandingPage";
import InvitePage from "./pages/InvitePage";
import ShowcasePage from "./pages/ShowcasePage";
import PollPage from "./pages/PollPage";
import ResultsPage from "./pages/ResultsPage";
import UsherPage from "./pages/UsherPage";
import AdminPage from "./pages/AdminPage";
import LoginPage from "./pages/LoginPage";
import ChangePasswordPage from "./pages/ChangePasswordPage";

// Which role each private route needs, and where to send visitors who don't have it.
const PRIVATE = {
  usher: { role: "usher", login: "staff/login" },
  admin: { role: "admin", login: "admin/login" },
};
const LOGIN = { "staff/login": "usher", "admin/login": "admin" };

function UsherRoute({ user, onLogout, theme, onToggleTheme }) {
  const live = useLive(["checkins", "guests"]);
  const guests = useApiData("/guests", live.tick);
  return (
    <div className="app staff">
      <Header
        role="Usher"
        title="Guest check-in"
        user={user}
        onLogout={onLogout}
        live={live.connected}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />
      <UsherPage {...guests} />
    </div>
  );
}

export default function App() {
  const [route, navigate] = useRoute();
  const [theme, toggleTheme] = useTheme();
  const [a11y, setA11y] = useA11y();
  const guard = PRIVATE[route];
  const loginRole = LOGIN[route];
  const auth = useAuth(Boolean(guard || loginRole));
  const themeProps = { theme, onToggleTheme: toggleTheme };
  // Attendee screens also get the text size / high contrast controls.
  const attendeeProps = { ...themeProps, a11y, onA11yChange: setA11y };

  // A staff request came back 401: re-check the session so the guard below sends them to sign in.
  const { refresh } = auth;
  useEffect(() => {
    window.addEventListener("amd:signed-out", refresh);
    return () => window.removeEventListener("amd:signed-out", refresh);
  }, [refresh]);

  // Send visitors without the right role to the matching login page (and signed-in staff away from it).
  useEffect(() => {
    if (auth.loading) return;
    if (guard && auth.user?.role !== guard.role) navigate(guard.login, { replace: true });
    if (loginRole && auth.user?.role === loginRole) navigate(loginRole, { replace: true });
  }, [auth.loading, auth.user, guard, loginRole, navigate]);

  async function logout() {
    const login = guard?.login ?? "staff/login";
    await auth.logout();
    navigate(login, { replace: true });
  }

  // ---- Attendee (public) ----
  if (route === "") return <LandingPage onStart={() => navigate("showcase")} />;
  if (route.startsWith("invite/")) {
    return <InvitePage token={route.slice("invite/".length)} onNavigate={navigate} {...attendeeProps} />;
  }
  if (route === "showcase") return <ShowcasePage onNavigate={navigate} {...attendeeProps} />;
  if (route === "poll") return <PollPage polls={polls} onNavigate={navigate} {...attendeeProps} />;
  if (route === "results") return <ResultsPage polls={polls} onNavigate={navigate} {...attendeeProps} />;

  // ---- Staff (private) ----
  if (auth.loading) return <main><p className="empty" role="status">Checking sign-in…</p></main>;

  if (loginRole) {
    if (auth.user?.role === loginRole) return null; // Redirecting.
    return (
      <LoginPage
        portal={loginRole}
        notice={auth.user ? `You are signed in as ${auth.user.username}, who cannot use this area.` : ""}
        onLogin={async (u, p, portal) => {
          await auth.login(u, p, portal);
          navigate(portal, { replace: true });
        }}
        {...themeProps}
      />
    );
  }

  if (!auth.user || auth.user.role !== guard.role) return null; // Redirecting to login.

  if (auth.user.mustChange) {
    return <ChangePasswordPage user={auth.user} onChange={auth.changePassword} onLogout={logout} />;
  }

  if (route === "usher") return <UsherRoute user={auth.user} onLogout={logout} {...themeProps} />;
  return <AdminPage user={auth.user} onLogout={logout} {...themeProps} />;
}
