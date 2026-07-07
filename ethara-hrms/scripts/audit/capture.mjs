// Comprehensive UI capture: every route at desktop + mobile, plus tabs and
// key drill-downs. Resilient (per-route retry, continues on failure). Writes a
// results.json manifest that the analysis agents consume.
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3002";
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const outDir = process.env.OUT_DIR ?? "/tmp/ui-audit-out";
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null; // optional filter

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

// route, optional: group, tabs (capture each tab), drill (handler key)
const ROUTES = [
  // ---- Public / unauthenticated ----
  { r: "/", group: "public" },
  { r: "/login", group: "public" },
  { r: "/careers", group: "public" },
  { r: "/contact", group: "public" },
  { r: "/register", group: "public" },
  { r: "/forgot-password", group: "public" },
  { r: "/privacy-policy", group: "public" },
  { r: "/terms-of-service", group: "public" },
  { r: "/cookies-policy", group: "public" },
  { r: "/candidate/register", group: "public" },
  { r: "/candidate/campus-register", group: "public" },
  { r: "/employee/register", group: "public" },
  // ---- Admin & analytics dashboards ----
  { r: "/dashboard/admin", group: "dashboards", tabs: true },
  { r: "/dashboard/hr", group: "dashboards", tabs: true },
  { r: "/dashboard/office-admin", group: "dashboards", tabs: true },
  { r: "/dashboard/it", group: "dashboards", tabs: true },
  { r: "/dashboard/manager", group: "dashboards", tabs: true },
  { r: "/dashboard/ta", group: "dashboards", tabs: true },
  { r: "/dashboard/evaluator", group: "dashboards", tabs: true },
  { r: "/dashboard/referrer", group: "dashboards", tabs: true },
  { r: "/dashboard/vendor", group: "dashboards", tabs: true },
  { r: "/dashboard/reports", group: "dashboards", tabs: true },
  { r: "/dashboard/module-overview", group: "dashboards" },
  // ---- Talent acquisition ----
  { r: "/dashboard/candidates", group: "talent", tabs: true, drill: "candidate" },
  { r: "/dashboard/candidates/new", group: "talent" },
  { r: "/dashboard/applications", group: "talent", tabs: true },
  { r: "/dashboard/screening", group: "talent", tabs: true },
  { r: "/dashboard/referrals", group: "talent", tabs: true },
  { r: "/dashboard/evaluations", group: "talent", tabs: true },
  { r: "/dashboard/evaluations/completed", group: "talent" },
  { r: "/dashboard/selection-forms", group: "talent", tabs: true },
  // ---- Employees & onboarding ----
  { r: "/dashboard/employees", group: "employees", tabs: true, drill: "employee" },
  { r: "/dashboard/contracts", group: "employees", tabs: true },
  { r: "/dashboard/signed-contracts", group: "employees", tabs: true },
  { r: "/dashboard/documents", group: "employees", tabs: true },
  { r: "/dashboard/compliance", group: "employees", tabs: true },
  { r: "/dashboard/bank-verification", group: "employees", tabs: true },
  { r: "/dashboard/separation", group: "employees", tabs: true },
  { r: "/dashboard/skills", group: "employees", tabs: true },
  { r: "/dashboard/positions", group: "employees" },
  // ---- HR / PMS (user-flagged) ----
  { r: "/dashboard/hr/pms", group: "hr-pms", tabs: true, drill: "pms" },
  // ---- IT & assets ----
  { r: "/dashboard/it/assets", group: "it", tabs: true },
  { r: "/dashboard/it/id-cards", group: "it", tabs: true },
  { r: "/dashboard/it-requests", group: "it", tabs: true },
  { r: "/dashboard/manager-mapping", group: "it" },
  { r: "/dashboard/attendance", group: "it", tabs: true },
  { r: "/dashboard/leave", group: "it", tabs: true },
  // ---- Manager ----
  { r: "/dashboard/manager/team", group: "manager", tabs: true },
  { r: "/dashboard/manager/leaves", group: "manager", tabs: true },
  // ---- Projects & governance ----
  { r: "/dashboard/projects", group: "projects", tabs: true },
  { r: "/dashboard/projects/master", group: "projects", tabs: true },
  { r: "/dashboard/projects/budgets", group: "projects", tabs: true },
  { r: "/dashboard/projects/leadership", group: "projects", tabs: true },
  { r: "/dashboard/projects/settings", group: "projects" },
  { r: "/dashboard/reimbursements", group: "projects", tabs: true },
  { r: "/dashboard/dinner-requests", group: "projects", tabs: true },
  { r: "/dashboard/resource-segregation", group: "projects" },
  { r: "/dashboard/escalations", group: "projects", tabs: true },
  // ---- Assessment platform ----
  { r: "/dashboard/assessment-platform", group: "assessment", tabs: true },
  { r: "/dashboard/assessment-platform/new", group: "assessment" },
  { r: "/dashboard/assessment-platform/grading", group: "assessment" },
  { r: "/dashboard/assessment-platform/question-bank", group: "assessment" },
  // ---- Config ----
  { r: "/dashboard/config/users", group: "config", tabs: true },
  { r: "/dashboard/config/colleges", group: "config" },
  { r: "/dashboard/config/departments-designations", group: "config" },
  { r: "/dashboard/config/positions", group: "config" },
  { r: "/dashboard/config/role-modules", group: "config" },
  { r: "/dashboard/config/settings", group: "config", tabs: true },
  { r: "/dashboard/config/vendors", group: "config" },
  // ---- Misc ----
  { r: "/dashboard/audit-logs", group: "config" },
  { r: "/dashboard/logs", group: "config" },
  { r: "/dashboard/sync-logs", group: "config" },
  { r: "/dashboard/notifications", group: "misc" },
  // ---- Employee self-service ----
  { r: "/dashboard/employee", group: "self-service", tabs: true },
  { r: "/dashboard/employee/attendance", group: "self-service", tabs: true },
  { r: "/dashboard/employee/compliance", group: "self-service" },
  { r: "/dashboard/employee/contracts", group: "self-service" },
  { r: "/dashboard/employee/documents", group: "self-service" },
  { r: "/dashboard/employee/id-card", group: "self-service" },
  { r: "/dashboard/employee/leave", group: "self-service", tabs: true },
  { r: "/dashboard/employee/referrals", group: "self-service" },
  { r: "/dashboard/employee/selection-form", group: "self-service" },
  { r: "/dashboard/employee/separation", group: "self-service" },
  // ---- Portal (candidate self-service) ----
  { r: "/portal/dashboard", group: "portal" },
  { r: "/portal/application", group: "portal" },
  { r: "/portal/compliance", group: "portal" },
  { r: "/portal/contract", group: "portal" },
  { r: "/portal/documents", group: "portal" },
  { r: "/portal/id-card", group: "portal" },
  { r: "/portal/my-assessments", group: "portal" },
  { r: "/portal/notifications", group: "portal" },
  { r: "/portal/profile", group: "portal" },
  { r: "/portal/selection-form", group: "portal" },
];

