// LaunchPad API: built-in node:http, node:sqlite and node:crypto only.
import { createServer } from "node:http";
import { randomInt } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { db, transaction, getSettings, setSetting, getEvent, setEvent } from "./db.js";
import { issueInvitation, revokeInvitation, backfillInvitations, invitationFor, findInvitation, voterId } from "./invites.js";
import {
  SESSION_COOKIE, hashPassword, verifyPassword, generateTempPassword, passwordProblem,
  DUMMY_HASH, createSession, userFromToken, destroySession, destroyUserSessions,
  isRateLimited, recordFailure, clearFailures,
} from "./auth.js";
import { seed, CREDENTIALS_FILE } from "./seed.js";
import { polls } from "../src/data/polls.js";

const PORT = Number(process.env.PORT ?? 3001);
const PROD = process.env.NODE_ENV === "production";
// Set when a guest opens their invitation link; it is how the poll knows which guest is voting.
const INVITE_COOKIE = "amd_invite";
const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");

// ---------- helpers ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    let value = part.slice(i + 1).trim();
    try { value = decodeURIComponent(value); } catch { /* malformed escape: keep the raw value, it will simply not match */ }
    out[part.slice(0, i).trim()] = value;
  }
  return out;
}

function cookie(name, value, { maxAge, sameSite = "Strict" } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=${sameSite}`;
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  if (PROD) c += "; Secure";
  return c;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
    throw new HttpError(415, "Expected JSON.");
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 50_000) throw new HttpError(413, "Request too large.");
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}

const str = (v, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");
// Behind a reverse proxy every request arrives from the proxy's address. With TRUST_PROXY=1 the
// last X-Forwarded-For entry (the one the nearest proxy added) is used for rate limiting instead.
function clientIp(req) {
  if (process.env.TRUST_PROXY) {
    const hops = String(req.headers["x-forwarded-for"] ?? "").split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return req.socket.remoteAddress ?? "unknown";
}

// ---------- live updates (Server-Sent Events) ----------
// Events only name what changed; clients refetch through their own authorised endpoints.
const streams = new Set();
function broadcast(topic) {
  for (const res of streams) res.write(`data: ${topic}\n\n`);
}
setInterval(() => { for (const res of streams) res.write(": ping\n\n"); }, 25_000).unref();

// ---------- auth guards ----------
function requireUser(ctx, ...roles) {
  if (!ctx.user) throw new HttpError(401, "Please log in.");
  if (!roles.includes(ctx.user.role)) throw new HttpError(403, "You do not have access to this.");
  if (ctx.user.mustChange) throw new HttpError(403, "password_change_required");
  return ctx.user;
}

// ---------- data mapping ----------
// `invitation` is none / active / revoked. Link expiry only limits opening the link, not entry at the door.
const GUEST_SQL = `SELECT g.id, g.name, g.organization, g.ticket_type AS ticketType, g.code, c.checked_in_at AS checkedInAt,
    CASE WHEN i.guest_id IS NULL THEN 'none' WHEN i.revoked_at IS NOT NULL THEN 'revoked' ELSE 'active' END AS invitation
  FROM guests g LEFT JOIN checkins c ON c.guest_id = g.id LEFT JOIN invitations i ON i.guest_id = g.id`;

// Where invitation links point: PUBLIC_ORIGIN in production, otherwise the host the admin is using.
function baseUrl(req) {
  if (process.env.PUBLIC_ORIGIN) return process.env.PUBLIC_ORIGIN.replace(/\/+$/, "");
  return `${PROD ? "https" : "http"}://${req.headers.host}`;
}

// Admin-only guest view: adds phone and the invitation link.
function adminGuest(id, req, event = getEvent()) {
  const g = db.prepare(`${GUEST_SQL} WHERE g.id = ?`).get(id);
  if (!g) return null;
  const { phone } = db.prepare("SELECT phone FROM guests WHERE id = ?").get(id);
  return { ...g, phone, invitation: invitationFor(id, baseUrl(req), event) };
}

