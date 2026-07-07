// Login validation + navigation discovery.
// Logs in via the real UI, screenshots the post-login dashboard (desktop+mobile),
// and dumps every in-app nav link it can find so we know the real navigable routes.
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3002";
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const outDir = process.env.OUT_DIR ?? "/tmp/ui-audit-out";

if (!email || !password) {
  console.error("Set E2E_EMAIL and E2E_PASSWORD");
  process.exit(1);
}

function urlFor(route) {
  return new URL(route, baseURL).toString();
}

async function login(page) {
  await page.goto(urlFor("/login"), { waitUntil: "domcontentloaded" });
  await page.getByLabel(/^email$/i).fill(email);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/dashboard|portal|candidate/, { timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
}

await fs.mkdir(outDir, { recursive: true });
const browser = await chromium.launch();

// Desktop login + discovery
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("401")) consoleErrors.push(m.text());
});

await login(page);
const landedUrl = page.url();
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(outDir, "_postlogin-desktop.png"), fullPage: true });

const token = await page.evaluate(() => sessionStorage.getItem("ethara_access_token"));

// Collect all in-app nav links
const links = await page.evaluate(() => {
  const set = new Set();
  for (const a of document.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href") || "";
    if (href.startsWith("/") && !href.startsWith("//")) set.add(href.split("?")[0].split("#")[0]);
  }
  return Array.from(set).sort();
});

// Try to open the mobile nav too (hamburger) to capture mobile-only nav links
await ctx.close();

const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const mpage = await mctx.newPage();
await login(mpage);
await mpage.waitForTimeout(1200);
await mpage.screenshot({ path: path.join(outDir, "_postlogin-mobile.png"), fullPage: true });
await mctx.close();

await browser.close();

console.log("LANDED_URL=" + landedUrl);
console.log("TOKEN_PRESENT=" + (token ? "yes (" + token.length + " chars)" : "NO"));
console.log("CONSOLE_ERRORS=" + consoleErrors.length);
if (consoleErrors.length) console.log(consoleErrors.slice(0, 10).map((e) => "  - " + e).join("\n"));
console.log("NAV_LINKS (" + links.length + "):");
console.log(links.map((l) => "  " + l).join("\n"));
