// End-to-end API tests against a throwaway database. Run: npm test
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "launchpad-test-"));
process.env.DATA_DIR = dataDir;
process.env.PORT = "3999";
const { server } = await import("../index.js");
await new Promise((r) => (server.listening ? r() : server.once("listening", r)));
const BASE = "http://localhost:3999";

after(() => {
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

// A tiny client with its own cookie jar (one per "device").
function client() {
  const jar = {};
  return async (method, path, body, headers = {}) => {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      jar[kv.slice(0, i)] = kv.slice(i + 1);
    }
    return { status: res.status, body: await res.json() };
  };
}

const creds = readFileSync(join(dataDir, "dev-credentials.txt"), "utf8");
const tempPw = (user) => creds.match(new RegExp(`username: ${user.replace(".", "\\.")}\\s+temporary password: (\\S+)`))[1];
const ADMIN_PW = "Admin-Strong-Pass-2026";
const USHER_PW = "Usher-Strong-Pass-2026";

const admin = client();
const usher = client();
const answers = { q1: "Toast", q2: "Moisturizing", q3: "Definitely" };

test("unauthenticated visitors cannot use staff APIs", async () => {
  const anon = client();
  assert.equal((await anon("GET", "/api/guests")).status, 401);
  assert.equal((await anon("GET", "/api/admin/ushers")).status, 401);
  assert.equal((await anon("POST", "/api/checkin", { code: "AMD-1001" })).status, 401);
  assert.deepEqual((await anon("GET", "/api/auth/me")).body, { user: null });
});

test("admin cannot log in through the usher portal, and vice versa", async () => {
  const c = client();
  assert.equal((await c("POST", "/api/auth/login", { username: "amd.admin", password: tempPw("amd.admin"), portal: "usher" })).status, 401);
  assert.equal((await c("POST", "/api/auth/login", { username: "amd.usher01", password: tempPw("amd.usher01"), portal: "admin" })).status, 401);
});

test("admin first login requires a password change", async () => {
  const login = await admin("POST", "/api/auth/login", { username: "amd.admin", password: tempPw("amd.admin"), portal: "admin" });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.mustChange, true);
  const blocked = await admin("GET", "/api/admin/ushers");
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error, "password_change_required");
  assert.equal((await admin("POST", "/api/auth/change-password", { currentPassword: tempPw("amd.admin"), newPassword: "short" })).status, 400);
  assert.equal((await admin("POST", "/api/auth/change-password", { currentPassword: "wrong", newPassword: ADMIN_PW })).status, 400);
  const changed = await admin("POST", "/api/auth/change-password", { currentPassword: tempPw("amd.admin"), newPassword: ADMIN_PW });
  assert.equal(changed.status, 200);
  assert.equal((await admin("GET", "/api/admin/ushers")).status, 200);
});

test("usher logs in, changes password, and is blocked from admin APIs", async () => {
  await usher("POST", "/api/auth/login", { username: "amd.usher01", password: tempPw("amd.usher01"), portal: "usher" });
  await usher("POST", "/api/auth/change-password", { currentPassword: tempPw("amd.usher01"), newPassword: USHER_PW });
  assert.equal((await usher("GET", "/api/guests")).status, 200);
  assert.equal((await usher("POST", "/api/admin/guests", { name: "Sneaky" })).status, 403);
  assert.equal((await usher("PUT", "/api/admin/guests/1", { name: "Sneaky" })).status, 403);
  assert.equal((await usher("DELETE", "/api/admin/guests/1")).status, 403);
  assert.equal((await usher("GET", "/api/admin/ushers")).status, 403);
  assert.equal((await usher("POST", "/api/admin/ushers", { username: "x.y" })).status, 403);
  assert.equal((await usher("PUT", "/api/admin/settings", { pollOpen: false })).status, 403);
  assert.equal((await usher("GET", "/api/admin/overview")).status, 403);
});

