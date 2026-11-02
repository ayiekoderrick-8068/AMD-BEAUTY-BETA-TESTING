// Creates the first staff accounts and sample guests on an empty database.
// Temporary passwords go to a gitignored local file only, never to the console or the frontend.
import { writeFileSync } from "node:fs";
import { db, DATA_DIR } from "./db.js";
import { hashPassword, generateTempPassword } from "./auth.js";

const SAMPLE_GUESTS = [
  { name: "Amina Wanjiru", organization: "Glow Studio", ticketType: "VIP", code: "AMD-1001" },
  { name: "Brian Otieno", organization: "Nairobi Beauty Hub", ticketType: "General", code: "AMD-1002" },
  { name: "Cynthia Achieng", organization: "Lush Lips Co", ticketType: "Press", code: "AMD-1003" },
  { name: "David Kamau", organization: "", ticketType: "General", code: "AMD-1004" },
  { name: "Grace Wambui", organization: "Velvet Cosmetics", ticketType: "VIP", code: "AMD-1005" },
  { name: "Esther Njeri", organization: "Rose & Co", ticketType: "", code: "AMD-1006" },
  { name: "Faith Mwangi", organization: "Pink Petal", ticketType: "General", code: "AMD-1007" },
  { name: "George Mutua", organization: "Bloom Agency", ticketType: "Influencer", code: "AMD-1008" },
];

export const CREDENTIALS_FILE = `${DATA_DIR}/dev-credentials.txt`;

export function seed() {
  const created = [];
  const hasUsers = db.prepare("SELECT COUNT(*) AS n FROM users").get().n > 0;
  if (!hasUsers) {
    const insert = db.prepare("INSERT INTO users (username, role, password_hash, must_change) VALUES (?, ?, ?, 1)");
    for (const [username, role] of [["amd.admin", "admin"], ["amd.usher01", "usher"]]) {
      const password = generateTempPassword();
      insert.run(username, role, hashPassword(password));
      created.push({ username, role, password });
    }
    const lines = [
      "LaunchPad x AMD Beauty - LOCAL DEVELOPMENT CREDENTIALS",
      "Temporary passwords. Each account must set a new password at first login.",
      "This file is gitignored. Do not share or commit it. Delete it after first login.",
      "",
      ...created.map((c) => `${c.role.padEnd(6)} username: ${c.username}   temporary password: ${c.password}`),
      "",
      "Admin login: /admin/login    Usher login: /staff/login",
      "",
    ];
    writeFileSync(CREDENTIALS_FILE, lines.join("\n"), { mode: 0o600 });
  }

  // Sample guests have guessable codes, so a production database only gets them on request.
  const wantSamples = process.env.NODE_ENV !== "production" || process.env.SEED_SAMPLE_GUESTS === "1";
  const hasGuests = db.prepare("SELECT COUNT(*) AS n FROM guests").get().n > 0;
  if (wantSamples && !hasGuests) {
    const insert = db.prepare("INSERT INTO guests (name, organization, ticket_type, code) VALUES (?, ?, ?, ?)");
    for (const g of SAMPLE_GUESTS) insert.run(g.name, g.organization, g.ticketType, g.code);
  }
  return created.length > 0;
}

// Allow `node server/seed.js` on its own.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const made = seed();
  console.log(made ? `Staff accounts created. Credentials written to ${CREDENTIALS_FILE}` : "Database already seeded.");
}
