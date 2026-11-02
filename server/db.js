// SQLite database (Node's built-in node:sqlite, no extra dependency).
let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  console.error(`LaunchPad needs Node 22.13 or newer (built-in node:sqlite). You are running ${process.version}.`);
  process.exit(1);
}
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = resolve(process.env.DATA_DIR ?? `${here}/data`);
mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

export const db = new DatabaseSync(process.env.DB_FILE ?? `${DATA_DIR}/launchpad.db`);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'usher')),
    password_hash TEXT NOT NULL,
    must_change INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS guests (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    organization TEXT NOT NULL DEFAULT '',
    ticket_type TEXT NOT NULL DEFAULT '',
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  -- One row per guest: the primary key is what blocks duplicate check-ins across devices.
  CREATE TABLE IF NOT EXISTS checkins (
    guest_id INTEGER PRIMARY KEY REFERENCES guests(id) ON DELETE CASCADE,
    checked_in_at TEXT NOT NULL,
    checked_in_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- One answer per attendee per question.
  CREATE TABLE IF NOT EXISTS votes (
    attendee_id TEXT NOT NULL,
    question_id TEXT NOT NULL,
    option TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (attendee_id, question_id)
  );

  -- One current invitation link per guest. The token is looked up by hash; the encrypted
  -- copy lets an admin copy the same link again. Regenerating replaces both.
  CREATE TABLE IF NOT EXISTS invitations (
    guest_id INTEGER PRIMARY KEY REFERENCES guests(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    token_enc TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    revoked_at TEXT
  );

  INSERT OR IGNORE INTO settings (key, value) VALUES ('poll_open', '0'), ('results_visible', '0');
`);

// Columns added after the first release.
if (!db.prepare("SELECT 1 FROM pragma_table_info('guests') WHERE name = 'phone'").get()) {
  db.exec("ALTER TABLE guests ADD COLUMN phone TEXT NOT NULL DEFAULT ''");
}

// The first release spelled the shade "Rasberry"; votes are stored by label, so carry them over.
db.prepare("UPDATE votes SET option = 'Raspberry Jelly' WHERE question_id = 'q1' AND option = 'Rasberry'").run();

export function transaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function getSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { pollOpen: map.poll_open === "1", resultsVisible: map.results_visible === "1" };
}

export function setSetting(key, on) {
  db.prepare("UPDATE settings SET value = ? WHERE key = ?").run(on ? "1" : "0", key);
}

// Optional event details set by the admin. Blank means "not configured": never invented.
const EVENT_KEYS = { when: "event_when", venue: "event_venue", expiresAt: "invite_expires_at" };

export function getEvent() {
  const get = (k) => db.prepare("SELECT value FROM settings WHERE key = ?").get(k)?.value ?? "";
  return { when: get(EVENT_KEYS.when), venue: get(EVENT_KEYS.venue), expiresAt: get(EVENT_KEYS.expiresAt) || null };
}

export function setEvent({ when, venue, expiresAt }) {
  const put = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  put.run(EVENT_KEYS.when, when);
  put.run(EVENT_KEYS.venue, venue);
  put.run(EVENT_KEYS.expiresAt, expiresAt ?? "");
}
