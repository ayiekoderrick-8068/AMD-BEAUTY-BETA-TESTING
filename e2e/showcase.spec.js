import { test, expect } from "@playwright/test";

const distinctColumns = async (cards) => {
  const xs = await cards.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().x)));
  return new Set(xs).size;
};

test.describe("product card grid", () => {
  test("shows the four shades as image cards: two columns on a phone, four on desktop", async ({ page }) => {
    await page.goto("/showcase");
    const cards = page.locator(".product-card");
    await expect(cards).toHaveCount(4);
    await expect(page.locator("main")).toHaveCount(1);

    for (const name of ["Raspberry Jelly", "Toast", "Mocha", "Ribbon"]) {
      await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
      await expect(page.getByRole("img", { name: new RegExp(`^${name} `) })).toBeVisible();
      await expect(page.getByRole("button", { name: new RegExp(`View shade: ${name}`) })).toBeVisible();
    }
    expect(await distinctColumns(cards)).toBe(2);

    await page.setViewportSize({ width: 1280, height: 800 });
    expect(await distinctColumns(cards)).toBe(4);
  });

  test("View shade opens the detail page and Back returns to the grid", async ({ page }) => {
    await page.goto("/showcase");
    await page.getByRole("button", { name: /View shade: Mocha/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Mocha" })).toBeVisible();
    await expect(page.getByText("Chocolate brown").first()).toBeVisible();
    await page.getByRole("button", { name: "Back to all shades" }).click();
    await expect(page.locator(".product-card")).toHaveCount(4);
  });

  test("tapping anywhere on a card, not only the button, opens it", async ({ page }) => {
    await page.goto("/showcase");
    await page.locator(".product-card").nth(1).click({ position: { x: 40, y: 60 } });
    await expect(page.getByRole("heading", { level: 1, name: "Toast" })).toBeVisible();
  });
});