const urlFor = (r) => new URL(r, baseURL).toString();
const slug = (r) => r.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-") || "root";

async function login(page) {
  await page.goto(urlFor("/login"), { waitUntil: "domcontentloaded" });
  await page.getByLabel(/^email$/i).fill(email);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/dashboard|portal|candidate/, { timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  // wait for the global app loader to disappear if present
  await page.getByText(/Loading Ethara HRMS/i).waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);
}

async function shoot(page, dir, name) {
  const file = path.join(outDir, dir, `${name}.png`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: true });
  return path.relative(outDir, file);
}

// Capture each tab on the current page (desktop only). Returns list of shots.
async function captureTabs(page, name) {
  const shots = [];
  const tabs = page.locator('[role="tab"]');
  const count = await tabs.count().catch(() => 0);
  if (!count) return shots;
  for (let i = 0; i < Math.min(count, 8); i++) {
    try {
      const tab = tabs.nth(i);
      const label = ((await tab.textContent().catch(() => "")) || `tab${i}`).trim().replace(/[^a-z0-9]+/gi, "-").slice(0, 24) || `tab${i}`;
      await tab.click({ timeout: 4000 });
      await page.waitForTimeout(700);
      shots.push(await shoot(page, "tabs", `${name}--${i}-${label}`));
    } catch { /* ignore individual tab */ }
  }
  return shots;
}

async function drillCandidate(page, name) {
  const shots = [];
  const link = page.locator('a[href^="/dashboard/candidates/"]').first();
  if (await link.count()) {
    const href = await link.getAttribute("href");
    if (href && /\/candidates\/[^/]+$/.test(href)) {
      await page.goto(urlFor(href), { waitUntil: "domcontentloaded" });
      await settle(page);
      shots.push(await shoot(page, "deep", `${name}--detail`));
      shots.push(...await captureTabs(page, `${name}--detail`));
    }
  }
  return shots;
}

