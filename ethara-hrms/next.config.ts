import type { NextConfig } from "next";

const backendOrigin = (process.env.INTERNAL_API_ORIGIN || "http://127.0.0.1:3001").trim();
const wikiBackendOrigin = (process.env.INTERNAL_WIKI_ORIGIN || "http://127.0.0.1:8001").trim();

// Content-Security-Policy is applied in ALL environments (no longer prod-only) so
// the security posture is consistent and cannot silently regress on a non-"production"
// NODE_ENV. The app and its API/uploads are same-origin (see rewrites below), fonts
// are self-hosted by next/font, and all images are local — so 'self' (+ inline
// scripts/styles that Next emits, and data:/blob: images) covers every legitimate
// resource while still blocking framing, plugin content and base-tag/form hijacking.
//
// In development the Next.js dev server's HMR runtime uses eval(), so 'unsafe-eval'
// is added to script-src for dev only (per Next.js CSP guidance). It is NOT present
// in production.
//
// NOTE (partial): 'unsafe-inline' is intentionally KEPT in script-src. Next.js
// injects inline bootstrap/hydration scripts; dropping 'unsafe-inline' without a
// per-request nonce or experimental SRI ('strict-dynamic' + 'nonce-…') would break
// hydration. A nonce setup requires a Proxy/middleware that mutates request headers
// plus reading the nonce in app/layout.tsx (outside this change's scope) and forces
// all pages into dynamic rendering. Tracked separately — see cross_cutting_notes.
const isDev = process.env.NODE_ENV === "development";
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  // Inline document previews load PDFs into an <iframe src=blob:…>; without an
  // explicit frame-src this falls back to default-src 'self' and blocks blob: frames.
  "frame-src 'self' blob:",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  // 'unsafe-eval' added for dev HMR only; see NOTE above re: 'unsafe-inline'.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  // Dev HMR opens a websocket back to the dev server; allow ws:/wss: in dev only.
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];
const appDocumentHeaders = [
  ...securityHeaders,
  { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" },
  { key: "Pragma", value: "no-cache" },
  { key: "Expires", value: "0" },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: [],
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/((?!api|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|uploads).*)",
        headers: appDocumentHeaders,
      },
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  // Keep connections short-lived to prevent hanging proxy connections from crashing the server
  httpAgentOptions: {
    keepAlive: false,
  },
  experimental: {
    // Screening and OCR requests can take longer than normal API calls because
    // they wait on document extraction and LLM responses.
    proxyTimeout: 180_000,
  },
  async rewrites() {
    return [
      {
        source: "/employee-wiki",
        destination: `${wikiBackendOrigin}/`,
      },
      {
        source: "/employee-wiki/api/:path*",
        destination: `${wikiBackendOrigin}/api/:path*`,
      },
      {
        source: "/employee-wiki/static/:path*",
        destination: `${wikiBackendOrigin}/static/:path*`,
      },
      {
        source: "/employee-wiki/:path*",
        destination: `${wikiBackendOrigin}/:path*`,
      },
      {
        source: "/api/:path*",
        destination: `${backendOrigin}/api/:path*`,
      },
      {
        source: "/uploads/:path*",
        destination: `${backendOrigin}/uploads/:path*`,
      },
    ];
  },
};

export default nextConfig;
