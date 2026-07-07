// Log in and report what the API says about this account (role, roles, permissions).
import { chromium } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3002";
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

function urlFor(r) { return new URL(r, baseURL).toString(); }

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(urlFor("/login"), { waitUntil: "domcontentloaded" });
await page.getByLabel(/^email$/i).fill(email);
await page.getByLabel(/^password$/i).fill(password);
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForURL(/dashboard|portal|candidate/, { timeout: 30_000 });

const me = await page.evaluate(async () => {
  const t = sessionStorage.getItem("ethara_access_token");
  const tryGet = async (p) => {
    try {
      const r = await fetch(p, { headers: { Authorization: "Bearer " + t } });
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch (e) { return { error: String(e) }; }
  };
  return {
    me: await tryGet("/api/v1/auth/me"),
  };
});
console.log(JSON.stringify(me, null, 2));
await browser.close();
