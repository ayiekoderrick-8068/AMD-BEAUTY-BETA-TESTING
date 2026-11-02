// Password hashing (scrypt), server-side sessions and login rate limiting.
import { scryptSync, randomBytes, timingSafeEqual, createHash, randomInt } from "node:crypto";
import { db } from "./db.js";

const SESSION_HOURS = 8;
export const SESSION_COOKIE = "amd_session";

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(expected, actual);
}

// Verified against when a username does not exist, so unknown and known usernames take equally long.
export const DUMMY_HASH = hashPassword(randomBytes(16).toString("hex"));

// Temporary passwords avoid look-alike characters so they can be read out loud.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
export function generateTempPassword(length = 16) {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export function passwordProblem(password, username) {
  if (typeof password !== "string" || password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "Password is too long.";
  if (username && password.toLowerCase().includes(String(username).toLowerCase())) {
    return "Password must not contain your username.";
  }
  return null;
}

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export function createSession(userId) {
  const token = randomBytes(32).toString("base64url");
  const expires = Date.now() + SESSION_HOURS * 3600 * 1000;
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(sha256(token), userId, expires);
  return { token, maxAge: SESSION_HOURS * 3600 };
}

// Looked up on every request, so deactivation and password resets take effect immediately.
export function userFromToken(token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.role, u.must_change, u.active, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`
    )
    .get(sha256(token));
  if (!row) return null;
  if (row.expires_at < Date.now() || !row.active) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
    return null;
  }
  return { id: row.id, username: row.username, role: row.role, mustChange: !!row.must_change };
}

export function destroySession(token) {
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

export function destroyUserSessions(userId, exceptToken) {
  if (exceptToken) {
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(userId, sha256(exceptToken));
  } else {
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }
}

// In-memory login rate limit: 5 failures per username+IP and 20 per IP in 15 minutes.
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map();

function hits(key) {
  const now = Date.now();
  const list = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length) failures.set(key, list);
  else failures.delete(key);
  return list;
}

// Drop keys whose failures have all aged out, so the map cannot grow without bound.
setInterval(() => { for (const key of [...failures.keys()]) hits(key); }, WINDOW_MS).unref();

export function isRateLimited(ip, username) {
  return hits(`u:${ip}:${String(username).toLowerCase()}`).length >= 5 || hits(`ip:${ip}`).length >= 20;
}

export function recordFailure(ip, username) {
  for (const key of [`u:${ip}:${String(username).toLowerCase()}`, `ip:${ip}`]) {
    failures.set(key, [...hits(key), Date.now()]);
  }
}

export function clearFailures(ip, username) {
  failures.delete(`u:${ip}:${String(username).toLowerCase()}`);
}
