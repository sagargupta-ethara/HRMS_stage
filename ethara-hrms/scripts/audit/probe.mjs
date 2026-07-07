// Probe: does this account actually RENDER admin/HR/IT pages via direct URL,
// or does the frontend redirect an "employee" away?
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3002";
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const outDir = process.env.OUT_DIR ?? "/tmp/ui-audit-out/probe";

const routes = [
  "/dashboard/admin",
  "/dashboard/hr",
  "/dashboard/hr/pms",
  "/dashboard/employees",
  "/dashboard/candidates",
  "/dashboard/it",
  "/dashboard/contracts",
  "/dashboard/manager",
  "/dashboard/projects/master",
  "/dashboard/assessment-platform",
  "/dashboard/config/users",
  "/dashboard/reports",
];

function urlFor(r) { return new URL(r, baseURL).toString(); }

await fs.mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(urlFor("/login"), { waitUntil: "domcontentloaded" });
await page.getByLabel(/^email$/i).fill(email);
await page.getByLabel(/^password$/i).fill(password);
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForURL(/dashboard|portal|candidate/, { timeout: 30_000 });

for (const r of routes) {
  await page.goto(urlFor(r), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const finalPath = new URL(page.url()).pathname;
  const h1 = await page.locator("h1, h2").first().textContent().catch(() => null);
  const bodyLen = (await page.locator("body").textContent().catch(() => "") || "").trim().length;
  const redirected = finalPath !== r;
  console.log(`${redirected ? "REDIRECT" : "OK      "} ${r} -> ${finalPath}  | h1=${(h1||"").trim().slice(0,50)} | textLen=${bodyLen}`);
}
await browser.close();
