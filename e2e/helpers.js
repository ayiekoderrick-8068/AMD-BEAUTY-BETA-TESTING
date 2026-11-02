import { readFileSync } from "node:fs";
import { expect, request } from "@playwright/test";
import { BASE_URL, PASSWORDS, STATE_FILE, USERNAMES } from "./env.js";

export const guests = () => JSON.parse(readFileSync(STATE_FILE, "utf8")).guests;

// An API client signed in as staff, for setting things up or acting as the usher in the background.
export async function staffApi(role) {
  const api = await request.newContext({ baseURL: BASE_URL });
  const res = await api.post("/api/auth/login", { data: { username: USERNAMES[role], password: PASSWORDS[role], portal: role } });
  expect(res.ok()).toBeTruthy();
  return api;
}

export async function checkIn(guestId) {
  const usher = await staffApi("usher");
  const res = await usher.post("/api/checkin", { data: { guestId } });
  expect((await res.json()).status).toMatch(/ok|already/);
  await usher.dispose();
}

// Sign in through the real login form.
export async function signIn(page, role) {
  await page.goto(role === "admin" ? "/admin/login" : "/staff/login");
  await page.getByLabel("Username").fill(USERNAMES[role]);
  await page.getByLabel("Password").fill(PASSWORDS[role]);
  await page.getByRole("button", { name: "Sign in" }).click();
}

// Open a guest's invitation link, as they would from WhatsApp, then walk to the poll through the app.
export async function openPollFromInvitation(page, guest) {
  await page.goto(`/invite/${guest.token}`);
  await expect(page.getByRole("heading", { name: `Hello, ${guest.name}` })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Continue to Live Poll/ }).click();
}
