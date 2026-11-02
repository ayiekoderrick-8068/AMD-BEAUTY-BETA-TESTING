// Recovery for a lost admin password: `npm run reset-admin [username]`.
// Sets a new temporary password (written to the credentials file, not printed) and signs the account out everywhere.
import { appendFileSync } from "node:fs";
import { db } from "./db.js";
import { hashPassword, generateTempPassword, destroyUserSessions } from "./auth.js";
import { CREDENTIALS_FILE } from "./seed.js";

const username = process.argv[2] ?? "amd.admin";
const user = db.prepare("SELECT id FROM users WHERE username = ? AND role = 'admin'").get(username);
if (!user) {
  console.error(`No admin account named "${username}".`);
  process.exit(1);
}
const password = generateTempPassword();
db.prepare("UPDATE users SET password_hash = ?, must_change = 1, active = 1 WHERE id = ?").run(hashPassword(password), user.id);
destroyUserSessions(user.id);
appendFileSync(CREDENTIALS_FILE, `\nadmin  username: ${username}   temporary password: ${password}   (reset ${new Date().toISOString()})\n`, { mode: 0o600 });
console.log(`Password reset for ${username}. The temporary password is at the end of ${CREDENTIALS_FILE}`);
