// Guest invitation links: random tokens, looked up by SHA-256 hash.
// The raw token is also kept encrypted (AES-256-GCM) so an admin can copy the same link again;
// it is never stored in plain text.
import { randomBytes, createHash, createHmac, createCipheriv, createDecipheriv } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { db, DATA_DIR, getEvent } from "./db.js";

const KEY_FILE = `${DATA_DIR}/invite.key`;

// INVITE_KEY (base64, 32 bytes) wins; otherwise a key is created once next to the database.
function loadKey() {
  if (process.env.INVITE_KEY) {
    const key = Buffer.from(process.env.INVITE_KEY, "base64");
    if (key.length !== 32) throw new Error("INVITE_KEY must be 32 bytes, base64-encoded.");
    return key;
  }
  if (!existsSync(KEY_FILE)) writeFileSync(KEY_FILE, randomBytes(32).toString("base64"), { mode: 0o600 });
  return Buffer.from(readFileSync(KEY_FILE, "utf8").trim(), "base64");
}
const KEY = loadKey();

// Ballots are keyed by this, not by the guest id: one stable value per guest (so a guest can vote once),
// but nothing stored with a vote names the guest unless you also hold the server key.
export const voterId = (guestId) => createHmac("sha256", KEY).update(`voter:${guestId}`).digest("hex").slice(0, 32);

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const hashToken = (token) => createHash("sha256").update(token).digest("hex");

function encrypt(text) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

function decrypt(stored) {
  try {
    const [iv, tag, data] = stored.split(".").map((s) => Buffer.from(s, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null; // Wrong key (e.g. INVITE_KEY changed): the admin can regenerate the link.
  }
}

// Creates or replaces the guest's link. The old token stops working immediately.
export function issueInvitation(guestId) {
  const token = randomBytes(32).toString("base64url");
  db.prepare(
    `INSERT INTO invitations (guest_id, token_hash, token_enc) VALUES (?, ?, ?)
     ON CONFLICT(guest_id) DO UPDATE SET token_hash = excluded.token_hash, token_enc = excluded.token_enc,
       created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), revoked_at = NULL`
  ).run(guestId, hashToken(token), encrypt(token));
  return token;
}

export function revokeInvitation(guestId) {
  return db.prepare("UPDATE invitations SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE guest_id = ? AND revoked_at IS NULL")
    .run(guestId).changes;
}

// Guests created before invitations existed get one on startup.
export function backfillInvitations() {
  const missing = db.prepare("SELECT g.id FROM guests g LEFT JOIN invitations i ON i.guest_id = g.id WHERE i.guest_id IS NULL").all();
  for (const { id } of missing) issueInvitation(id);
  return missing.length;
}

export function invitationStatus(row, event = getEvent()) {
  if (!row) return "none";
  if (row.revoked_at) return "revoked";
  if (event.expiresAt && Date.parse(event.expiresAt) < Date.now()) return "expired";
  return "active";
}

// Admin view of one guest's invitation, including the shareable URL.
export function invitationFor(guestId, baseUrl, event = getEvent()) {
  const row = db.prepare("SELECT * FROM invitations WHERE guest_id = ?").get(guestId);
  const status = invitationStatus(row, event);
  const token = row && status !== "revoked" ? decrypt(row.token_enc) : null;
  return {
    status,
    url: token ? `${baseUrl}/invite/${token}` : null,
    createdAt: row?.created_at ?? null,
    revokedAt: row?.revoked_at ?? null,
  };
}

// Public lookup. Returns the row and its status, or null for an unknown token.
export function findInvitation(token) {
  if (!TOKEN_RE.test(token)) return null;
  const row = db.prepare("SELECT * FROM invitations WHERE token_hash = ?").get(hashToken(token));
  return row ? { row, status: invitationStatus(row) } : null;
}
