import { expect, test } from "@playwright/test";

const isExpectedConsoleError = (text: string) => text.includes("401 (Unauthorized)");

test.describe("public UI smoke", () => {
  test("login page renders without console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && !isExpectedConsoleError(message.text())) {
        errors.push(message.text());
      }
    });

    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel(/^email$/i)).toBeVisible();
    await expect(page.getByLabel(/^password$/i)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("careers page renders public company content", async ({ page }) => {
    await page.goto("/careers");
    await expect(page.getByRole("heading", { name: /AGI is not born/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /View Open Roles/i })).toBeVisible();
  });

  test("careers page click paths stay responsive and consistent", async ({ page }) => {
    await page.goto("/careers");
    await expect(page.getByRole("heading", { name: /AGI is not born/i })).toBeVisible();

    await page.getByRole("button", { name: /^Jobs$/i }).click();
    await expect(page.locator("#open-roles input[placeholder^='Search roles']")).toBeVisible();

    await page.getByRole("button", { name: /^Teams$/i }).click();
    await expect(page.getByRole("dialog", { name: /Our Teams/i })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /Our Teams/i })).toHaveCount(0);

    await page.getByRole("button", { name: /^Culture$/i }).click();
    await expect(page.getByRole("heading", { name: /Build intelligence systems/i })).toBeVisible();

    await page.getByText("View Location").click();
    await expect(page.getByRole("dialog", { name: /Hiring Location/i })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /Hiring Location/i })).toHaveCount(0);

    await page.getByRole("button", { name: /View Open Roles/i }).click();
    const search = page.locator("#open-roles input[placeholder^='Search roles']");
    await search.fill("zzzz-no-role-match");
    await expect(page.getByText(/No roles match your search/i)).toBeVisible();
    await page.getByRole("button", { name: /Clear filters/i }).click();

    const roleLink = page.getByRole("link", { name: /View Role/i }).first();
    await expect(roleLink).toBeVisible();
    const roleHref = await roleLink.getAttribute("href");
    expect(roleHref).toBeTruthy();
    await roleLink.click();
    await page.waitForURL(/\/careers\//);
    await expect(page.getByRole("heading", { name: /Associate/i })).toBeVisible();

    await page.getByRole("button", { name: /Apply Now/i }).first().click();
    await page.waitForURL(/\/login\?next=/);
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  });
});

test.describe("authenticated UI smoke", () => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  test.skip(!email || !password, "Set E2E_EMAIL and E2E_PASSWORD to run authenticated dashboard checks.");

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(email ?? "");
    await page.getByLabel(/^password$/i).fill(password ?? "");
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/dashboard|portal|candidate/, { timeout: 30_000 });
  });

  for (const route of ["/dashboard/employees", "/dashboard/logs", "/dashboard/contracts", "/dashboard/candidates"]) {
    test(`${route} renders main content`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator("main, body")).toBeVisible();
      await expect(page.getByText(/Loading Ethara HRMS/i)).toHaveCount(0, { timeout: 20_000 });
    });
  }
});