// Same phone number, or same name and organization, is almost certainly the same person entered twice.
function assertNotDuplicate(g, exceptId = 0) {
  const clash = db.prepare(
    `SELECT name FROM guests WHERE id != ? AND ((? != '' AND phone = ?) OR (name = ? COLLATE NOCASE AND organization = ? COLLATE NOCASE)) LIMIT 1`
  ).get(exceptId, g.phone, g.phone, g.name, g.organization);
  if (clash) throw new HttpError(409, `${clash.name} is already on the guest list with the same phone number or name and organization.`);
}

function generateCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = "AMD-";
    for (let i = 0; i < 6; i++) code += alphabet[randomInt(alphabet.length)];
    if (!db.prepare("SELECT 1 FROM guests WHERE code = ?").get(code)) return code;
  }
  throw new HttpError(500, "Could not generate a unique code.");
}

function guestInput(body) {
  const name = str(body.name);
  if (!name) throw new HttpError(400, "Guest name is required.");
  // WhatsApp number in international format, digits only (e.g. 254712345678). Optional.
  const phone = str(body.phone, 32).replace(/[\s().-]/g, "").replace(/^\+/, "");
  if (phone && !/^[1-9]\d{7,14}$/.test(phone)) {
    throw new HttpError(400, "Phone: use the international format with country code, e.g. +254 712 345678.");
  }
  return { name, organization: str(body.organization), ticketType: str(body.ticketType, 40), phone };
}

function eventInput(body) {
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new HttpError(400, "Invalid expiry date.");
  return { when: str(body.when, 120), venue: str(body.venue, 160), expiresAt: expiresAt?.toISOString() ?? null };
}

function results() {
  const rows = db.prepare("SELECT question_id AS q, option AS o, COUNT(*) AS n FROM votes GROUP BY question_id, option").all();
  const votes = {};
  for (const r of rows) (votes[r.q] ??= {})[r.o] = r.n;
  const voters = db.prepare("SELECT COUNT(DISTINCT attendee_id) AS n FROM votes").get().n;
  return { votes, voters };
}

