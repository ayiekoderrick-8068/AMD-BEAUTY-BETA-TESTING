import { test, expect } from "@playwright/test";
import { guests, checkIn, openPollFromInvitation } from "./helpers.js";

const answers = { q1: "Toast", q2: "Moisturizing", q3: "Definitely" };

test.describe("poll access and voting", () => {
  test("a visitor without an invitation cannot vote, in the page or through the API", async ({ page }) => {
    await page.goto("/poll");
    await expect(page.getByRole("heading", { name: "Open your invitation to vote" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Next Question|Submit/ })).toHaveCount(0);
    const res = await page.request.post("/api/poll/vote", { data: { answers } });
    expect(res.status()).toBe(403);
  });

  test("a guest who is not checked in waits, and the poll unlocks by itself once an usher checks them in", async ({ page }) => {
    const guest = guests().waiting;
    await openPollFromInvitation(page, guest);
    await expect(page.getByRole("heading", { name: "Check in to unlock the poll" })).toBeVisible();
    expect((await page.request.post("/api/poll/vote", { data: { answers } })).status()).toBe(403);

    await checkIn(guest.id); // the usher at the door, in the background
    await expect(page.getByText("Which shade is your favourite?")).toBeVisible(); // no reload
  });

  test("a checked-in guest votes through a labelled progress bar, and cannot vote twice", async ({ page, browser }) => {
    const guest = guests().voter;
    await checkIn(guest.id);
    await openPollFromInvitation(page, guest);

    const progress = page.getByRole("progressbar");
    for (const [n, label] of [[1, "Toast"], [2, "Moisturizing"], [3, "Definitely"]]) {
      await expect(progress).toHaveAttribute("aria-label", `Question ${n} of 3`);
      await expect(progress).toHaveAttribute("aria-valuenow", String(n));
      await expect(progress).toHaveAttribute("aria-valuemax", "3");
      await page.locator("label.option", { hasText: label }).click();
      await page.getByRole("button", { name: n === 3 ? "Review answers" : "Next Question" }).click();
    }
    await expect(progress).toHaveAttribute("aria-label", "Review your answers");
    await page.getByRole("button", { name: /Submit Vote/ }).click();
    await expect(page.getByRole("heading", { name: "Thank You!" })).toBeVisible();

    // Still thanked after a reload, and the server refuses a second ballot from the same guest.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Thank You!" })).toBeVisible();
    expect((await page.request.post("/api/poll/vote", { data: { answers } })).status()).toBe(409);

    // The same guest on a second device (same link) is also thanked, and also refused.
    const phone2 = await browser.newContext();
    const page2 = await phone2.newPage();
    await page2.goto(`/invite/${guest.token}`);
    await expect(page2.getByRole("heading", { name: `Hello, ${guest.name}` })).toBeVisible();
    expect((await page2.request.post("/api/poll/vote", { data: { answers } })).status()).toBe(409);
    await phone2.close();

    // A stranger's device with no invitation cannot vote at all.
    const stranger = await browser.newContext();
    expect((await stranger.request.post("/api/poll/vote", { data: { answers } })).status()).toBe(403);
    await stranger.close();

    // Results are visible and count exactly one voter.
    await page.getByRole("button", { name: /View Live Results/ }).click();
    await expect(page.getByRole("heading", { name: "What everyone thinks" })).toBeVisible();
    await expect(page.getByText(/1 person has voted/)).toBeVisible();
  });
});
