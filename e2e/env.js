// Shared by the Playwright config, global setup and the specs. No side effects here.
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PORT = 3995;
export const BASE_URL = `http://localhost:${PORT}`;
// A throwaway data folder: the e2e server never touches server/data.
export const DATA_DIR = join(tmpdir(), "launchpad-e2e");
export const STATE_FILE = join(DATA_DIR, "e2e-state.json");

// Passwords the global setup gives the two seeded staff accounts after their forced first change.
export const PASSWORDS = { admin: "E2e-Admin-Pass-2026", usher: "E2e-Usher-Pass-2026" };
export const USERNAMES = { admin: "amd.admin", usher: "amd.usher01" };