test("admin adds and edits a guest with a generated code; usher checks in once", async () => {
  const add = await admin("POST", "/api/admin/guests", { name: "Wanjiku Test", organization: "QA", ticketType: "VIP" });
  assert.equal(add.status, 200);
  assert.match(add.body.guest.code, /^AMD-[A-Z2-9]{6}$/);
  const id = add.body.guest.id;
  assert.equal((await admin("POST", "/api/admin/guests", { name: "  " })).status, 400);
  const edit = await admin("PUT", `/api/admin/guests/${id}`, { name: "Wanjiku Tested", organization: "QA", ticketType: "Press" });
  assert.equal(edit.body.guest.ticketType, "Press");

  const first = await usher("POST", "/api/checkin", { code: add.body.guest.code.toLowerCase() });
  assert.equal(first.body.status, "ok");
  // A second device (the admin's session) sees the duplicate.
  const again = await admin("POST", "/api/checkin", { guestId: id });
  assert.equal(again.body.status, "already");
  assert.ok(again.body.time);
  assert.equal((await usher("POST", "/api/checkin", { code: "NOPE-0000" })).body.status, "not_found");

  const list = await usher("GET", "/api/guests");
  assert.ok(list.body.guests.find((g) => g.id === id).checkedInAt);
  assert.equal(list.body.checkedIn, 1);

  assert.equal((await admin("DELETE", `/api/admin/guests/${id}`)).status, 200);
  assert.equal((await usher("GET", "/api/guests")).body.checkedIn, 0);
});

test("duplicate guests are rejected, and a mistaken check-in can be undone by an admin", async () => {
  const g = (await admin("POST", "/api/admin/guests", { name: "Dup Test", organization: "Org", phone: "+254 700 111222" })).body.guest;
  assert.equal((await admin("POST", "/api/admin/guests", { name: "dup test", organization: "ORG" })).status, 409);
  assert.equal((await admin("POST", "/api/admin/guests", { name: "Someone Else", phone: "254700111222" })).status, 409);
  // Saving a guest without changing it is not a duplicate of itself.
  assert.equal((await admin("PUT", `/api/admin/guests/${g.id}`, { name: "Dup Test", organization: "Org", phone: "+254700111222" })).status, 200);

  assert.equal((await admin("POST", "/api/checkin", { guestId: g.id })).body.status, "ok");
  assert.equal((await usher("DELETE", `/api/admin/guests/${g.id}/checkin`)).status, 403);
  assert.equal((await admin("DELETE", `/api/admin/guests/${g.id}/checkin`)).body.guest.checkedInAt, null);
  assert.equal((await admin("POST", "/api/checkin", { guestId: g.id })).body.status, "ok");
  await admin("DELETE", `/api/admin/guests/${g.id}`);
});

test("malformed cookies and URLs do not crash the server", async () => {
  const bad = await fetch(`${BASE}/api/poll`, { headers: { cookie: "amd_aid=%; amd_session=%E0%A4%A" } });
  assert.equal(bad.status, 200);
  assert.ok([200, 404].includes((await fetch(`${BASE}/%`)).status)); // app shell or "run build"; never a crash
  assert.equal((await fetch(`${BASE}/api/poll`)).status, 200);
});

