"use client";

import Image from "next/image";
import Link from "next/link";
import type { ElementType, ReactNode } from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Briefcase, Building2, ShieldCheck } from "lucide-react";

import { safeNextPath } from "@/lib/export";

export default function RegisterSelectionPage() {
  return (
    <Suspense fallback={<Shell />}>
      <RegisterSelectionContent />
    </Suspense>
  );
}

function RegisterSelectionContent() {
  const searchParams = useSearchParams();
  // Only forward a validated same-site path to prevent open-redirect chaining.
  const next = safeNextPath(searchParams.get("next"));
  const nextQuery = next ? `?next=${encodeURIComponent(next)}` : "";

  return (
    <Shell>
      <div className="flex flex-1 items-center py-10">
        <div className="w-full">
          <div className="mb-10 flex items-center justify-between gap-4">
            <Image
              src="/logo.png"
              alt="Ethara.AI"
              width={132}
              height={36}
              className="h-auto w-[132px] object-contain"
              priority
            />
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:border-[rgba(237,0,237,0.36)] hover:text-white"
              style={{
                color: "rgba(197,203,232,0.72)",
                borderColor: "rgba(144,141,206,0.20)",
                background: "rgba(144,141,206,0.05)",
              }}
            >
              <ArrowLeft className="h-4 w-4" />
              Sign in
            </Link>
          </div>

          <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
            <div className="max-w-xl">
              <p
                className="text-xs font-semibold uppercase tracking-[0.28em]"
                style={{ color: "rgba(237,0,237,0.70)" }}
              >
                Portal registration
              </p>
              <h1
                className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl"
                style={{ color: "#F7F7FB" }}
              >
                Start with the right account.
              </h1>
              <p className="mt-4 max-w-lg text-base leading-7" style={{ color: "rgba(197,203,232,0.62)" }}>
                Choose the registration path that matches your relationship with Ethara.AI.
              </p>
              <div
                className="mt-8 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                style={{
                  color: "rgba(197,203,232,0.68)",
                  borderColor: "rgba(144,141,206,0.18)",
                  background: "rgba(144,141,206,0.05)",
                }}
              >
                <ShieldCheck className="h-4 w-4" style={{ color: "#908DCE" }} />
                Secure onboarding and profile setup
              </div>
            </div>

            <div className="grid gap-4">
              <RegistrationCard
                href={`/candidate/register${nextQuery}`}
                icon={Briefcase}
                title="Register as candidate"
                eyebrow="Applicant journey"
                description="For applicants applying to open roles, submitting documents, and completing the selection process."
                accentColor="#ED00ED"
                accentRgb="237,0,237"
              />
              <RegistrationCard
                href={`/employee/register${nextQuery}`}
                icon={Building2}
                title="Register as employee"
                eyebrow="Employee access"
                description="For Ethara team members creating company access and employee compliance records."
                accentColor="#908DCE"
                accentRgb="144,141,206"
              />
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function RegistrationCard({
  href,
  icon: Icon,
  title,
  eyebrow,
  description,
  accentColor,
  accentRgb,
}: {
  href: string;
  icon: ElementType;
  title: string;
  eyebrow: string;
  description: string;
  accentColor: string;
  accentRgb: string;
}) {
  return (
    <Link href={href} className="group block">
      <div
        className="relative h-full rounded-lg p-5 transition-all duration-200 group-hover:-translate-y-0.5"
        style={{
          background: "rgba(16,17,29,0.82)",
          border: `1px solid rgba(${accentRgb},0.18)`,
          boxShadow: "0 20px 55px rgba(0,0,0,0.22)",
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-lg"
            style={{
              background: `rgba(${accentRgb},0.11)`,
              border: `1px solid rgba(${accentRgb},0.24)`,
            }}
          >
            <Icon className="h-5 w-5" style={{ color: accentColor }} />
          </div>
          <ArrowRight className="mt-2 h-5 w-5 shrink-0 transition-transform group-hover:translate-x-1" style={{ color: accentColor }} />
        </div>

        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.22em]" style={{ color: `rgba(${accentRgb},0.75)` }}>
          {eyebrow}
        </p>
        <h2 className="mt-2 text-xl font-semibold text-white">{title}</h2>
        <p className="mt-3 max-w-xl text-sm leading-6" style={{ color: "rgba(197,203,232,0.60)" }}>
          {description}
        </p>
      </div>
    </Link>
  );
}

function Shell({ children }: { children?: ReactNode }) {
  return (
    <main
      className="relative min-h-screen overflow-hidden animate-fade-in"
      style={{ background: "#080810", color: "var(--foreground)" }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(135deg, rgba(237,0,237,0.10) 0%, transparent 34%), linear-gradient(315deg, rgba(144,141,206,0.08) 0%, transparent 40%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(197,203,232,0.9) 1px, transparent 1px), linear-gradient(90deg, rgba(197,203,232,0.9) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-6 sm:px-8">
        {children ?? (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-8 w-8 rounded-full border-2 border-t-[#ED00ED] border-[rgba(144,141,206,0.20)] animate-spin" />
          </div>
        )}
      </div>
    </main>
  );
}
