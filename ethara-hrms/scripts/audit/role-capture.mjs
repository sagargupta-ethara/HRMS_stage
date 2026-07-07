// Per-ROLE experience capture. Switches the active role via /auth/me/switch-role
// (reversible) and captures each role's real landing page + nav (desktop+mobile).
// Restores the account to `employee` at the end.
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3002";
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const outDir = (process.env.OUT_DIR ?? "/tmp/ui-audit-out") + "/roles";
const RESTORE_ROLE = "employee";

const urlFor = (r) => new URL(r, baseURL).toString();

// Mirrors getDefaultRouteForRole() in src/lib/utils.ts
function defaultRouteForRole(role) {
  if (role === "candidate") return "/portal/dashboard";
  if (role === "admin" || role === "super_admin" || role === "leadership") return "/dashboard/admin";
  if (role === "ta") return "/dashboard/ta";
  if (role === "employee" || role === "employee_referrer") return "/dashboard/employee";
  if (role === "it_team") return "/dashboard/it";
  if (role === "compliance") return "/dashboard/compliance";
  if (role === "office_admin") return "/dashboard/office-admin";
  if (role === "pl_tpm") return "/dashboard/dinner-requests";
  if (role === "manager") return "/dashboard/manager";
  if (role === "hr") return "/dashboard/hr";
  if (role === "evaluator") return "/dashboard/evaluator";
  if (role === "vendor") return "/dashboard/vendor";
  return `/dashboard/${role.replace(/_/g, "-")}`;
}

async function login(page) {
  await page.goto(urlFor("/login"), { waitUntil: "domcontentloaded" });
  await page.getByLabel(/^email$/i).fill(email);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/dashboard|portal|candidate/, { timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function apiSwitch(page, role) {
  return page.evaluate(async (role) => {
    const t = sessionStorage.getItem("ethara_access_token");
    const r = await fetch("/api/v1/auth/me/switch-role", {
      method: "POST",
      headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, role);
}

async function getRoles(page) {
  return page.evaluate(async () => {
    const t = sessionStorage.getItem("ethara_access_token");
    const r = await fetch("/api/v1/auth/me", { headers: { Authorization: "Bearer " + t } });
    const b = await r.json();
    return { role: b.user.role, roles: b.user.roles };
  });
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.getByText(/Loading Ethara HRMS/i).waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);
}

async function navLinks(page) {
  return page.evaluate(() => {
    const set = new Set();
    for (const a of document.querySelectorAll('nav a[href], aside a[href], [data-sidebar] a[href]')) {
      const h = a.getAttribute("href") || "";
      if (h.startsWith("/") && !h.startsWith("//")) set.add(h.split("?")[0].split("#")[0]);
    }
    return Array.from(set).sort();
  });
}

await fs.mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const results = [];

for (const [vpName, vp] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: vpName === "mobile", hasTouch: vpName === "mobile" });
  const page = await ctx.newPage();
  await login(page);
  const { roles } = await getRoles(page);
  const order = ["super_admin", "admin", "hr", "it_team", "office_admin", "manager", "leadership", "ta", "evaluator", "compliance", "employee_referrer", "vendor", "pl_tpm", "employee", "candidate"];
  const roleList = order.filter((r) => roles.includes(r)).concat(roles.filter((r) => !order.includes(r)));

  for (const role of roleList) {
    const sw = await apiSwitch(page, role);
    if (sw.status >= 400) { console.log(`[${vpName}] switch ${role} -> HTTP ${sw.status} SKIP`); continue; }
    // navigate to this role's real default dashboard route
    await page.goto(urlFor(defaultRouteForRole(role)), { waitUntil: "domcontentloaded" });
    await settle(page);
    const landing = new URL(page.url()).pathname;
    const file = path.join(outDir, `${role}-${vpName}-landing.png`);
    await page.screenshot({ path: file, fullPage: true });
    let links = [];
    if (vpName === "desktop") links = await navLinks(page);
    // mobile: try to open the nav drawer for a nav screenshot
    if (vpName === "mobile") {
      const burger = page.getByRole("button", { name: /menu|open|navigation|sidebar/i }).first();
      if (await burger.count().catch(() => 0)) {
        try { await burger.click({ timeout: 2500 }); await page.waitForTimeout(700);
          await page.screenshot({ path: path.join(outDir, `${role}-${vpName}-nav.png`), fullPage: true });
          links = await navLinks(page);
        } catch {}
      }
    }
    results.push({ role, viewport: vpName, landing, navCount: links.length, navLinks: links });
    console.log(`[${vpName}] ${role} -> landing ${landing} (${links.length} nav links)`);
  }
  // restore
  await apiSwitch(page, RESTORE_ROLE);
  await ctx.close();
}
await browser.close();
await fs.writeFile(path.join(outDir, "role-results.json"), JSON.stringify(results, null, 2));
console.log("\nROLE CAPTURE DONE. restored active role -> " + RESTORE_ROLE);
