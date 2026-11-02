import { test, expect } from "@playwright/test";
import { guests, signIn } from "./helpers.js";

test.describe("usher", () => {
  test("checks a guest in by code, and a second check-in is caught", async ({ page }) => {
    const guest = guests().door;
    await signIn(page, "usher");
    await expect(page.getByRole("heading", { level: 1, name: "Guest check-in" })).toBeVisible();
    await expect(page.locator("main")).toHaveCount(1);

    await page.getByLabel("Check-in code").fill(guest.code.toLowerCase());
    await page.getByRole("button", { name: "Go" }).click();
    await expect(page.getByText(`Invitation confirmed. Welcome, ${guest.name}!`)).toBeVisible();

    await page.getByLabel("Check-in code").fill(guest.code);
    await page.getByRole("button", { name: "Go" }).click();
    await expect(page.getByText(`${guest.name} already checked in at`)).toBeVisible();

    await page.getByLabel("Check-in code").fill("AMD-NOPE00");
    await page.getByRole("button", { name: "Go" }).click();
    await expect(page.getByText("Code not found")).toBeVisible();
  });

  test("cannot open the admin area", async ({ page }) => {
    await signIn(page, "usher");
    await expect(page.getByRole("heading", { level: 1, name: "Guest check-in" })).toBeVisible();
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(page.getByText(/who cannot use this area/)).toBeVisible();
  });
});

test.describe("admin", () => {
  test("moves between Overview, Guests and Ushers, and signs out", async ({ page }) => {
    await signIn(page, "admin");
    await expect(page.getByRole("heading", { level: 1, name: "Event overview" })).toBeVisible();
    await expect(page.locator("main")).toHaveCount(1);

    const poll = page.getByRole("switch", { name: "Poll open" });
    await expect(poll).toHaveAttribute("aria-checked", "true");
    await poll.click();
    await expect(poll).toHaveAttribute("aria-checked", "false");
    await poll.click();
    await expect(poll).toHaveAttribute("aria-checked", "true");

    await page.getByRole("button", { name: "Guests" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Guest list" })).toBeVisible();
    await expect(page.getByText("E2E Voter", { exact: true })).toBeVisible();
    await expect(page.getByText("Invite active").first()).toBeVisible();

    await page.getByRole("button", { name: "Ushers" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Usher accounts" })).toBeVisible();
    await expect(page.getByRole("main").getByText("amd.usher01", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Overview" }).click();
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/admin\/login$/); // an admin signs out to the admin sign-in page
  });
});
