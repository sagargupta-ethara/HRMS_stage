"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Bookmark, Briefcase, Building2, CheckCircle2,
  ChevronRight, Clock, Globe, MapPin, Share2, Sparkles, Users, Zap,
} from "lucide-react";

import { positionsApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { cn, formatStableDate } from "@/lib/utils";
import type { Position } from "@/types";

const EXPERIENCE_BRACKETS = [
  { value: 0, label: "0-1" },
  { value: 1, label: "1-2" },
  { value: 2, label: "2-3" },
  { value: 3, label: "3-5" },
  { value: 5, label: "5-8" },
  { value: 8, label: "8-12" },
  { value: 12, label: "12-15" },
  { value: 15, label: "15+" },
];

function loginApplyHref(positionId: string): string {
  return `/login?next=${encodeURIComponent(`/portal/application?positionId=${positionId}`)}`;
}

function experienceYearsLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  const option = EXPERIENCE_BRACKETS.reduce(
    (best, bracket) => (numeric >= bracket.value ? bracket : best),
    EXPERIENCE_BRACKETS[0]
  );
  return option.label;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/\n|•|- /)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function numericValue(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export default function CareerDetailPage() {
  const params = useParams<{ slug: string }>();
  const { isAuthenticated, user } = useAuth();
  const [position, setPosition] = useState<Position | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!params?.slug) return;
    positionsApi
      .publicGet(params.slug)
      .then((data) => {
        setPosition(data);
        setError("");
      })
      .catch(() => {
        setPosition(null);
        setError("We couldn't load this role right now.");
      })
      .finally(() => setIsLoading(false));
  }, [params?.slug]);

  const primaryApplyHref = useMemo(() => {
    if (!position) return "/";
    if (isAuthenticated && user?.role === "candidate") {
      return `/portal/application?positionId=${position.id}`;
    }
    return loginApplyHref(position.id);
  }, [isAuthenticated, position, user?.role]);

  const handleShare = () => {
    if (typeof navigator === "undefined" || typeof window === "undefined") return;
    navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => undefined);
  };

  if (isLoading) {
    return (
      <PageShell>
        <div className="mx-auto max-w-6xl px-6 py-20 lg:px-10">
          <div className="h-8 w-48 animate-pulse rounded-lg" style={{ background: "rgba(144,141,206,0.08)" }} />
          <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_340px]">
            <div className="space-y-4">
              <div className="h-12 w-3/4 animate-pulse rounded-xl" style={{ background: "rgba(144,141,206,0.08)" }} />
              <div className="h-4 w-full animate-pulse rounded" style={{ background: "rgba(144,141,206,0.06)" }} />
              <div className="h-4 w-2/3 animate-pulse rounded" style={{ background: "rgba(144,141,206,0.06)" }} />
            </div>
            <div className="h-80 animate-pulse rounded-2xl" style={{ background: "rgba(144,141,206,0.08)" }} />
          </div>
        </div>
      </PageShell>
    );
  }

  if (!position || error) {
    return (
      <PageShell>
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <p className="text-lg font-medium" style={{ color: "rgba(197,203,232,0.60)" }}>{error || "Role not found"}</p>
          <Link
            href="/careers"
            className="mt-6 inline-flex items-center gap-2 text-sm transition-colors"
            style={{ color: "#908DCE" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#ED00ED"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#908DCE"; }}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to all roles
          </Link>
        </div>
      </PageShell>
    );
  }

  const responsibilities = stringList(position.responsibilities);
  const requirements = stringList(position.requirements);
  const preferredSkills = stringList(position.preferredSkills);
  const openings = numericValue(position.openings, 1);
  const urgencyLevel = numericValue(position.urgencyLevel);

  return (
    <PageShell>
      <nav
        className="sticky top-0 z-50"
        style={{
          background: "rgba(10,11,18,0.88)",
          backdropFilter: "blur(22px)",
          borderBottom: "1px solid rgba(144,141,206,0.14)",
        }}
      >
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-10">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/careers" className="hidden items-center sm:flex">
              <Image src="/logo.png" alt="Ethara.AI" width={108} height={30} className="object-contain" style={{ width: "auto", height: "auto" }} priority />
            </Link>
            <span className="hidden h-4 w-px sm:block" style={{ background: "rgba(144,141,206,0.16)" }} />
            <Link
              href="/careers"
              className="flex items-center gap-2 text-sm transition-colors"
              style={{ color: "rgba(197,203,232,0.56)" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#C5CBE8"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(197,203,232,0.56)"; }}
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">All Roles</span>
            </Link>
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
            <span className="truncate text-sm font-medium" style={{ color: "rgba(197,203,232,0.80)" }}>{position.title}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleShare}
              className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs transition-all"
              style={{
                background: "rgba(144,141,206,0.08)",
                border: "1px solid rgba(144,141,206,0.18)",
                color: "rgba(197,203,232,0.50)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(237,0,237,0.10)";
                e.currentTarget.style.borderColor = "rgba(237,0,237,0.30)";
                e.currentTarget.style.color = "#C5CBE8";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(144,141,206,0.08)";
                e.currentTarget.style.borderColor = "rgba(144,141,206,0.18)";
                e.currentTarget.style.color = "rgba(197,203,232,0.50)";
              }}
            >
              <Share2 className="h-3.5 w-3.5" />
              {copied ? "Copied!" : "Share"}
            </button>
            <Link href={primaryApplyHref}>
              <button
                className="h-8 rounded-lg px-4 text-xs font-semibold text-white transition-all duration-200 active:scale-95"
                style={{
                  backgroundImage: "linear-gradient(135deg, #ED00ED 0%, #908DCE 100%)",
                  backgroundSize: "160% 160%",
                  animation: "brandGradientMove 9s ease infinite",
                  boxShadow: "0 8px 18px rgba(0,0,0,0.24)",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 10px 24px rgba(0,0,0,0.30)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 8px 18px rgba(0,0,0,0.24)"; }}
              >
                Apply Now
              </button>
            </Link>
          </div>
        </div>
      </nav>

      <section
        className="relative overflow-hidden py-14 sm:py-16"
        style={{
          background: "linear-gradient(180deg, rgba(10,11,18,0.86), rgba(10,11,18,0.98))",
          borderBottom: "1px solid rgba(144,141,206,0.12)",
        }}
      >
        <div className="pointer-events-none absolute inset-0">
          <div
            className="hero-bg-image absolute inset-[-5%] opacity-[0.26]"
            style={{
              backgroundImage: "url('/hero-bg.jpg')",
              backgroundSize: "cover",
              backgroundPosition: "center 42%",
              backgroundRepeat: "no-repeat",
            }}
          />
          <div
            className="absolute inset-0"
            style={{ background: "rgba(8,8,14,0.78)" }}
          />
          <div
            className="absolute inset-0"
            style={{
              background: [
                "radial-gradient(ellipse 76% 42% at 50% -8%, rgba(237,0,237,0.11) 0%, transparent 62%)",
                "radial-gradient(ellipse 54% 38% at 82% 48%, rgba(144,141,206,0.06) 0%, transparent 58%)",
              ].join(", "),
              animation: "professionalGlowDrift 16s ease-in-out infinite",
            }}
          />
          <div
            className="careers-grid-pan absolute inset-0 opacity-[0.028]"
            style={{
              backgroundImage: "linear-gradient(rgba(144,141,206,1) 1px, transparent 1px), linear-gradient(90deg, rgba(144,141,206,1) 1px, transparent 1px)",
              backgroundSize: "72px 72px",
            }}
          />
          <div
            className="hero-light-ray hero-light-ray-1 absolute inset-0"
            style={{
              background: "linear-gradient(105deg, transparent 20%, rgba(237,0,237,0.025) 45%, rgba(144,141,206,0.04) 50%, rgba(237,0,237,0.025) 55%, transparent 80%)",
              width: "200%",
              left: "-50%",
            }}
          />
          <div
            className="absolute inset-x-0 bottom-0 h-28"
            style={{ background: "linear-gradient(to bottom, transparent 0%, rgba(10,11,18,0.92) 72%, #0A0B12 100%)" }}
          />
          <div
            className="absolute left-0 top-[62%] h-px w-[70%]"
            style={{
              background: "linear-gradient(90deg, transparent, rgba(237,0,237,0.34), rgba(144,141,206,0.22), transparent)",
              animation: "accentLineSweep 11s ease-in-out infinite",
            }}
          />
        </div>
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
          <div className="mb-6 flex items-center gap-2 text-xs" style={{ color: "rgba(197,203,232,0.30)" }}>
            <Link
              href="/careers"
              className="transition-colors"
              style={{ color: "rgba(197,203,232,0.30)" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#908DCE"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(197,203,232,0.30)"; }}
            >
              Careers
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span style={{ color: "rgba(197,203,232,0.50)" }}>{position.department}</span>
            <ChevronRight className="h-3 w-3" />
            <span style={{ color: "rgba(197,203,232,0.70)" }}>{position.title}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-3 py-1 text-[11px] font-medium"
              style={{ background: "rgba(237,0,237,0.12)", border: "1px solid rgba(237,0,237,0.28)", color: "#ED00ED" }}
            >
              {position.department}
            </span>
            {position.featured && (
              <span
                className="rounded-full px-3 py-1 text-[11px] font-medium"
                style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.28)", color: "#fbbf24" }}
              >
                <Sparkles className="h-3 w-3 inline-block align-middle mr-0.5" /> Featured
              </span>
            )}
            {urgencyLevel >= 3 && (
              <span
                className="rounded-full px-3 py-1 text-[11px] font-medium"
                style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.28)", color: "#f87171" }}
              >
                Urgent Hire
              </span>
            )}
          </div>

          <h1
            className="animate-slide-up mt-4 max-w-5xl text-4xl font-semibold tracking-normal text-white sm:text-5xl lg:text-6xl"
            style={{ lineHeight: 1.15 }}
          >
            {position.title}
          </h1>

          <div className="animate-slide-up mt-5 flex flex-wrap gap-4 text-sm" style={{ color: "rgba(197,203,232,0.58)", animationDelay: "70ms" }}>
            {position.location && (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4" style={{ color: "rgba(197,203,232,0.30)" }} />
                {position.location}
              </span>
            )}
            {position.workMode && (
              <span className="flex items-center gap-1.5">
                <Globe className="h-4 w-4" style={{ color: "rgba(197,203,232,0.30)" }} />
                {position.workMode}
              </span>
            )}
            {position.experienceLevel && (
              <span className="flex items-center gap-1.5">
                <Briefcase className="h-4 w-4" style={{ color: "rgba(197,203,232,0.30)" }} />
                {position.experienceLevel}
              </span>
            )}
            {position.employmentType && (
              <span className="flex items-center gap-1.5">
                <Clock className="h-4 w-4" style={{ color: "rgba(197,203,232,0.30)" }} />
                {position.employmentType}
              </span>
            )}
            {position.postedAt && (
              <span className="flex items-center gap-1.5">
                <Zap className="h-4 w-4" style={{ color: "rgba(237,0,237,0.50)" }} />
                Posted {position.postedAt ? formatStableDate(position.postedAt) : "Recently"}
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-10">
        <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6 min-w-0">
            <ContentCard title="About this Role" icon={Building2}>
              <div className="whitespace-pre-wrap break-words text-[15px] leading-[1.75]" style={{ color: "rgba(197,203,232,0.70)" }}>
                {position.description || position.summary ||
                  "Join our team and help us build the next generation of intelligent hiring infrastructure. This role sits at the intersection of product, engineering, and customer impact."}
              </div>
            </ContentCard>

            {responsibilities.length > 0 && (
              <ContentCard title="Key Job Responsibilities" icon={CheckCircle2}>
                <ul className="space-y-3">
                  {responsibilities.map((item, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span
                        className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: "#ED00ED", boxShadow: "0 0 6px rgba(237,0,237,0.50)" }}
                      />
                      <span className="text-[15px] leading-relaxed" style={{ color: "rgba(197,203,232,0.70)" }}>{item}</span>
                    </li>
                  ))}
                </ul>
              </ContentCard>
            )}

            {requirements.length > 0 && (
              <ContentCard title="Required Skill Set" icon={Users}>
                <ul className="space-y-3">
                  {requirements.map((item, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "rgba(144,141,206,0.70)" }} />
                      <span className="text-[15px] leading-relaxed" style={{ color: "rgba(197,203,232,0.70)" }}>{item}</span>
                    </li>
                  ))}
                </ul>
              </ContentCard>
            )}

            {preferredSkills.length > 0 && (
              <ContentCard title="Additional Skill Keywords" icon={Sparkles}>
                <div className="flex flex-wrap gap-2">
                  {preferredSkills.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-lg px-3 py-1.5 text-sm transition-all duration-200"
                      style={{
                        background: "rgba(144,141,206,0.08)",
                        border: "1px solid rgba(144,141,206,0.20)",
                        color: "#908DCE",
                      }}
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </ContentCard>
            )}

            <ContentCard title="How We Hire" icon={Zap}>
              <div className="space-y-4">
                {[
                  { step: "1", label: "Apply Online", desc: "Fill in your details and submit your resume." },
                  { step: "2", label: "Recruiter Call", desc: "A 30-min intro call to discuss fit and expectations." },
                  { step: "3", label: "Technical Round", desc: "Skill-based evaluation tailored to the role." },
                  { step: "4", label: "Offer", desc: "Fast turnaround with a clear, competitive package." },
                ].map((item) => (
                  <div key={item.step} className="flex items-start gap-4">
                    <div
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                      style={{
                        background: "#0B0B12",
                        border: "1px solid rgba(237,0,237,0.35)",
                        color: "#ED00ED",
                        boxShadow: "0 0 10px rgba(237,0,237,0.20)",
                      }}
                    >
                      {item.step}
                    </div>
                    <div>
                      <p className="text-sm font-medium" style={{ color: "rgba(197,203,232,0.85)" }}>{item.label}</p>
                      <p className="text-sm" style={{ color: "rgba(197,203,232,0.45)" }}>{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </ContentCard>

            <div
              className="rounded-2xl p-6"
              style={{
                background: "linear-gradient(135deg, rgba(237,0,237,0.07) 0%, rgba(25,24,44,0.72) 56%, rgba(10,11,18,0.86) 100%)",
                border: "1px solid rgba(237,0,237,0.20)",
                boxShadow: "0 16px 42px rgba(0,0,0,0.24)",
              }}
            >
              <p
                className="text-xs font-semibold uppercase tracking-widest"
                style={{ color: "rgba(237,0,237,0.70)" }}
              >
                About Ethara
              </p>
              <p className="mt-3 text-[15px] leading-relaxed" style={{ color: "rgba(197,203,232,0.65)" }}>
                Ethara.AI operates at the frontier of next-generation intelligence training. We design
                reinforcement learning environments, feedback systems, and evaluation pipelines that
                bridge the gap of AGI.
              </p>
              <Link
                href="/careers"
                className="mt-4 inline-flex items-center gap-1.5 text-sm transition-colors"
                style={{ color: "#908DCE" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#ED00ED"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "#908DCE"; }}
              >
                View all open roles <ArrowLeft className="h-3.5 w-3.5 rotate-180" />
              </Link>
            </div>
          </div>

          <div className="space-y-4">
            <div className="lg:sticky lg:top-[4.5rem]">
              <div
                className="rounded-2xl p-5"
                style={{
                  background: "linear-gradient(145deg, rgba(25,24,44,0.88), rgba(10,11,18,0.94))",
                  border: "1px solid rgba(144,141,206,0.20)",
                  backdropFilter: "blur(22px)",
                  boxShadow: "0 24px 70px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.04)",
                }}
              >
                <p
                  className="text-xs font-semibold uppercase tracking-widest"
                  style={{ color: "rgba(197,203,232,0.35)" }}
                >
                  {openings > 1 ? `${openings} openings` : "Now hiring"}
                </p>

                <div className="mt-4 space-y-2">
                  <Link href={primaryApplyHref} className="block">
                    <button
                      className="h-11 w-full rounded-xl text-sm font-semibold text-white transition-all duration-200 active:scale-[0.98]"
                      style={{
                        backgroundImage: "linear-gradient(135deg, #ED00ED 0%, #908DCE 100%)",
                        backgroundSize: "160% 160%",
                        animation: "brandGradientMove 9s ease infinite",
                        boxShadow: "0 10px 24px rgba(0,0,0,0.24)",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 12px 28px rgba(0,0,0,0.30)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 10px 24px rgba(0,0,0,0.24)"; }}
                    >
                      {isAuthenticated && user?.role === "candidate" ? "Apply from Portal" : "Apply Now"}
                    </button>
                  </Link>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => setSaved(!saved)}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-xs transition-all duration-200"
                      )}
                      style={saved ? {
                        background: "rgba(237,0,237,0.10)",
                        border: "1px solid rgba(237,0,237,0.30)",
                        color: "#ED00ED",
                      } : {
                        background: "rgba(144,141,206,0.06)",
                        border: "1px solid rgba(144,141,206,0.18)",
                        color: "rgba(197,203,232,0.45)",
                      }}
                    >
                      <Bookmark className={cn("h-3.5 w-3.5", saved && "fill-current")} />
                      {saved ? "Saved" : "Save"}
                    </button>
                    <button
                      onClick={handleShare}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-xs transition-all duration-200"
                      style={{
                        background: "rgba(144,141,206,0.06)",
                        border: "1px solid rgba(144,141,206,0.18)",
                        color: "rgba(197,203,232,0.45)",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = "rgba(144,141,206,0.30)";
                        e.currentTarget.style.color = "#C5CBE8";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = "rgba(144,141,206,0.18)";
                        e.currentTarget.style.color = "rgba(197,203,232,0.45)";
                      }}
                    >
                      <Share2 className="h-3.5 w-3.5" />
                      {copied ? "Copied!" : "Share"}
                    </button>
                  </div>
                </div>
              </div>

              <div
                className="mt-4 rounded-2xl p-5"
                style={{
                  background: "linear-gradient(180deg, rgba(22,23,38,0.68), rgba(10,11,18,0.82))",
                  border: "1px solid rgba(144,141,206,0.15)",
                  boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
                }}
              >
                <p
                  className="mb-4 text-xs font-semibold uppercase tracking-widest"
                  style={{ color: "rgba(197,203,232,0.30)" }}
                >
                  Role Details
                </p>
                <div className="space-y-3">
                  {[
                    { icon: Building2, label: "Team", value: position.department },
                    { icon: MapPin, label: "Location", value: position.location || "Bengaluru, India" },
                    { icon: Globe, label: "Work Mode", value: position.workMode || "Hybrid" },
                    { icon: Briefcase, label: "Experience Level", value: position.experienceLevel || "Mid level (3-5 yrs)" },
                    { icon: Briefcase, label: "Experience", value: experienceYearsLabel(position.experienceYears) },
                    { icon: Clock, label: "Type", value: position.employmentType || "Full-time" },
                    { icon: Users, label: "Openings", value: String(openings || 1) },
                  ].map((item) => {
                    const Icon = item.icon;
                    return item.value ? (
                      <div key={item.label} className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-xs" style={{ color: "rgba(197,203,232,0.35)" }}>
                          <Icon className="h-3.5 w-3.5" />
                          {item.label}
                        </div>
                        <span className="text-xs font-medium" style={{ color: "rgba(197,203,232,0.75)" }}>{item.value}</span>
                      </div>
                    ) : null;
                  })}
                </div>
              </div>

              <div
                className="mt-4 rounded-2xl p-5"
                style={{
                  background: "linear-gradient(180deg, rgba(31,24,48,0.62), rgba(13,14,24,0.84))",
                  border: "1px solid rgba(144,141,206,0.14)",
                  boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
                }}
              >
                <p className="text-xs font-medium" style={{ color: "rgba(144,141,206,0.70)" }}>About the Team</p>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: "rgba(197,203,232,0.50)" }}>
                  {position.department} at Ethara is a small, high-velocity team focused on
                  shipping quality work and making decisions with clarity.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PageShell>
  );
}


function ContentCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div
      className="careers-reveal relative overflow-hidden rounded-2xl p-6 transition-all duration-300"
      style={{
        background: "linear-gradient(180deg, rgba(22,23,38,0.66), rgba(10,11,18,0.82))",
        border: "1px solid rgba(144,141,206,0.15)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "rgba(237,0,237,0.28)";
        e.currentTarget.style.boxShadow = "0 20px 48px rgba(0,0,0,0.30), 0 0 0 1px rgba(237,0,237,0.08), inset 0 1px 0 rgba(255,255,255,0.05)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "rgba(144,141,206,0.15)";
        e.currentTarget.style.boxShadow = "0 12px 32px rgba(0,0,0,0.18)";
      }}
    >
      <div
        className="absolute inset-x-0 top-0 h-px opacity-70"
        style={{ background: "linear-gradient(90deg, rgba(237,0,237,0.44), rgba(144,141,206,0.20), transparent)" }}
      />
      <div className="mb-5 flex items-center gap-2.5">
        <Icon className="h-4 w-4" style={{ color: "rgba(237,0,237,0.65)" }} />
        <h2 className="text-sm font-semibold" style={{ color: "rgba(197,203,232,0.85)" }}>{title}</h2>
      </div>
      {children}
    </div>
  );
}


function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen overflow-x-hidden antialiased" style={{ background: "var(--background)", color: "var(--foreground)" }}>
      {children}
    </div>
  );
}