test("invitation links: unique, read-only, regenerate, revoke, expiry and admin-only", async () => {
  const tokenOf = (url) => url.split("/invite/")[1];
  const a1 = (await admin("POST", "/api/admin/guests", { name: "Amina Invite", organization: "Secret Org", phone: "+254 712 345678" })).body.guest;
  const a2 = (await admin("POST", "/api/admin/guests", { name: "Brian Invite" })).body.guest;
  assert.equal(a1.invitation.status, "active");
  assert.match(a1.invitation.url, /^http:\/\/localhost:3999\/invite\/[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a1.invitation.url, a2.invitation.url);
  assert.equal(a1.phone, "254712345678");
  assert.equal((await admin("POST", "/api/admin/guests", { name: "Bad Phone", phone: "12ab" })).status, 400);
  // Seeded guests got links on startup; links are stable across reads.
  const list1 = (await admin("GET", "/api/admin/guests")).body.guests;
  assert.ok(list1.every((g) => g.invitation.status === "active" && g.invitation.url));
  const list2 = (await admin("GET", "/api/admin/guests")).body.guests;
  assert.deepEqual(list1.map((g) => g.invitation.url), list2.map((g) => g.invitation.url));

  // Opening the link: only name, code and configured event details. Never checks in.
  const anon = client();
  const open = await anon("GET", `/api/invite/${tokenOf(a1.invitation.url)}`);
  assert.equal(open.status, 200);
  assert.deepEqual(open.body, { guest: { name: "Amina Invite" }, code: a1.code, event: { when: "", venue: "" } });
  const afterOpen = (await usher("GET", "/api/guests")).body.guests.find((g) => g.id === a1.id);
  assert.equal(afterOpen.checkedInAt, null);
  assert.equal(afterOpen.url, undefined);
  assert.equal(afterOpen.phone, undefined);
  assert.equal((await anon("GET", "/api/invite/not-a-real-token")).status, 404);
  assert.equal((await anon("GET", `/api/invite/${"x".repeat(43)}`)).status, 404);

  // Ushers cannot see or manage invitations.
  assert.equal((await usher("GET", "/api/admin/guests")).status, 403);
  assert.equal((await usher("POST", `/api/admin/guests/${a1.id}/invitation`)).status, 403);
  assert.equal((await usher("DELETE", `/api/admin/guests/${a1.id}/invitation`)).status, 403);
  assert.equal((await usher("PUT", "/api/admin/event", { when: "x" })).status, 403);
  assert.equal((await anon("GET", "/api/admin/guests")).status, 401);

  // Regenerating invalidates the previous link.
  const regen = (await admin("POST", `/api/admin/guests/${a1.id}/invitation`)).body.guest;
  assert.notEqual(regen.invitation.url, a1.invitation.url);
  assert.equal((await anon("GET", `/api/invite/${tokenOf(a1.invitation.url)}`)).status, 404);
  assert.equal((await anon("GET", `/api/invite/${tokenOf(regen.invitation.url)}`)).status, 200);

  // Revoking: link gone, door refuses; restoring issues a fresh link.
  const revoked = (await admin("DELETE", `/api/admin/guests/${a1.id}/invitation`)).body.guest;
  assert.equal(revoked.invitation.status, "revoked");
  assert.equal(revoked.invitation.url, null);
  assert.equal((await anon("GET", `/api/invite/${tokenOf(regen.invitation.url)}`)).status, 410);
  assert.equal((await usher("POST", "/api/checkin", { code: a1.code })).body.status, "revoked");
  assert.equal((await usher("GET", "/api/guests")).body.guests.find((g) => g.id === a1.id).invitation, "revoked");
  const restored = (await admin("POST", `/api/admin/guests/${a1.id}/invitation`)).body.guest;
  assert.equal(restored.invitation.status, "active");
  assert.equal((await anon("GET", `/api/invite/${tokenOf(regen.invitation.url)}`)).status, 404);

  // Event details appear only once configured; expiry closes links but not the door.
  await admin("PUT", "/api/admin/event", { when: "Sat 15 Nov, 6 PM", venue: "Glow Hall" });
  assert.deepEqual((await anon("GET", `/api/invite/${tokenOf(restored.invitation.url)}`)).body.event, { when: "Sat 15 Nov, 6 PM", venue: "Glow Hall" });
  await admin("PUT", "/api/admin/event", { when: "Sat 15 Nov, 6 PM", venue: "Glow Hall", expiresAt: "2020-01-01T00:00:00Z" });
  const expired = await anon("GET", `/api/invite/${tokenOf(restored.invitation.url)}`);
  assert.equal(expired.status, 410);
  assert.equal(expired.body.error, "This invitation has expired.");
  assert.equal((await admin("GET", "/api/admin/guests")).body.guests.find((g) => g.id === a1.id).invitation.status, "expired");
  assert.equal((await usher("POST", "/api/checkin", { code: a1.code })).body.status, "ok");
  await admin("PUT", "/api/admin/event", { when: "", venue: "", expiresAt: null });
  assert.equal((await anon("GET", `/api/invite/${tokenOf(restored.invitation.url)}`)).status, 200);

  // Deleting a guest removes their invitation.
  await admin("DELETE", `/api/admin/guests/${a2.id}`);
  assert.equal((await anon("GET", `/api/invite/${tokenOf(a2.invitation.url)}`)).status, 404);
  await admin("DELETE", `/api/admin/guests/${a1.id}`);
});

test("WhatsApp link carries the personalised, encoded message and is never auto-sent", async () => {
  const { invitationMessage, whatsappUrl } = await import("../../src/utils/invite.js");
  const url = "http://localhost:3999/invite/abc_DEF-123";
  const msg = invitationMessage({ name: "Amina Wanjiru" }, url, { when: "", venue: "" });
  assert.match(msg, /^Hello Amina!\n/);
  assert.ok(msg.includes(url));
  assert.ok(!msg.includes("📅") && !msg.includes("📍")); // No invented date or venue.
  assert.ok(invitationMessage({ name: "A" }, url, { when: "Sat 6 PM", venue: "Glow Hall" }).includes("📍 Glow Hall"));

  const direct = new URL(whatsappUrl("254712345678", msg));
  assert.equal(direct.origin + direct.pathname, "https://wa.me/254712345678");
  assert.equal(direct.searchParams.get("text"), msg);
  const picker = new URL(whatsappUrl("", msg));
  assert.equal(picker.pathname, "/");
  assert.equal(picker.searchParams.get("text"), msg);
});

test("admin creates, deactivates and resets an usher; deactivation is immediate", async () => {
  const made = await admin("POST", "/api/admin/ushers", { username: "amd.usher02" });
  assert.equal(made.status, 200);
  assert.ok(made.body.tempPassword.length >= 16);
  assert.equal((await admin("POST", "/api/admin/ushers", { username: "amd.usher02" })).status, 409);
  assert.equal((await admin("POST", "/api/admin/ushers", { username: "bad name!" })).status, 400);

  const u2 = client();
  assert.equal((await u2("POST", "/api/auth/login", { username: "amd.usher02", password: made.body.tempPassword, portal: "usher" })).status, 200);
  await u2("POST", "/api/auth/change-password", { currentPassword: made.body.tempPassword, newPassword: "Usher2-Strong-Pass" });
  assert.equal((await u2("GET", "/api/guests")).status, 200);

  const id = (await admin("GET", "/api/admin/ushers")).body.ushers.find((u) => u.username === "amd.usher02").id;
  await admin("PATCH", `/api/admin/ushers/${id}`, { active: false });
  assert.equal((await u2("GET", "/api/guests")).status, 401);
  assert.equal((await u2("POST", "/api/auth/login", { username: "amd.usher02", password: "Usher2-Strong-Pass", portal: "usher" })).status, 401);

  await admin("PATCH", `/api/admin/ushers/${id}`, { active: true });
  const reset = await admin("POST", `/api/admin/ushers/${id}/reset-password`);
  assert.equal((await u2("POST", "/api/auth/login", { username: "amd.usher02", password: "Usher2-Strong-Pass", portal: "usher" })).status, 401);
  const relog = await u2("POST", "/api/auth/login", { username: "amd.usher02", password: reset.body.tempPassword, portal: "usher" });
  assert.equal(relog.body.user.mustChange, true);
});

test("attendee votes once; validation, visibility and closing are enforced", async () => {
  const a = client();
  // A fresh database starts with the poll closed and results hidden.
  assert.equal((await a("GET", "/api/poll")).body.open, false);
  assert.equal((await a("POST", "/api/poll/vote", { answers })).status, 409);
  assert.equal((await a("GET", "/api/poll/results")).status, 403);
  await admin("PUT", "/api/admin/settings", { pollOpen: true, resultsVisible: true });
  assert.equal((await a("GET", "/api/poll")).body.submitted, false);
  assert.equal((await a("POST", "/api/poll/vote", { answers: { ...answers, q2: "Natural ingredients" } })).status, 400);
  assert.equal((await a("POST", "/api/poll/vote", { answers: { q1: "Toast" } })).status, 400);
  assert.equal((await a("POST", "/api/poll/vote", { answers })).status, 200);
  assert.equal((await a("POST", "/api/poll/vote", { answers })).status, 409);
  assert.equal((await a("GET", "/api/poll")).body.submitted, true);

  const r = await a("GET", "/api/poll/results");
  assert.equal(r.body.votes.q1.Toast, 1);
  assert.equal(r.body.voters, 1);

  await admin("PUT", "/api/admin/settings", { resultsVisible: false });
  assert.equal((await a("GET", "/api/poll/results")).status, 403);
  assert.equal((await admin("GET", "/api/poll/results")).status, 200);
  await admin("PUT", "/api/admin/settings", { resultsVisible: true, pollOpen: false });
  const b = client();
  assert.equal((await b("POST", "/api/poll/vote", { answers })).status, 409);
  await admin("PUT", "/api/admin/settings", { pollOpen: true });
  assert.equal((await b("POST", "/api/poll/vote", { answers })).status, 200);
  assert.equal((await admin("GET", "/api/admin/overview")).body.voters, 2);
});

test("cross-site requests are rejected", async () => {
  const res = await admin("PUT", "/api/admin/settings", { pollOpen: false }, { origin: "https://evil.example" });
  assert.equal(res.status, 403);
  assert.equal((await admin("GET", "/api/admin/overview")).body.settings.pollOpen, true);
  // The app's own pages (same origin) must still work.
  const same = await admin("PUT", "/api/admin/settings", { pollOpen: true }, { origin: BASE });
  assert.equal(same.status, 200);
});

test("logout ends the session", async () => {
  await usher("POST", "/api/auth/logout");
  assert.deepEqual((await usher("GET", "/api/auth/me")).body, { user: null });
  assert.equal((await usher("GET", "/api/guests")).status, 401);
});

test("login is rate limited after repeated failures", async () => {
  const c = client();
  for (let i = 0; i < 5; i++) {
    assert.equal((await c("POST", "/api/auth/login", { username: "amd.usher01", password: "wrong", portal: "usher" })).status, 401);
  }
  assert.equal((await c("POST", "/api/auth/login", { username: "amd.usher01", password: USHER_PW, portal: "usher" })).status, 429);
});
