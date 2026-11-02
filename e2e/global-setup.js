// Runs once after the server is up: gives the staff accounts known passwords, opens the poll,
// and creates the guests the specs use (each spec has its own guest, so they never interfere).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { request } from "@playwright/test";
import { BASE_URL, DATA_DIR, PASSWORDS, STATE_FILE, USERNAMES } from "./env.js";

async function expectOk(res, what) {
  if (!res.ok()) throw new Error(`${what} failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

async function signInStaff(role) {
  const creds = readFileSync(join(DATA_DIR, "dev-credentials.txt"), "utf8");
  const username = USERNAMES[role];
  const temp = creds.match(new RegExp(`username: ${username.replace(".", "\\.")}\\s+temporary password: (\\S+)`))[1];
  const api = await request.newContext({ baseURL: BASE_URL });
  await expectOk(await api.post("/api/auth/login", { data: { username, password: temp, portal: role } }), `${role} login`);
  await expectOk(
    await api.post("/api/auth/change-password", { data: { currentPassword: temp, newPassword: PASSWORDS[role] } }),
    `${role} password change`
  );
  return api;
}

export default async function globalSetup() {
  const admin = await signInStaff("admin");
  const usher = await signInStaff("usher");
  await usher.dispose();

  await expectOk(await admin.put("/api/admin/settings", { data: { pollOpen: true, resultsVisible: true } }), "open poll");

  const guests = {};
  for (const [key, name] of [["voter", "E2E Voter"], ["waiting", "E2E Waiting"], ["door", "E2E Door"]]) {
    const { guest } = await expectOk(await admin.post("/api/admin/guests", { data: { name } }), `add ${name}`);
    guests[key] = { id: guest.id, name, code: guest.code, token: guest.invitation.url.split("/invite/")[1] };
  }
  writeFileSync(STATE_FILE, JSON.stringify({ guests }));
  await admin.dispose();
}