async function drillEmployee(page, name) {
  const shots = [];
  const link = page.locator('a[href^="/dashboard/employees/"]').first();
  if (await link.count()) {
    const href = await link.getAttribute("href");
    if (href && /\/employees\/[^/]+$/.test(href)) {
      await page.goto(urlFor(href), { waitUntil: "domcontentloaded" });
      await settle(page);
      shots.push(await shoot(page, "deep", `${name}--detail`));
      shots.push(...await captureTabs(page, `${name}--detail`));
    }
  }
  return shots;
}

async function drillPms(page, name) {
  // User-flagged: clicking a name opens a long detail form. Click first clickable name/row.
  const shots = [];
  const candidates = [
    page.locator("table tbody tr td a").first(),
    page.locator("table tbody tr").first(),
    page.locator('[role="row"]').nth(1),
    page.getByRole("button", { name: /view|details|evaluate/i }).first(),
  ];
  for (const c of candidates) {
    if (await c.count().catch(() => 0)) {
      try {
        await c.click({ timeout: 4000 });
        await page.waitForTimeout(1200);
        shots.push(await shoot(page, "deep", `${name}--name-click-form`));
        break;
      } catch { /* try next */ }
    }
  }
  return shots;
}

const DRILLS = { candidate: drillCandidate, employee: drillEmployee, pms: drillPms };

async function captureRoute(ctx, viewportName, route) {
  const name = slug(route.r);
  const res = { route: route.r, group: route.group, viewport: viewportName, shots: [], tabs: [], deep: [], consoleErrors: [], error: null };
  let attempt = 0;
  while (attempt < 2) {
    attempt++;
    const page = await ctx.newPage();
    const errs = [];
    page.on("console", (m) => { if (m.type() === "error" && !/401|favicon|ERR_FILE_NOT_FOUND/i.test(m.text())) errs.push(m.text()); });
    page.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message));
    try {
      await page.goto(urlFor(route.r), { waitUntil: "domcontentloaded", timeout: 30000 });
      await settle(page);
      res.shots.push(await shoot(page, viewportName, name));
      if (viewportName === "desktop" && route.tabs) res.tabs = await captureTabs(page, name);
      if (viewportName === "desktop" && route.drill && DRILLS[route.drill]) {
        res.deep = await DRILLS[route.drill](page, name);
      }
      res.consoleErrors = errs;
      res.error = null;
      await page.close();
      break;
    } catch (e) {
      res.error = String(e).slice(0, 300);
      await page.close().catch(() => {});
      if (attempt >= 2) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  const tag = res.error ? "FAIL" : "ok  ";
  console.log(`[${viewportName}] ${tag} ${route.r}${res.tabs.length ? ` (+${res.tabs.length} tabs)` : ""}${res.deep.length ? ` (+${res.deep.length} deep)` : ""}${res.consoleErrors.length ? ` [${res.consoleErrors.length} console-err]` : ""}`);
  return res;
}

// ---- main ----
await fs.mkdir(outDir, { recursive: true });
const routes = ONLY ? ROUTES.filter((x) => ONLY.some((o) => x.r === o)) : ROUTES;
const browser = await chromium.launch();
const allResults = [];

for (const [vpName, vp] of [["desktop", DESKTOP], ["mobile", MOBILE]]) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: vpName === "mobile", hasTouch: vpName === "mobile", deviceScaleFactor: 1 });
  // login once per context (sessionStorage token lives per-context)
  const lp = await ctx.newPage();
  await login(lp);
  await lp.close();
  for (const route of routes) {
    allResults.push(await captureRoute(ctx, vpName, route));
  }
  await ctx.close();
}
await browser.close();

await fs.writeFile(path.join(outDir, "results.json"), JSON.stringify(allResults, null, 2));
const fails = allResults.filter((r) => r.error);
const withErr = allResults.filter((r) => r.consoleErrors.length);
console.log(`\nDONE. routes=${routes.length} captures=${allResults.length} failures=${fails.length} routes-with-console-errors=${new Set(withErr.map(r=>r.route)).size}`);
if (fails.length) console.log("FAILURES:\n" + fails.map((f) => `  [${f.viewport}] ${f.route}: ${f.error}`).join("\n"));
