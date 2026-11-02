import { defineConfig, devices } from "@playwright/test";
import { rmSync } from "node:fs";
import { BASE_URL, DATA_DIR, PORT } from "./e2e/env.js";

// Workers load this file too; only the runner process may reset the data folder.
if (!process.env.TEST_WORKER_INDEX) rmSync(DATA_DIR, { recursive: true, force: true });

// Runs against the production build served by the real API server (run `npm run build` first,
// or use `npm run test:e2e`, which does).
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.js",
  globalSetup: "./e2e/global-setup.js",
  fullyParallel: false,
  workers: 1, // The specs share one server and one database, so they run in order.
  retries: process.env.CI ? 1 : 0,
  expect: { timeout: 10_000 }, // sign-in hashes passwords on purpose; CI machines are slower than laptops
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: BASE_URL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "phone", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: "node server/index.js",
    env: { DATA_DIR, PORT: String(PORT), NODE_ENV: "test" },
    url: `${BASE_URL}/api/auth/me`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