function attendance() {
  const total = db.prepare("SELECT COUNT(*) AS n FROM guests").get().n;
  const checkedIn = db.prepare("SELECT COUNT(*) AS n FROM checkins").get().n;
  return { total, checkedIn };
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  // :token matches an invitation token; every other parameter is a numeric id.
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), k === "token" ? "([A-Za-z0-9_-]{1,100})" : "(\\d+)"))}$`);
  routes.push({ method, re, keys, handler });
};

// Auth
route("GET", "/api/auth/me", (ctx) => ({ user: ctx.user }));

route("POST", "/api/auth/login", async (ctx) => {
  const body = await readJson(ctx.req);
  const username = str(body.username, 64);
  const password = typeof body.password === "string" ? body.password : "";
  const portal = body.portal === "admin" ? "admin" : "usher";
  const ip = clientIp(ctx.req);
  if (isRateLimited(ip, username)) throw new HttpError(429, "Too many attempts. Try again in 15 minutes.");

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  // Unknown usernames still pay for a hash check so response time does not reveal which exist.
  const valid = verifyPassword(password, user?.password_hash ?? DUMMY_HASH) && Boolean(user);
  // Same message for every failure so usernames cannot be probed.
  if (!valid || !user.active || user.role !== portal) {
    recordFailure(ip, username);
    throw new HttpError(401, "Invalid username or password.");
  }
  clearFailures(ip, username);
  db.prepare("UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(user.id);
  const { token, maxAge } = createSession(user.id);
  ctx.setCookie(cookie(SESSION_COOKIE, token, { maxAge }));
  return { user: { id: user.id, username: user.username, role: user.role, mustChange: !!user.must_change } };
});

route("POST", "/api/auth/logout", (ctx) => {
  destroySession(ctx.token);
  ctx.setCookie(cookie(SESSION_COOKIE, "", { maxAge: 0 }));
  return { ok: true };
});

route("POST", "/api/auth/change-password", async (ctx) => {
  if (!ctx.user) throw new HttpError(401, "Please log in.");
  const body = await readJson(ctx.req);
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(ctx.user.id);
  if (!verifyPassword(String(body.currentPassword ?? ""), row.password_hash)) {
    throw new HttpError(400, "Current password is incorrect.");
  }
  const problem = passwordProblem(body.newPassword, ctx.user.username);
  if (problem) throw new HttpError(400, problem);
  if (body.newPassword === body.currentPassword) throw new HttpError(400, "Choose a different password.");
  db.prepare("UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?").run(hashPassword(body.newPassword), ctx.user.id);
  destroyUserSessions(ctx.user.id, ctx.token);
  return { user: { ...ctx.user, mustChange: false } };
});

// Guests + check-in (usher and admin)
route("GET", "/api/guests", (ctx) => {
  requireUser(ctx, "usher", "admin");
  return { guests: db.prepare(`${GUEST_SQL} ORDER BY g.name COLLATE NOCASE`).all(), ...attendance() };
});

route("POST", "/api/checkin", async (ctx) => {
  const user = requireUser(ctx, "usher", "admin");
  const body = await readJson(ctx.req);
  const guest = body.code !== undefined
    ? db.prepare(`${GUEST_SQL} WHERE g.code = ?`).get(str(body.code, 40).toUpperCase())
    : db.prepare(`${GUEST_SQL} WHERE g.id = ?`).get(Number(body.guestId) || 0);
  if (!guest) return { status: "not_found" };
  // A revoked invitation means the guest was uninvited; the door must not let them in.
  if (guest.invitation === "revoked") return { status: "revoked", guest };
  const now = new Date().toISOString();
  // The primary key on guest_id makes this atomic: a second device gets "already".
  const { changes } = db
    .prepare("INSERT OR IGNORE INTO checkins (guest_id, checked_in_at, checked_in_by) VALUES (?, ?, ?)")
    .run(guest.id, now, user.id);
  if (!changes) {
    const time = db.prepare("SELECT checked_in_at AS t FROM checkins WHERE guest_id = ?").get(guest.id).t;
    return { status: "already", guest, time };
  }
  broadcast("checkins");
  return { status: "ok", guest: { ...guest, checkedInAt: now } };
});

// Admin: guests (with phone numbers and invitation links, which ushers never see)
route("GET", "/api/admin/guests", (ctx) => {
  requireUser(ctx, "admin");
  const event = getEvent();
  const ids = db.prepare("SELECT id FROM guests ORDER BY name COLLATE NOCASE").all();
  return { guests: ids.map(({ id }) => adminGuest(id, ctx.req, event)), event, ...attendance() };
});

route("POST", "/api/admin/guests", async (ctx) => {
  requireUser(ctx, "admin");
  const g = guestInput(await readJson(ctx.req));
  assertNotDuplicate(g);
  // Every new guest gets an invitation link straight away.
  const id = transaction(() => {
    const { lastInsertRowid } = db
      .prepare("INSERT INTO guests (name, organization, ticket_type, code, phone) VALUES (?, ?, ?, ?, ?)")
      .run(g.name, g.organization, g.ticketType, generateCode(), g.phone);
    issueInvitation(lastInsertRowid);
    return lastInsertRowid;
  });
  broadcast("guests");
  return { guest: adminGuest(id, ctx.req) };
});

route("PUT", "/api/admin/guests/:id", async (ctx) => {
  requireUser(ctx, "admin");
  const g = guestInput(await readJson(ctx.req));
  assertNotDuplicate(g, ctx.params.id);
  const { changes } = db
    .prepare("UPDATE guests SET name = ?, organization = ?, ticket_type = ?, phone = ? WHERE id = ?")
    .run(g.name, g.organization, g.ticketType, g.phone, ctx.params.id);
  if (!changes) throw new HttpError(404, "Guest not found.");
  broadcast("guests");
  return { guest: adminGuest(ctx.params.id, ctx.req) };
});

route("POST", "/api/admin/guests/:id/code", (ctx) => {
  requireUser(ctx, "admin");
  const { changes } = db.prepare("UPDATE guests SET code = ? WHERE id = ?").run(generateCode(), ctx.params.id);
  if (!changes) throw new HttpError(404, "Guest not found.");
  broadcast("guests");
  return { guest: adminGuest(ctx.params.id, ctx.req) };
});

// Create a new link (also restores a revoked invitation). The previous link stops working.
route("POST", "/api/admin/guests/:id/invitation", (ctx) => {
  requireUser(ctx, "admin");
  if (!db.prepare("SELECT 1 FROM guests WHERE id = ?").get(ctx.params.id)) throw new HttpError(404, "Guest not found.");
  issueInvitation(ctx.params.id);
  broadcast("guests");
  return { guest: adminGuest(ctx.params.id, ctx.req) };
});

route("DELETE", "/api/admin/guests/:id/invitation", (ctx) => {
  requireUser(ctx, "admin");
  if (!db.prepare("SELECT 1 FROM guests WHERE id = ?").get(ctx.params.id)) throw new HttpError(404, "Guest not found.");
  revokeInvitation(ctx.params.id);
  broadcast("guests");
  return { guest: adminGuest(ctx.params.id, ctx.req) };
});

// Undo a mistaken check-in so the guest can be checked in again.
route("DELETE", "/api/admin/guests/:id/checkin", (ctx) => {
  requireUser(ctx, "admin");
  if (!db.prepare("SELECT 1 FROM guests WHERE id = ?").get(ctx.params.id)) throw new HttpError(404, "Guest not found.");
  db.prepare("DELETE FROM checkins WHERE guest_id = ?").run(ctx.params.id);
  broadcast("checkins");
  return { guest: adminGuest(ctx.params.id, ctx.req) };
});

// Admin: optional event details used in invitations (blank = not shown anywhere).
route("PUT", "/api/admin/event", async (ctx) => {
  requireUser(ctx, "admin");
  setEvent(eventInput(await readJson(ctx.req)));
  broadcast("guests");
  return { event: getEvent() };
});

route("DELETE", "/api/admin/guests/:id", (ctx) => {
  requireUser(ctx, "admin");
  const { changes } = db.prepare("DELETE FROM guests WHERE id = ?").run(ctx.params.id);
  if (!changes) throw new HttpError(404, "Guest not found.");
  broadcast("guests");
  return { ok: true };
});

// Admin: ushers
const USHER_SQL = `SELECT id, username, active, must_change AS mustChange, created_at AS createdAt, last_login_at AS lastLoginAt
  FROM users WHERE role = 'usher'`;

route("GET", "/api/admin/ushers", (ctx) => {
  requireUser(ctx, "admin");
  return { ushers: db.prepare(`${USHER_SQL} ORDER BY username`).all() };
});

route("POST", "/api/admin/ushers", async (ctx) => {
  requireUser(ctx, "admin");
  const body = await readJson(ctx.req);
  const username = str(body.username, 32).toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new HttpError(400, "Username: 3-32 characters, letters, numbers, dot, dash or underscore.");
  }
  if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) throw new HttpError(409, "That username is taken.");
  const tempPassword = generateTempPassword();
  db.prepare("INSERT INTO users (username, role, password_hash, must_change) VALUES (?, 'usher', ?, 1)")
    .run(username, hashPassword(tempPassword));
  // The temporary password is returned once, to the admin who created it, and never stored in plain text.
  return { username, tempPassword };
});

function usherOr404(id) {
  const u = db.prepare(`${USHER_SQL} AND id = ?`).get(id);
  if (!u) throw new HttpError(404, "Usher not found.");
  return u;
}

route("PATCH", "/api/admin/ushers/:id", async (ctx) => {
  requireUser(ctx, "admin");
  const body = await readJson(ctx.req);
  usherOr404(ctx.params.id);
  if (typeof body.active !== "boolean") throw new HttpError(400, "active must be true or false.");
  db.prepare("UPDATE users SET active = ? WHERE id = ?").run(body.active ? 1 : 0, ctx.params.id);
  if (!body.active) destroyUserSessions(ctx.params.id);
  return { usher: usherOr404(ctx.params.id) };
});

route("POST", "/api/admin/ushers/:id/reset-password", (ctx) => {
  requireUser(ctx, "admin");
  const u = usherOr404(ctx.params.id);
  const tempPassword = generateTempPassword();
  db.prepare("UPDATE users SET password_hash = ?, must_change = 1 WHERE id = ?").run(hashPassword(tempPassword), u.id);
  destroyUserSessions(u.id);
  return { username: u.username, tempPassword };
});

// Admin: poll controls
route("PUT", "/api/admin/settings", async (ctx) => {
  requireUser(ctx, "admin");
  const body = await readJson(ctx.req);
  if (body.pollOpen !== undefined) {
    if (typeof body.pollOpen !== "boolean") throw new HttpError(400, "pollOpen must be true or false.");
    setSetting("poll_open", body.pollOpen);
  }
  if (body.resultsVisible !== undefined) {
    if (typeof body.resultsVisible !== "boolean") throw new HttpError(400, "resultsVisible must be true or false.");
    setSetting("results_visible", body.resultsVisible);
  }
  broadcast("poll");
  return getSettings();
});

route("POST", "/api/admin/poll/reset", (ctx) => {
  requireUser(ctx, "admin");
  db.exec("DELETE FROM votes");
  broadcast("poll");
  return { ok: true };
});

route("GET", "/api/admin/overview", (ctx) => {
  requireUser(ctx, "admin");
  return { ...attendance(), ...results(), settings: getSettings() };
});

// Public: open an invitation link. Read-only: it never checks the guest in.
// Only what the invitation card needs is returned (no organization, phone or ids).
route("GET", "/api/invite/:token", (ctx) => {
  const found = findInvitation(ctx.params.token);
  if (!found) throw new HttpError(404, "This invitation link is not valid.");
  if (found.status === "revoked") throw new HttpError(410, "This invitation has been cancelled.");
  if (found.status === "expired") throw new HttpError(410, "This invitation has expired.");
  const guest = db.prepare("SELECT name, code FROM guests WHERE id = ?").get(found.row.guest_id);
  const { when, venue } = getEvent();
  // HttpOnly, so page scripts never see the token; it only unlocks voting once the guest is checked in.
  ctx.setCookie(cookie(INVITE_COOKIE, ctx.params.token, { maxAge: 60 * 60 * 24 * 7 }));
  return { guest: { name: guest.name }, code: guest.code, event: { when, venue } };
});

// Poll: only a guest who is checked in can vote, once. Who is voting comes from the invitation link
// this browser opened (an HttpOnly cookie), never from anything the page sends.
// `access` tells the page why voting is locked: no_invite | revoked | not_checked_in | ok.
function voterAccess(ctx) {
  const found = findInvitation(ctx.cookies[INVITE_COOKIE] ?? "");
  if (!found) return { access: "no_invite" };
  const voter = voterId(found.row.guest_id);
  if (found.status === "revoked") return { access: "revoked", voter };
  if (!db.prepare("SELECT 1 FROM checkins WHERE guest_id = ?").get(found.row.guest_id)) return { access: "not_checked_in", voter };
  return { access: "ok", voter };
}

const VOTE_BLOCKED = {
  no_invite: "Open your invitation link to vote.",
  revoked: "Your invitation was cancelled. Please ask an usher for help.",
  not_checked_in: "Please check in with an usher to unlock the poll.",
};

route("GET", "/api/poll", (ctx) => {
  const { pollOpen, resultsVisible } = getSettings();
  const { access, voter } = voterAccess(ctx);
  const answered = voter ? db.prepare("SELECT COUNT(*) AS n FROM votes WHERE attendee_id = ?").get(voter).n : 0;
  return { open: pollOpen, resultsVisible, access, submitted: answered >= polls.length };
});

route("POST", "/api/poll/vote", async (ctx) => {
  const body = await readJson(ctx.req);
  const { access, voter } = voterAccess(ctx);
  if (access !== "ok") throw new HttpError(403, VOTE_BLOCKED[access]);
  const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
  for (const p of polls) {
    if (!p.options.some((o) => o.label === answers[p.id])) throw new HttpError(400, "Please answer every question.");
  }
  transaction(() => {
    if (!getSettings().pollOpen) throw new HttpError(409, "The poll is closed.");
    if (db.prepare("SELECT 1 FROM votes WHERE attendee_id = ?").get(voter)) {
      throw new HttpError(409, "You have already voted.");
    }
    const insert = db.prepare("INSERT INTO votes (attendee_id, question_id, option) VALUES (?, ?, ?)");
    for (const p of polls) insert.run(voter, p.id, answers[p.id]);
  });
  broadcast("poll");
  return { ok: true };
});

route("GET", "/api/poll/results", (ctx) => {
  const isAdmin = ctx.user?.role === "admin" && !ctx.user.mustChange;
  if (!getSettings().resultsVisible && !isAdmin) throw new HttpError(403, "Results are hidden.");
  return results();
});

// ---------- static files (production build) ----------
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json" };

async function serveStatic(req, res, pathname) {
  let decoded = "/";
  try { decoded = decodeURIComponent(pathname); } catch { /* malformed escape: fall back to the app shell */ }
  let file = resolve(join(DIST, decoded));
  if (file !== DIST && !file.startsWith(DIST + sep)) file = join(DIST, "index.html");
  try {
    if (!(await stat(file)).isFile()) throw new Error();
  } catch {
    file = join(DIST, "index.html"); // SPA fallback for client-side routes.
  }
  try {
    const data = await readFile(file);
    // Vite fingerprints everything under /assets, so it can be cached for good; the app shell must stay fresh.
    const cache = file.startsWith(join(DIST, "assets") + sep) ? "public, max-age=31536000, immutable" : "no-cache";
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "Cache-Control": cache,
      "Content-Security-Policy": CSP,
    });
    res.end(data);
  } catch {
    res.writeHead(404).end("Not found. Run `npm run build` first.");
  }
}

// ---------- server ----------
async function handle(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");

  let url;
  try { url = new URL(req.url, "http://localhost"); } catch { return send(res, 400, { error: "Bad request." }); }
  if (!url.pathname.startsWith("/api/")) return serveStatic(req, res, url.pathname);

  const cookies = parseCookies(req);
  const setCookies = [];
  const ctx = {
    req,
    cookies,
    token: cookies[SESSION_COOKIE],
    user: userFromToken(cookies[SESSION_COOKIE]),
    params: {},
    setCookie: (c) => setCookies.push(c),
  };

  // Cross-site request protection for state-changing calls (on top of SameSite cookies).
  // PUBLIC_ORIGIN can be set when a reverse proxy rewrites the Host header.
  if (req.method !== "GET" && req.headers.origin) {
    let originHost = "";
    try { originHost = new URL(req.headers.origin).host; } catch { /* invalid Origin */ }
    const allowed = originHost === req.headers.host || req.headers.origin === process.env.PUBLIC_ORIGIN;
    if (!allowed) return send(res, 403, { error: "Cross-site request blocked." });
  }

  if (req.method === "GET" && url.pathname === "/api/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write("retry: 3000\n\n");
    streams.add(res);
    req.on("close", () => streams.delete(res));
    return;
  }

  for (const r of routes) {
    const m = r.method === req.method && url.pathname.match(r.re);
    if (!m) continue;
    r.keys.forEach((k, i) => (ctx.params[k] = k === "token" ? m[i + 1] : Number(m[i + 1])));
    try {
      const body = await r.handler(ctx);
      return send(res, 200, body, setCookies.length ? { "Set-Cookie": setCookies } : {});
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      return send(res, status, { error: status === 500 ? "Something went wrong." : err.message },
        setCookies.length ? { "Set-Cookie": setCookies } : {});
    }
  }
  send(res, 404, { error: "Not found." });
}

// Nothing a request does may take the process down.
export const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: "Something went wrong." });
    else res.end();
  });
});

if (seed()) console.log(`Created staff accounts. Temporary passwords are in ${CREDENTIALS_FILE}`);
const backfilled = backfillInvitations();
if (backfilled) console.log(`Created invitation links for ${backfilled} existing guests.`);
server.listen(PORT, () => console.log(`LaunchPad API listening on http://localhost:${PORT}`));
