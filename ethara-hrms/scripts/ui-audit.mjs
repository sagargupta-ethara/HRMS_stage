import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3002";
const outputDir = path.resolve("test-results/ui-audit");
const desktop = { width: 1440, height: 900 };
const mobile = { width: 390, height: 844 };
const publicRoutes = ["/login", "/careers"];
const authenticatedRoutes = ["/dashboard/employees", "/dashboard/logs", "/dashboard/contracts"];

function urlFor(route) {
  return new URL(route, baseURL).toString();
}

function isExpectedConsoleError(text) {
  return text.includes("401 (Unauthorized)");
}

async function waitForRouteReady(page, route) {
  if (route === "/login") {
    await page.getByRole("heading", { name: /sign in/i }).waitFor({ timeout: 20_000 });
  } else if (route === "/careers") {
    await page.getByRole("heading", { name: /AGI is not born/i }).waitFor({ timeout: 20_000 });
  } else {
    await page.locator("main, body").first().waitFor({ timeout: 20_000 });
  }
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(750);
}

async function capture(page, route, viewportName) {
  const safe = route.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-") || "root";
  const file = path.join(outputDir, `${safe}-${viewportName}.png`);
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !isExpectedConsoleError(message.text())) {
      consoleErrors.push(message.text());
    }
  });
  await page.goto(urlFor(route), { waitUntil: "domcontentloaded" });
  await waitForRouteReady(page, route);
  await page.screenshot({ path: file, fullPage: true });
  return { route, viewport: viewportName, file, consoleErrors };
}

async function maybeLogin(page) {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) return false;
  await page.goto(urlFor("/login"), { waitUntil: "networkidle" });
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/dashboard|portal|candidate/, { timeout: 30_000 });
  return true;
}

await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch();
const results = [];

for (const [name, viewport] of Object.entries({ desktop, mobile })) {
  const page = await browser.newPage({ viewport });
  const loggedIn = await maybeLogin(page);
  const routes = loggedIn ? [...publicRoutes, ...authenticatedRoutes] : publicRoutes;
  for (const route of routes) {
    results.push(await capture(page, route, name));
  }
  await page.close();
}

await browser.close();

const summary = results.map((result) => ({
  route: result.route,
  viewport: result.viewport,
  screenshot: path.relative(process.cwd(), result.file),
  consoleErrors: result.consoleErrors.length,
}));

console.table(summary);
if (results.some((result) => result.consoleErrors.length > 0)) {
  for (const result of results) {
    if (result.consoleErrors.length === 0) continue;
    console.error(`\n${result.route} (${result.viewport})`);
    for (const message of result.consoleErrors) {
      console.error(`- ${message}`);
    }
  }
  console.error("Console errors were detected. Check the screenshots and route output above.");
  process.exitCode = 1;
}
