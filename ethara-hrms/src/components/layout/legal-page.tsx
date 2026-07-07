"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/**
 * Shared chrome for the public legal pages (Terms, Privacy, Cookies).
 *
 * Renders a sticky top bar with a working Back control + logo so the pages no
 * longer read as a column of text floating in the middle of the screen, and
 * keeps the body in a comfortable reading column. The page files themselves
 * stay as server components (so they can still export `metadata`) and only
 * pull in this client shell for the interactive Back button.
 */
export function LegalPage({
  eyebrow = "Legal",
  title,
  lastUpdated,
  children,
}: {
  eyebrow?: string;
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <main className="min-h-screen" style={{ background: "var(--background)" }}>
      <header
        className="sticky top-0 z-20 border-b backdrop-blur-md"
        style={{
          borderColor: "rgba(144,141,206,0.18)",
          background: "rgba(11,11,18,0.72)",
        }}
      >
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link href="/careers" aria-label="Ethara.AI careers">
            <Image
              src="/logo.png"
              alt="Ethara.AI"
              width={96}
              height={26}
              priority
              className="object-contain"
              style={{ width: "auto", height: "auto" }}
            />
          </Link>
          <button
            type="button"
            onClick={() => router.back()}
            className="legal-back inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium"
            style={{ color: "rgba(197,203,232,0.72)" }}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="mb-10">
          <p
            className="mb-2 text-xs font-semibold uppercase tracking-[0.22em]"
            style={{ color: "rgba(237,0,237,0.70)" }}
          >
            {eyebrow}
          </p>
          <h1
            className="text-3xl font-bold tracking-tight sm:text-4xl"
            style={{ color: "#C5CBE8" }}
          >
            {title}
          </h1>
          <p className="mt-2 text-sm" style={{ color: "rgba(197,203,232,0.50)" }}>
            Last updated: {lastUpdated}
          </p>
        </div>

        <div className="prose-policy">{children}</div>

        <div
          className="mt-14 flex flex-col gap-4 border-t pt-6 sm:flex-row sm:items-center sm:justify-between"
          style={{ borderColor: "rgba(144,141,206,0.14)" }}
        >
          <button
            type="button"
            onClick={() => router.back()}
            className="legal-back inline-flex items-center gap-2 rounded-lg text-sm font-medium"
            style={{ color: "rgba(197,203,232,0.72)" }}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <Link
            href="/careers"
            className="text-sm font-medium"
            style={{ color: "rgba(237,0,237,0.85)" }}
          >
            Return to home
          </Link>
        </div>
      </div>

      <LegalStyles />
    </main>
  );
}

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2
        className="mb-4 pb-2 text-lg font-semibold"
        style={{
          color: "#C5CBE8",
          borderBottom: "1px solid rgba(144,141,206,0.14)",
        }}
      >
        {title}
      </h2>
      <div
        className="space-y-3 text-sm leading-relaxed"
        style={{ color: "rgba(197,203,232,0.70)" }}
      >
        {children}
      </div>
    </section>
  );
}

function LegalStyles() {
  return (
    <style>{`
      .legal-back { transition: color 0.15s ease, background-color 0.15s ease; cursor: pointer; }
      .legal-back:hover { color: #C5CBE8; background-color: rgba(197,203,232,0.06); }
      .prose-policy ul { list-style: none; padding: 0; margin: 0.5rem 0; }
      .prose-policy ul li { padding: 0.25rem 0 0.25rem 1.25rem; position: relative; }
      .prose-policy ul li::before { content: "–"; position: absolute; left: 0; color: rgba(237,0,237,0.60); }
      .prose-policy strong { color: rgba(197,203,232,0.90); font-weight: 600; }
      .prose-policy p { margin: 0; }
      .prose-policy a { text-decoration: none; }
      .prose-policy a:hover { text-decoration: underline; }
    `}</style>
  );
}
