"use client";

import Image from "next/image";
import Link from "next/link";
import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight, Bookmark, Briefcase, Calculator, Clock, Code2,
  ExternalLink, FileText, FlaskConical, Globe, MapPin, Megaphone, Search, Server, Settings2,
  Sparkles, TrendingUp, Users, X, Zap, type LucideIcon,
  Upload,
} from "lucide-react";
import { careerApplicationsApi, positionsApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { cn, formatStableDate, getDefaultRouteForRole } from "@/lib/utils";
import type { Position } from "@/types";

const TEAMS: { name: string; desc: string; icon: LucideIcon }[] = [
  { name: "Accounts & Admin", desc: "Keeps finance, administration, and business operations moving smoothly every day.", icon: Calculator },
  { name: "Communications and Partnerships", desc: "Builds the brand, shapes the narrative, and grows high-trust external relationships.", icon: Megaphone },
  { name: "Engineering", desc: "Designs and ships the product systems that power the Ethara experience.", icon: Code2 },
  { name: "Growth", desc: "Drives demand, experimentation, and expansion across channels and markets.", icon: TrendingUp },
  { name: "Human Resources", desc: "Supports hiring, people operations, culture, and employee success across the company.", icon: Users },
  { name: "IT", desc: "Manages infrastructure, access, devices, and day-to-day technical support.", icon: Server },
  { name: "Operations - Technical", desc: "Turns technical operations into repeatable systems, coordination, and reliable delivery.", icon: Settings2 },
  { name: "Operations - Generalist", desc: "Keeps cross-functional operations moving with practical coordination and execution.", icon: Settings2 },
  { name: "R&D", desc: "Explores new ideas, prototypes capabilities, and advances applied AI for the platform.", icon: FlaskConical },
];

const RESUME_ACCEPT =
  ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const RESUME_EXTENSIONS = [".pdf", ".doc", ".docx"];
const MAX_RESUME_SIZE_BYTES = 10 * 1024 * 1024;
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


function applyHref(positionId: string): string {
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

function normalizeApplicationPhone(value: string): string {
  return value.replace(/\D/g, "").slice(0, 10);
}

function CareersPageContent() {
  const { isAuthenticated, user } = useAuth();
  const [positions, setPositions] = useState<Position[]>([]);
  const [search, setSearch] = useState("");
  const [activeDepartment, setActiveDepartment] = useState("All");
  const [activeWorkMode, setActiveWorkMode] = useState("All");
  const [isLoading, setIsLoading] = useState(true);
  const [savedJobs, setSavedJobs] = useState<Set<string>>(new Set());
  const [scrolled, setScrolled] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [applicationName, setApplicationName] = useState("");
  const [applicationEmail, setApplicationEmail] = useState("");
  const [applicationPhone, setApplicationPhone] = useState("");
  const [applicationLinkedinUrl, setApplicationLinkedinUrl] = useState("");
  const [applicationPortfolioUrl, setApplicationPortfolioUrl] = useState("");
  const [applicationGithubUrl, setApplicationGithubUrl] = useState("");
  const [applicationResume, setApplicationResume] = useState<File | null>(null);
  const [applicationStatus, setApplicationStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [applicationMessage, setApplicationMessage] = useState("");
  const [resumeDragActive, setResumeDragActive] = useState(false);
  const [fromLoggedInAccount, setFromLoggedInAccount] = useState(false);
  const rolesRef = useRef<HTMLDivElement>(null);
  const heroLogoRef = useRef<HTMLDivElement>(null);
  const applicationFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    positionsApi
      .publicList()
      .then((data) => setPositions(Array.isArray(data) ? data : []))
      .catch(() => setPositions([]))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    setFromLoggedInAccount(new URLSearchParams(window.location.search).get("from") === "internal");
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const departments = useMemo(
    () => ["All", ...Array.from(new Set(positions.map((p) => p.department))).sort()],
    [positions]
  );

  const workModes = useMemo(() => {
    const modes = Array.from(new Set(positions.map((p) => p.workMode).filter(Boolean))) as string[];
    return ["All", ...modes.sort()];
  }, [positions]);

  const filteredPositions = useMemo(() => {
    const term = search.trim().toLowerCase();
    return positions.filter((p) => {
      const matchDept = activeDepartment === "All" || p.department === activeDepartment;
      const matchMode = activeWorkMode === "All" || p.workMode === activeWorkMode;
      const matchSearch = !term ||
        p.title.toLowerCase().includes(term) ||
        (p.description || p.summary || "").toLowerCase().includes(term) ||
        (p.location || "").toLowerCase().includes(term) ||
        (p.department || "").toLowerCase().includes(term);
      return matchDept && matchMode && matchSearch;
    });
  }, [activeDepartment, activeWorkMode, positions, search]);

  const featured = positions.filter((p) => p.featured).slice(0, 2);

  const toggleSave = (id: string) => {
    setSavedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const hasActiveFilters = activeDepartment !== "All" || activeWorkMode !== "All" || search.trim();
  const showPortalEntry = Boolean(isAuthenticated && user && (user.role === "candidate" || fromLoggedInAccount));
  const portalHref = user ? getDefaultRouteForRole(user.role) : "/login";
  const authActionHref = showPortalEntry ? portalHref : "/login";
  const authActionLabel = showPortalEntry ? "My Portal" : "Sign In";

  // The hero mark now spins on its own (see .careers-hero-logo) — it no longer
  // tracks the cursor, so the parallax pointer handlers were removed.

  const scrollToRoles = () => {
    rolesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const scrollToSection = (sectionId: string) => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth" });
  };

  const resetApplicationFile = () => {
    setApplicationResume(null);
    if (applicationFileRef.current) {
      applicationFileRef.current.value = "";
    }
  };

  const handleResumeFile = (file?: File) => {
    if (!file) return;
    const extension = file.name.includes(".")
      ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase()
      : "";
    if (!RESUME_EXTENSIONS.includes(extension)) {
      resetApplicationFile();
      setApplicationStatus("error");
      setApplicationMessage("Please upload a PDF, DOC, or DOCX resume.");
      return;
    }
    if (file.size > MAX_RESUME_SIZE_BYTES) {
      resetApplicationFile();
      setApplicationStatus("error");
      setApplicationMessage("Resume must be 10 MB or smaller.");
      return;
    }
    setApplicationResume(file);
    setApplicationStatus("idle");
    setApplicationMessage("");
  };

  const handleResumeInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleResumeFile(event.target.files?.[0]);
  };

  const handleResumeDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setResumeDragActive(false);
    handleResumeFile(event.dataTransfer.files?.[0]);
  };

  const handleGeneralApplicationSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!applicationResume) {
      setApplicationStatus("error");
      setApplicationMessage("Please upload your resume.");
      return;
    }
    const phone = normalizeApplicationPhone(applicationPhone);
    if (phone.length !== 10) {
      setApplicationStatus("error");
      setApplicationMessage("Enter a valid 10-digit phone number.");
      return;
    }
    if (!applicationLinkedinUrl.trim()) {
      setApplicationStatus("error");
      setApplicationMessage("LinkedIn profile is required.");
      return;
    }

    setApplicationStatus("submitting");
    setApplicationMessage("");
    const payload = new FormData();
    payload.append("fullName", applicationName.trim());
    payload.append("email", applicationEmail.trim());
    payload.append("phone", phone);
    payload.append("linkedinUrl", applicationLinkedinUrl.trim());
    if (applicationPortfolioUrl.trim()) {
      payload.append("portfolioUrl", applicationPortfolioUrl.trim());
    }
    if (applicationGithubUrl.trim()) {
      payload.append("githubUrl", applicationGithubUrl.trim());
    }
    payload.append("resume", applicationResume);

    try {
      await careerApplicationsApi.submit(payload);
      setApplicationName("");
      setApplicationEmail("");
      setApplicationPhone("");
      setApplicationLinkedinUrl("");
      setApplicationPortfolioUrl("");
      setApplicationGithubUrl("");
      resetApplicationFile();
      setApplicationStatus("success");
      setApplicationMessage("Thanks. Your profile has been submitted.");
    } catch (error) {
      const apiError = error as { response?: { data?: { detail?: string } } };
      setApplicationStatus("error");
      setApplicationMessage(apiError.response?.data?.detail ?? "Could not submit your profile. Please try again.");
    }
  };

  return (
    <div className="min-h-screen antialiased" style={{ background: "var(--background)", color: "var(--foreground)" }}>

      <nav
        className={cn(
          "sticky top-0 z-50 w-full transition-all duration-300",
          scrolled ? "shadow-[0_1px_0_rgba(144,141,206,0.12)]" : ""
        )}
        style={{
          background: scrolled ? "rgba(10,11,18,0.88)" : "transparent",
          backdropFilter: scrolled ? "blur(22px)" : "none",
          borderBottom: scrolled ? "1px solid rgba(144,141,206,0.14)" : "1px solid transparent",
        }}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 lg:px-10">
          <Link href="/careers" className="flex items-center">
            <Image src="/logo.png" alt="Ethara.AI" width={120} height={34} className="object-contain" style={{ width: "auto", height: "auto" }} priority />
          </Link>

          <div className="hidden items-center gap-1 md:flex">
            <button
              type="button"
              onClick={scrollToRoles}
              className="rounded-lg px-3 py-1.5 text-sm transition-all duration-200"
              style={{ color: "rgba(197,203,232,0.55)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(144,141,206,0.08)";
                e.currentTarget.style.color = "#C5CBE8";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "rgba(197,203,232,0.55)";
              }}
            >
              Jobs
            </button>
            <button
              type="button"
              onClick={() => setTeamsOpen(true)}
              className="rounded-lg px-3 py-1.5 text-sm transition-all duration-200"
              style={{ color: "rgba(197,203,232,0.55)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(144,141,206,0.08)";
                e.currentTarget.style.color = "#C5CBE8";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "rgba(197,203,232,0.55)";
              }}
            >
              Teams
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("culture")}
              className="rounded-lg px-3 py-1.5 text-sm transition-all duration-200"
              style={{ color: "rgba(197,203,232,0.55)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(144,141,206,0.08)";
                e.currentTarget.style.color = "#C5CBE8";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "rgba(197,203,232,0.55)";
              }}
            >
              Culture
            </button>
          </div>

          <div className="flex items-center gap-3">
            {showPortalEntry ? (
              <Link href={authActionHref}>
                <button
                  className="h-8 rounded-full px-4 text-xs font-semibold text-white transition-all duration-200"
                  style={{
                    backgroundImage: "linear-gradient(135deg, #ED00ED 0%, #908DCE 100%)",
                    backgroundSize: "160% 160%",
                    animation: "brandGradientMove 9s ease infinite",
                    boxShadow: "0 8px 18px rgba(0,0,0,0.24)",
                  }}
                >
                  {authActionLabel}
                </button>
              </Link>
            ) : (
              <Link href={authActionHref}>
                <button
                  className="h-8 rounded-full px-4 text-xs font-medium transition-all duration-200"
                  style={{
                    background: "rgba(144,141,206,0.08)",
                    border: "1px solid rgba(144,141,206,0.22)",
                    color: "rgba(197,203,232,0.7)",
                  }}
                >
                  {authActionLabel}
                </button>
              </Link>
            )}
          </div>
        </div>

        <div
          className="mx-auto flex max-w-7xl items-center gap-1 px-6 pb-2 md:hidden overflow-x-auto"
          style={{ borderTop: "1px solid rgba(144,141,206,0.08)" }}
        >
          <button
            type="button"
            onClick={scrollToRoles}
            className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200"
            style={{ color: "rgba(197,203,232,0.55)" }}
          >
            Jobs
          </button>
          <button
            type="button"
            onClick={() => setTeamsOpen(true)}
            className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200"
            style={{ color: "rgba(197,203,232,0.55)" }}
          >
            Teams
          </button>
          <button
            type="button"
            onClick={() => scrollToSection("culture")}
            className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200"
            style={{ color: "rgba(197,203,232,0.55)" }}
          >
            Culture
          </button>
        </div>
      </nav>

      <section
        className="relative min-h-[calc(100svh-4rem)] overflow-hidden pt-14 pb-16 lg:flex lg:items-center lg:pt-16 lg:pb-14"
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 overflow-hidden">
            <div
              className="absolute inset-0"
              style={{
                background: "linear-gradient(145deg, #08080e 0%, #0b0c14 52%, #090a11 100%)",
              }}
            />
          </div>

          <div
            className="absolute inset-0"
            style={{ background: "rgba(8,8,14,0.84)" }}
          />

          <div
            className="absolute inset-0"
            style={{
              background: [
                "radial-gradient(ellipse 76% 42% at 50% -8%, rgba(237,0,237,0.028) 0%, transparent 68%)",
                "radial-gradient(ellipse 54% 38% at 82% 46%, rgba(144,141,206,0.022) 0%, transparent 64%)",
                "radial-gradient(ellipse 46% 34% at 8% 62%, rgba(124,111,205,0.014) 0%, transparent 64%)",
              ].join(", "),
              animation: "professionalGlowDrift 16s ease-in-out infinite",
            }}
          />

          <div
            className="absolute inset-x-0 top-0 h-32"
            style={{ background: "linear-gradient(to bottom, rgba(8,8,14,0.60) 0%, transparent 100%)" }}
          />

          <div
            className="absolute inset-x-0 bottom-0 h-48"
            style={{ background: "linear-gradient(to bottom, transparent 0%, rgba(10,11,18,0.90) 60%, #0A0B12 100%)" }}
          />

          <div
            className="careers-grid-pan absolute inset-0 opacity-[0.030]"
            style={{
              backgroundImage: "linear-gradient(rgba(144,141,206,1) 1px, transparent 1px), linear-gradient(90deg, rgba(144,141,206,1) 1px, transparent 1px)",
              backgroundSize: "72px 72px",
            }}
          />
          <div className="hero-signal-plane absolute inset-0" />

          <div
            className="hero-light-ray hero-light-ray-1 absolute inset-0"
            style={{
              background: "linear-gradient(105deg, transparent 20%, rgba(237,0,237,0.008) 45%, rgba(144,141,206,0.012) 50%, rgba(237,0,237,0.008) 55%, transparent 80%)",
              width: "200%",
              left: "-50%",
            }}
          />

          <div
            className="hero-light-ray hero-light-ray-2 absolute inset-0"
            style={{
              background: "linear-gradient(75deg, transparent 15%, rgba(144,141,206,0.006) 40%, rgba(197,203,232,0.010) 50%, rgba(144,141,206,0.006) 60%, transparent 85%)",
              width: "200%",
              left: "-50%",
            }}
          />

          <div
            className="absolute left-0 top-[58%] h-px w-[70%]"
            style={{
              background: "linear-gradient(90deg, transparent, rgba(237,0,237,0.14), rgba(144,141,206,0.12), transparent)",
              animation: "accentLineSweep 20s ease-in-out infinite",
            }}
          />
        </div>

        <div className="relative mx-auto grid w-full max-w-7xl items-center gap-10 px-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(360px,0.68fr)] lg:px-10">
          <div
            className="absolute -inset-y-8 left-6 max-w-3xl rounded-3xl pointer-events-none lg:left-10"
            style={{
              background: "radial-gradient(ellipse 100% 100% at 32% 50%, rgba(8,8,14,0.68) 0%, transparent 72%)",
              filter: "blur(24px)",
            }}
          />
          <div className="relative z-10 max-w-4xl">
          <h1
            className="relative max-w-4xl animate-slide-up text-5xl font-semibold tracking-normal text-white sm:text-6xl lg:text-7xl"
            style={{ lineHeight: 1.08 }}
          >
            AGI is not born.{" "}
            <br />
            <span
              style={{
                background: "linear-gradient(135deg, #ED00ED 0%, #908DCE 55%, #C5CBE8 100%)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
                color: "transparent",
                filter: "drop-shadow(0 10px 24px rgba(0,0,0,0.28))",
              }}
            >
              It is trained.
            </span>
          </h1>

          <p
            className="relative mt-6 max-w-2xl animate-slide-up text-base leading-relaxed sm:text-lg"
            style={{ color: "rgba(197,203,232,0.74)", lineHeight: "1.7", textShadow: "0 1px 12px rgba(0,0,0,0.68)", animationDelay: "80ms" }}
          >
            Ethara.AI operates at the frontier of next-generation intelligence
            training. We design reinforcement learning environments, feedback
            systems, and evaluation pipelines that bridge the gap of AGI.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3 animate-slide-up" style={{ animationDelay: "140ms" }}>
            <button
              onClick={scrollToRoles}
              className="inline-flex h-11 items-center gap-2.5 rounded-lg px-6 text-sm font-semibold text-white transition-all duration-200 active:scale-95"
              style={{
                backgroundImage: "linear-gradient(135deg, #ED00ED 0%, #908DCE 100%)",
                backgroundSize: "160% 160%",
                animation: "brandGradientMove 9s ease infinite",
                boxShadow: "0 10px 24px rgba(0,0,0,0.24)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 12px 28px rgba(0,0,0,0.30)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 10px 24px rgba(0,0,0,0.24)"; }}
            >
              View Open Roles
              <ArrowRight className="h-4 w-4" />
            </button>
            <a
              href="#culture"
              className="inline-flex h-11 items-center gap-2.5 rounded-lg px-6 text-sm font-medium transition-all duration-200"
              style={{
                background: "rgba(144,141,206,0.08)",
                border: "1px solid rgba(144,141,206,0.28)",
                color: "rgba(197,203,232,0.80)",
                backdropFilter: "blur(12px)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(237,0,237,0.10)";
                e.currentTarget.style.borderColor = "rgba(237,0,237,0.35)";
                e.currentTarget.style.color = "#ffffff";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(144,141,206,0.08)";
                e.currentTarget.style.borderColor = "rgba(144,141,206,0.28)";
                e.currentTarget.style.color = "rgba(197,203,232,0.80)";
              }}
            >
              Life at Ethara
            </a>
          </div>
          </div>

          <div className="relative z-10 hidden min-h-[520px] lg:block">
            <div
              className="absolute inset-y-0 right-0 w-full overflow-hidden"
            >
              <div
                className="absolute inset-0"
                style={{
                  background: "radial-gradient(ellipse 62% 58% at 52% 46%, rgba(144,141,206,0.12), transparent 66%), radial-gradient(ellipse 54% 48% at 58% 62%, rgba(237,0,237,0.045), transparent 70%)",
                }}
              />
              <div
                className="careers-grid-pan absolute inset-0 opacity-[0.042]"
                style={{
                  backgroundImage: "linear-gradient(rgba(197,203,232,1) 1px, transparent 1px), linear-gradient(90deg, rgba(197,203,232,1) 1px, transparent 1px)",
                  backgroundSize: "36px 36px",
                }}
              />
              <div
                ref={heroLogoRef}
                className="careers-logo-stage careers-logo-follow absolute inset-0 flex items-center justify-center px-12"
                onContextMenu={(event) => event.preventDefault()}
              >
                <Image
                  src="/ethara-mark-animation.svg"
                  alt="Ethara.AI animated logo"
                  width={340}
                  height={337}
                  priority
                  unoptimized
                  draggable={false}
                  onDragStart={(event) => event.preventDefault()}
                  className="brand-animation-asset careers-hero-logo h-auto w-[min(62%,310px)]"
                />
              </div>
              <div
                className="absolute inset-x-14 top-20 h-px"
                style={{ background: "linear-gradient(90deg, transparent, rgba(237,0,237,0.20), rgba(144,141,206,0.16), transparent)" }}
              />
              <div
                className="absolute bottom-16 left-16 right-20 h-px"
                style={{ background: "linear-gradient(90deg, rgba(237,0,237,0.14), rgba(144,141,206,0.12), transparent)" }}
              />
              <div
                className="absolute left-16 top-20 h-[64%] w-px"
                style={{ background: "linear-gradient(180deg, rgba(237,0,237,0.16), rgba(144,141,206,0.10), transparent)" }}
              />
            </div>
          </div>

          <div className="relative z-10 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:col-span-2" style={{ animationDelay: "210ms" }}>
            <InfoCard
              icon={Briefcase}
              title="Job Openings"
              text="Explore current roles across Ethara.AI."
              buttonLabel="View Jobs"
              onButtonClick={scrollToRoles}
            />
            <InfoCard
              icon={Users}
              title="Teams"
              text="Work with cross-functional AI and operations teams."
              buttonLabel="View Teams"
              onButtonClick={() => setTeamsOpen(true)}
            />
            <InfoCard
              icon={MapPin}
              title="Location"
              text="Our current hiring location is Gurugram."
              buttonLabel="View Location"
              onButtonClick={() => setLocationOpen(true)}
            />
          </div>
        </div>
      </section>

      {featured.length > 0 && (
        <section className="relative mx-auto max-w-7xl px-4 pb-10 sm:px-6 lg:px-10">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-4 w-4" style={{ color: "#ED00ED" }} />
            <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: "rgba(237,0,237,0.7)" }}>
              Featured Openings
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {featured.map((pos) => (
              <div
                key={pos.id}
                className="careers-reveal group relative overflow-hidden rounded-2xl p-5 transition-all duration-300 sm:p-7"
                style={{
                  background: "linear-gradient(135deg, rgba(30,18,45,0.92) 0%, rgba(17,18,32,0.92) 55%, rgba(10,11,18,0.96) 100%)",
                  border: "1px solid rgba(144,141,206,0.20)",
                  backdropFilter: "blur(18px)",
                  boxShadow: "0 18px 48px rgba(0,0,0,0.28)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "rgba(237,0,237,0.35)";
                  e.currentTarget.style.boxShadow = "0 24px 58px rgba(0,0,0,0.34), 0 0 0 1px rgba(237,0,237,0.12), inset 0 1px 0 rgba(255,255,255,0.06)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "rgba(144,141,206,0.20)";
                  e.currentTarget.style.boxShadow = "0 18px 48px rgba(0,0,0,0.28)";
                }}
              >
                <div
                  className="absolute inset-x-0 top-0 h-px"
                  style={{ background: "linear-gradient(90deg, rgba(237,0,237,0.72), rgba(144,141,206,0.32), transparent)" }}
                />
                <div className="relative">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <span
                      className="max-w-[calc(100%-7rem)] rounded-full px-3 py-1 text-[11px] font-medium leading-snug"
                      style={{ background: "rgba(237,0,237,0.12)", border: "1px solid rgba(237,0,237,0.25)", color: "#ED00ED" }}
                    >
                      {pos.department}
                    </span>
                    <span
                      className="shrink-0 rounded-full px-3 py-1 text-[11px] font-medium"
                      style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.25)", color: "#fbbf24" }}
                    >
                      <Sparkles className="h-3 w-3 inline-block align-middle mr-0.5" /> Featured
                    </span>
                  </div>
                  <h3 className="mt-4 break-words text-xl font-semibold text-white">{pos.title}</h3>
                  <p className="mt-2 line-clamp-2 break-words text-sm" style={{ color: "rgba(197,203,232,0.62)" }}>{pos.description || pos.summary}</p>
                  <div className="mt-4 flex flex-wrap gap-3 text-xs" style={{ color: "rgba(197,203,232,0.62)" }}>
                    {pos.location && <span className="flex min-w-0 items-center gap-1 break-words"><MapPin className="h-3 w-3 shrink-0" />{pos.location}</span>}
                    {pos.workMode && <span className="flex min-w-0 items-center gap-1 break-words"><Globe className="h-3 w-3 shrink-0" />{pos.workMode}</span>}
                    {pos.employmentType && <span className="flex min-w-0 items-center gap-1 break-words"><Clock className="h-3 w-3 shrink-0" />{pos.employmentType}</span>}
                    {pos.experienceYears != null && <span className="flex min-w-0 items-center gap-1 break-words"><Briefcase className="h-3 w-3 shrink-0" />{experienceYearsLabel(pos.experienceYears)}</span>}
                  </div>
                  <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                    <Link href={`/careers/${pos.slug || pos.id}`} className="min-w-0 flex-1">
                      <button
                        className="h-9 w-full rounded-lg px-4 text-xs font-semibold text-white transition-all duration-200"
                        style={{ backgroundImage: "linear-gradient(135deg, #ED00ED, #908DCE)", backgroundSize: "160% 160%", animation: "brandGradientMove 9s ease infinite", boxShadow: "0 10px 22px rgba(0,0,0,0.22)" }}
                      >
                        View Role
                      </button>
                    </Link>
                    <Link href={isAuthenticated && user?.role === "candidate" ? `/portal/application?positionId=${pos.id}` : applyHref(pos.id)} className="min-w-0 flex-1">
                      <button
                        className="h-9 w-full rounded-lg border px-4 text-xs transition-all duration-200"
                        style={{ background: "rgba(144,141,206,0.08)", border: "1px solid rgba(144,141,206,0.25)", color: "rgba(197,203,232,0.75)" }}
                      >
                        Apply Now
                      </button>
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section
        id="open-roles"
        ref={rolesRef}
        className="relative isolate mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-10"
      >
        <div className="sticky top-14 z-30 py-4 sm:top-16">
        <div
          className="overflow-hidden rounded-2xl p-3 sm:p-4"
          style={{
            background: "linear-gradient(135deg, rgba(16,17,28,0.94), rgba(9,10,18,0.96))",
            backdropFilter: "blur(30px)",
            border: "1px solid rgba(144,141,206,0.20)",
            boxShadow: "0 18px 46px rgba(0,0,0,0.42)",
          }}
        >
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "rgba(197,203,232,0.30)" }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search roles, teams, locations…"
                className="h-10 w-full min-w-0 rounded-xl pl-10 pr-10 text-[16px] transition-all duration-200 focus:outline-none sm:text-sm"
                style={{
                  background: "rgba(144,141,206,0.07)",
                  border: "1px solid rgba(144,141,206,0.18)",
                  color: "#C5CBE8",
                }}
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: "rgba(197,203,232,0.30)" }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2 self-start text-xs sm:self-auto" style={{ color: "rgba(197,203,232,0.62)" }}>
              <span>{filteredPositions.length} role{filteredPositions.length !== 1 ? "s" : ""}</span>
            </div>
          </div>

          <div className="mt-3 flex max-w-full flex-wrap gap-2 overflow-hidden">
            {departments.map((dept) => (
              <button
                key={dept}
                onClick={() => setActiveDepartment(dept)}
                className="max-w-full whitespace-normal break-words rounded-full px-3 py-1 text-left text-xs font-medium leading-snug transition-all duration-200"
                style={activeDepartment === dept ? {
                  background: "rgba(237,0,237,0.15)",
                  border: "1px solid rgba(237,0,237,0.40)",
                  color: "#ED00ED",
                  boxShadow: "0 0 10px rgba(237,0,237,0.12)",
                } : {
                  background: "rgba(144,141,206,0.06)",
                  border: "1px solid rgba(144,141,206,0.15)",
                  color: "rgba(197,203,232,0.62)",
                }}
              >
                {dept}
              </button>
            ))}

            {workModes.length > 1 && (
              <span className="my-auto hidden h-4 w-px sm:block" style={{ background: "rgba(144,141,206,0.15)" }} />
            )}

            {workModes.length > 1 && workModes.map((mode) => (
              <button
                key={mode}
                onClick={() => setActiveWorkMode(mode)}
                className="max-w-full whitespace-normal break-words rounded-full px-3 py-1 text-left text-xs font-medium leading-snug transition-all duration-200"
                style={activeWorkMode === mode ? {
                  background: "rgba(144,141,206,0.18)",
                  border: "1px solid rgba(144,141,206,0.40)",
                  color: "#908DCE",
                } : {
                  background: "rgba(144,141,206,0.06)",
                  border: "1px solid rgba(144,141,206,0.15)",
                  color: "rgba(197,203,232,0.62)",
                }}
              >
                {mode === "All" ? "All modes" : mode}
              </button>
            ))}

            {hasActiveFilters && (
              <button
                onClick={() => { setSearch(""); setActiveDepartment("All"); setActiveWorkMode("All"); }}
                className="flex max-w-full items-center gap-1 rounded-full px-3 py-1 text-xs transition-all duration-200"
                style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.22)", color: "#f87171" }}
              >
                <X className="h-3 w-3" /> Clear
              </button>
            )}
          </div>
        </div>
        </div>

        <div className="py-8">
          {isLoading ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-52 rounded-2xl animate-pulse"
                  style={{ background: "rgba(144,141,206,0.05)", border: "1px solid rgba(144,141,206,0.10)" }}
                />
              ))}
            </div>
          ) : filteredPositions.length === 0 ? (
            <div
              className="rounded-2xl border-dashed py-20 text-center"
              style={{ border: "1px dashed rgba(144,141,206,0.15)", background: "rgba(144,141,206,0.03)" }}
            >
              <p style={{ color: "rgba(197,203,232,0.62)" }}>No roles match your search.</p>
              <button
                onClick={() => { setSearch(""); setActiveDepartment("All"); setActiveWorkMode("All"); }}
                className="mt-3 text-sm transition-colors"
                style={{ color: "#ED00ED" }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredPositions.map((pos) => (
                <JobCard
                  key={pos.id}
                  position={pos}
                  isSaved={savedJobs.has(pos.id)}
                  onSave={() => toggleSave(pos.id)}
                  applyUrl={isAuthenticated && user?.role === "candidate" ? `/portal/application?positionId=${pos.id}` : applyHref(pos.id)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section id="culture" className="relative mt-8 overflow-hidden py-24" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.018), rgba(237,0,237,0.018), rgba(255,255,255,0.012))", borderTop: "1px solid rgba(144,141,206,0.10)" }}>
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent, rgba(237,0,237,0.46), rgba(144,141,206,0.26), transparent)" }}
        />
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <div className="mb-12 text-center">
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "rgba(237,0,237,0.60)" }}>Why Ethara.ai</p>
            <h2 className="mx-auto mt-3 max-w-3xl text-3xl font-semibold sm:text-4xl" style={{ color: "#C5CBE8" }}>Build intelligence systems with real-world impact.</h2>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: FlaskConical, title: "Research-First Mindset", desc: "Be part of a culture driven by experimentation, deep thinking, and frontier research, where solving hard intelligence problems comes before chasing trends." },
              { icon: Server, title: "Direct Impact on Global Technology", desc: "Be part of building the foundational infrastructure powering some of the world's most advanced AI models." },
              { icon: Globe, title: "India-First, Globally Competitive", desc: "Help build a world-class AI company from Bharat, proving that breakthrough innovation can originate here and scale globally." },
              { icon: Zap, title: "High Ownership, Early Responsibility", desc: "Take on meaningful work from day one, with the autonomy to drive outcomes and influence real-world systems." },
              { icon: Sparkles, title: "Learn at the Frontier", desc: "Gain exposure to cutting-edge developments in AI, including model training, evaluation, and post-training systems." },
              { icon: Users, title: "Shape the Future of AI", desc: "Work at the forefront of intelligence systems, contributing to how next-generation AI models are trained, aligned, evaluated, and improved." },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="careers-reveal group relative overflow-hidden rounded-2xl p-6 transition-all duration-300"
                  style={{
                    background: "linear-gradient(180deg, rgba(25,24,44,0.58), rgba(12,13,23,0.72))",
                    border: "1px solid rgba(144,141,206,0.15)",
                    boxShadow: "0 16px 42px rgba(0,0,0,0.22)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "rgba(237,0,237,0.28)";
                    e.currentTarget.style.background = "linear-gradient(180deg, rgba(39,25,58,0.68), rgba(14,15,25,0.78))";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "rgba(144,141,206,0.14)";
                    e.currentTarget.style.background = "linear-gradient(180deg, rgba(25,24,44,0.58), rgba(12,13,23,0.72))";
                  }}
                >
                  <div
                    className="absolute inset-x-0 top-0 h-px opacity-70"
                    style={{ background: "linear-gradient(90deg, rgba(237,0,237,0.50), rgba(144,141,206,0.18), transparent)" }}
                  />
                  <div
                    className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl"
                    style={{
                      background: "rgba(237,0,237,0.10)",
                      border: "1px solid rgba(237,0,237,0.22)",
                    }}
                  >
                    <Icon className="h-5 w-5" style={{ color: "#ED00ED" }} />
                  </div>
                  <h3 className="font-semibold" style={{ color: "#C5CBE8" }}>{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed" style={{ color: "rgba(197,203,232,0.62)" }}>{item.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="py-20" style={{ borderTop: "1px solid rgba(144,141,206,0.10)" }}>
        <div className="relative mx-auto max-w-4xl px-6 text-center">
          <div
            className="pointer-events-none absolute inset-x-12 top-0 h-32 opacity-60"
            style={{
              background: "radial-gradient(ellipse at 50% 0%, rgba(237,0,237,0.08), transparent 68%)",
              animation: "professionalGlowDrift 14s ease-in-out infinite",
            }}
          />
          <div className="relative z-10">
            <h2 className="text-2xl font-semibold sm:text-[1.7rem]" style={{ color: "#C5CBE8" }}>Don&apos;t see a role that matches your profile?</h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6" style={{ color: "rgba(197,203,232,0.62)" }}>
              Share your details with us. If your experience aligns with our upcoming opportunities, our team will reach out.
            </p>
            <form
              onSubmit={handleGeneralApplicationSubmit}
              className="mx-auto mt-7 max-w-3xl rounded-2xl p-4 text-left sm:p-6"
              style={{
                background: "linear-gradient(145deg, rgba(25,24,44,0.90), rgba(10,11,18,0.94))",
                border: "1px solid rgba(144,141,206,0.20)",
                boxShadow: "0 24px 70px rgba(0,0,0,0.36), inset 0 1px 0 rgba(255,255,255,0.04)",
                backdropFilter: "blur(22px)",
              }}
            >
              <div className="grid gap-2.5 md:grid-cols-3">
                <label className="block">
                  <span className="sr-only">Full name</span>
                  <input
                    value={applicationName}
                    onChange={(event) => setApplicationName(event.target.value)}
                    required
                    minLength={2}
                    autoComplete="name"
                    placeholder="Full name"
                    className="h-10 w-full rounded-xl px-3.5 text-sm outline-none transition"
                    style={{
                      background: "rgba(8,8,16,0.65)",
                      border: "1px solid rgba(144,141,206,0.18)",
                      color: "#C5CBE8",
                    }}
                  />
                </label>
                <label className="block">
                  <span className="sr-only">Email</span>
                  <input
                    value={applicationEmail}
                    onChange={(event) => setApplicationEmail(event.target.value)}
                    required
                    type="email"
                    autoComplete="email"
                    placeholder="Email"
                    className="h-10 w-full rounded-xl px-3.5 text-sm outline-none transition"
                    style={{
                      background: "rgba(8,8,16,0.65)",
                      border: "1px solid rgba(144,141,206,0.18)",
                      color: "#C5CBE8",
                    }}
                  />
                </label>
                <label className="block">
                  <span className="sr-only">Phone number</span>
                  <input
                    value={applicationPhone}
                    onChange={(event) => setApplicationPhone(normalizeApplicationPhone(event.target.value))}
                    required
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    pattern="[0-9]{10}"
                    autoComplete="tel"
                    placeholder="10-digit phone number"
                    className="h-10 w-full rounded-xl px-3.5 text-sm outline-none transition"
                    style={{
                      background: "rgba(8,8,16,0.65)",
                      border: "1px solid rgba(144,141,206,0.18)",
                      color: "#C5CBE8",
                    }}
                  />
                </label>
              </div>

              <div className="mt-2.5 space-y-2.5">
                <label className="block">
                  <span className="sr-only">LinkedIn profile</span>
                  <span className="relative block">
                    <ExternalLink
                      className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2"
                      style={{ color: "rgba(197,203,232,0.45)" }}
                    />
                    <input
                      value={applicationLinkedinUrl}
                      onChange={(event) => setApplicationLinkedinUrl(event.target.value)}
                      required
                      type="text"
                      inputMode="url"
                      autoComplete="url"
                      placeholder="LinkedIn profile URL (required)"
                      className="h-10 w-full rounded-xl pl-10 pr-3.5 text-sm outline-none transition"
                      style={{
                        background: "rgba(8,8,16,0.65)",
                        border: "1px solid rgba(144,141,206,0.18)",
                        color: "#C5CBE8",
                      }}
                    />
                  </span>
                </label>
                <div className="grid gap-2.5 md:grid-cols-2">
                  <label className="block">
                    <span className="sr-only">Portfolio URL</span>
                    <span className="relative block">
                      <ExternalLink
                        className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2"
                        style={{ color: "rgba(197,203,232,0.45)" }}
                      />
                      <input
                        value={applicationPortfolioUrl}
                        onChange={(event) => setApplicationPortfolioUrl(event.target.value)}
                        type="text"
                        inputMode="url"
                        autoComplete="url"
                        placeholder="Portfolio URL (optional)"
                        className="h-10 w-full rounded-xl pl-10 pr-3.5 text-sm outline-none transition"
                        style={{
                          background: "rgba(8,8,16,0.65)",
                          border: "1px solid rgba(144,141,206,0.18)",
                          color: "#C5CBE8",
                        }}
                      />
                    </span>
                  </label>
                  <label className="block">
                    <span className="sr-only">GitHub profile</span>
                    <span className="relative block">
                      <ExternalLink
                        className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2"
                        style={{ color: "rgba(197,203,232,0.45)" }}
                      />
                      <input
                        value={applicationGithubUrl}
                        onChange={(event) => setApplicationGithubUrl(event.target.value)}
                        type="text"
                        inputMode="url"
                        autoComplete="url"
                        placeholder="GitHub profile (optional)"
                        className="h-10 w-full rounded-xl pl-10 pr-3.5 text-sm outline-none transition"
                        style={{
                          background: "rgba(8,8,16,0.65)",
                          border: "1px solid rgba(144,141,206,0.18)",
                          color: "#C5CBE8",
                        }}
                      />
                    </span>
                  </label>
                </div>
              </div>

              <label
                onDragOver={(event) => {
                  event.preventDefault();
                  setResumeDragActive(true);
                }}
                onDragLeave={() => setResumeDragActive(false)}
                onDrop={handleResumeDrop}
                className={cn(
                  "mt-3 flex min-h-[118px] cursor-pointer flex-col items-center justify-center rounded-2xl px-4 py-5 text-center transition-all",
                  resumeDragActive && "scale-[1.01]"
                )}
                style={{
                  background: resumeDragActive ? "rgba(237,0,237,0.10)" : "rgba(144,141,206,0.06)",
                  border: resumeDragActive ? "1px solid rgba(237,0,237,0.45)" : "1px dashed rgba(144,141,206,0.30)",
                }}
              >
                <Upload className="h-5 w-5" style={{ color: "#ED00ED" }} />
                <span className="mt-2 max-w-full break-words text-sm font-semibold" style={{ color: "#C5CBE8" }}>
                  {applicationResume ? applicationResume.name : "Drop resume here or click to upload *"}
                </span>
                <span className="mt-1 text-xs" style={{ color: "rgba(197,203,232,0.62)" }}>
                  PDF, DOC, DOCX up to 10 MB · Required
                </span>
                <input
                  ref={applicationFileRef}
                  type="file"
                  accept={RESUME_ACCEPT}
                  required={!applicationResume}
                  className="sr-only"
                  onChange={handleResumeInputChange}
                />
              </label>

              <div className="mt-3.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p
                  className="min-h-5 text-sm"
                  style={{ color: applicationStatus === "success" ? "rgba(34,197,94,0.95)" : "rgba(248,113,113,0.95)" }}
                >
                  {applicationMessage}
                </p>
                <button
                  type="submit"
                  disabled={applicationStatus === "submitting" || !applicationResume}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold text-white transition-all duration-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                  style={{
                    background: "linear-gradient(135deg, #ED00ED 0%, #908DCE 100%)",
                    boxShadow: "0 0 22px rgba(237,0,237,0.34)",
                  }}
                >
                  <FileText className="h-4 w-4" />
                  {applicationStatus === "submitting" ? "Submitting..." : "Submit Profile"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>


      {teamsOpen && (
      <CareersModal title="Our Teams" onClose={() => setTeamsOpen(false)} maxWidth="680px">
        <div>
            <p className="mb-4 text-sm leading-relaxed sm:text-xs" style={{ color: "rgba(197,203,232,0.62)" }}>
              We hire across {TEAMS.length} core teams and shared functions, each contributing a distinct layer to how Ethara builds, scales, and supports its work.
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {TEAMS.map((t, i) => (
                <div
                  key={t.name}
                  className="flex min-w-0 items-start gap-3 rounded-xl px-3.5 py-3 sm:px-4"
                  style={{
                    background: "rgba(144,141,206,0.06)",
                    border: "1px solid rgba(144,141,206,0.12)",
                  }}
                >
                  <div
                    className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg mt-0.5"
                    style={{
                      background: `rgba(${i % 2 === 0 ? "237,0,237" : "144,141,206"},0.10)`,
                      color: i % 2 === 0 ? "#ED00ED" : "#908DCE",
                      border: `1px solid rgba(${i % 2 === 0 ? "237,0,237" : "144,141,206"},0.20)`,
                    }}
                  >
                    <t.icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold leading-snug" style={{ color: "#C5CBE8" }}>{t.name}</p>
                    <p className="mt-1 break-words text-sm leading-relaxed sm:text-xs" style={{ color: "rgba(197,203,232,0.62)" }}>{t.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CareersModal>
      )}

      {locationOpen && (
        <CareersModal title="Hiring Location" onClose={() => setLocationOpen(false)} maxWidth="420px">
          <div className="space-y-4">
            <div
              className="flex items-center gap-4 rounded-2xl px-5 py-4"
              style={{ background: "rgba(237,0,237,0.06)", border: "1px solid rgba(237,0,237,0.18)" }}
            >
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                style={{ background: "rgba(237,0,237,0.12)", border: "1px solid rgba(237,0,237,0.22)" }}
              >
                <MapPin className="h-5 w-5" style={{ color: "#ED00ED" }} />
              </div>
              <div>
                <p className="text-base font-bold" style={{ color: "#C5CBE8" }}>Gurugram, Haryana</p>
                <p className="text-xs mt-0.5" style={{ color: "rgba(197,203,232,0.62)" }}>India — our primary hiring hub</p>
              </div>
            </div>
            <div className="rounded-xl px-4 py-3 space-y-3" style={{ background: "rgba(144,141,206,0.05)", border: "1px solid rgba(144,141,206,0.10)" }}>
              <div className="flex items-start gap-3 text-xs" style={{ color: "rgba(197,203,232,0.62)" }}>
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "rgba(237,0,237,0.78)" }} />
                <span>5th Floor, Plot No. 273, Udyog Vihar Phase 1, Sector 20, Gurugram, Haryana 122016</span>
              </div>
              <div className="flex items-start gap-3 text-xs" style={{ color: "rgba(197,203,232,0.62)" }}>
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "rgba(237,0,237,0.78)" }} />
                <span>301, Udyog Vihar II Rd, Phase II, Udyog Vihar, Sector 20, Gurugram, Haryana 122016</span>
              </div>
            </div>
            <p className="text-xs text-center" style={{ color: "rgba(197,203,232,0.62)" }}>
              We hire in-person and offer flexible arrangements for select roles.
            </p>
          </div>
        </CareersModal>
      )}
    </div>
  );
}

export default function CareersPage() {
  return <CareersPageContent />;
}


function JobCard({
  position,
  isSaved,
  onSave,
  applyUrl,
}: {
  position: Position;
  isSaved: boolean;
  onSave: () => void;
  applyUrl: string;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="careers-reveal group relative flex min-w-0 flex-col overflow-hidden rounded-2xl p-4 transition-all duration-250 sm:p-5"
      style={{
        background: hovered
          ? "linear-gradient(180deg, rgba(31,24,48,0.78), rgba(13,14,24,0.90))"
          : "linear-gradient(180deg, rgba(22,23,38,0.66), rgba(10,11,18,0.82))",
        border: hovered ? "1px solid rgba(237,0,237,0.32)" : "1px solid rgba(144,141,206,0.15)",
        backdropFilter: "blur(18px)",
        boxShadow: hovered ? "0 20px 48px rgba(0,0,0,0.30), 0 0 0 1px rgba(237,0,237,0.10), inset 0 1px 0 rgba(255,255,255,0.05)" : "0 12px 32px rgba(0,0,0,0.18)",
        transform: hovered ? "translateY(-2px)" : "translateY(0)",
        transition: "all 0.25s ease",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className="absolute inset-x-0 top-0 h-px opacity-70"
        style={{ background: "linear-gradient(90deg, rgba(237,0,237,0.44), rgba(144,141,206,0.20), transparent)" }}
      />
      <div className="flex min-w-0 items-start justify-between gap-2">
        <span
          className="max-w-[calc(100%-2.5rem)] truncate rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{
            background: "rgba(237,0,237,0.10)",
            border: "1px solid rgba(237,0,237,0.22)",
            color: "#ED00ED",
          }}
        >
          {position.department}
        </span>
        <button
          onClick={(e) => { e.preventDefault(); onSave(); }}
          className="shrink-0 rounded-lg p-1.5 transition-colors"
          style={{ color: isSaved ? "#ED00ED" : "rgba(197,203,232,0.20)" }}
          aria-label={isSaved ? "Unsave job" : "Save job"}
        >
          <Bookmark className={cn("h-3.5 w-3.5", isSaved && "fill-current")} />
        </button>
      </div>

      <h3
        className="mt-3 break-words text-base font-semibold leading-snug transition-colors duration-200"
        style={{ color: hovered ? "#ffffff" : "#C5CBE8" }}
      >
        {position.title}
      </h3>

      {(position.description || position.summary) && (
        <p className="mt-2 line-clamp-2 break-words text-xs leading-relaxed" style={{ color: "rgba(197,203,232,0.62)" }}>
          {position.description || position.summary}
        </p>
      )}

      <div className="mt-2.5 flex min-w-0 flex-wrap gap-x-3 gap-y-1.5 text-[11px]" style={{ color: "rgba(197,203,232,0.62)" }}>
        {position.location && (
          <span className="flex min-w-0 max-w-full items-center gap-1 break-words">
            <MapPin className="h-3 w-3 shrink-0" />{position.location}
          </span>
        )}
        {position.workMode && (
          <span className="flex min-w-0 max-w-full items-center gap-1 break-words">
            <Globe className="h-3 w-3 shrink-0" />{position.workMode}
          </span>
        )}
        {position.experienceLevel && (
          <span className="flex min-w-0 max-w-full items-center gap-1 break-words">
            <Briefcase className="h-3 w-3 shrink-0" />{position.experienceLevel}
          </span>
        )}
        {position.experienceYears != null && (
          <span className="flex min-w-0 max-w-full items-center gap-1 break-words">
            <Briefcase className="h-3 w-3 shrink-0" />{experienceYearsLabel(position.experienceYears)}
          </span>
        )}
        {position.employmentType && (
          <span className="flex min-w-0 max-w-full items-center gap-1 break-words">
            <Clock className="h-3 w-3 shrink-0" />{position.employmentType}
          </span>
        )}
      </div>

      {position.preferredSkills && position.preferredSkills.length > 0 && (
        <div className="mt-3 flex min-w-0 flex-wrap gap-1.5">
          {position.preferredSkills.slice(0, 4).map((skill) => (
            <span
              key={skill}
              className="max-w-full truncate rounded-md px-2 py-0.5 text-[10px]"
              style={{ background: "rgba(144,141,206,0.08)", border: "1px solid rgba(144,141,206,0.14)", color: "rgba(197,203,232,0.62)" }}
            >
              {skill}
            </span>
          ))}
          {position.preferredSkills.length > 4 && (
            <span
              className="rounded-md px-2 py-0.5 text-[10px]"
              style={{ background: "rgba(144,141,206,0.06)", border: "1px solid rgba(144,141,206,0.12)", color: "rgba(197,203,232,0.62)" }}
            >
              +{position.preferredSkills.length - 4}
            </span>
          )}
        </div>
      )}

      <p className="mt-auto pt-3 text-[10px]" style={{ color: "rgba(197,203,232,0.55)" }}>
        {position.postedAt ? formatStableDate(position.postedAt) : "Recently posted"}
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Link href={`/careers/${position.slug || position.id}`} className="min-w-0 flex-1">
          <button
            className="h-9 w-full rounded-lg text-xs font-medium transition-all duration-200"
            style={{
              background: "rgba(144,141,206,0.07)",
              border: "1px solid rgba(144,141,206,0.18)",
              color: "rgba(197,203,232,0.60)",
            }}
          >
            View Role
          </button>
        </Link>
        <Link href={applyUrl} className="min-w-0 flex-1">
          <button
            className="h-9 w-full rounded-lg text-xs font-semibold transition-all duration-200"
            style={hovered ? {
              backgroundImage: "linear-gradient(135deg, #ED00ED, #908DCE)",
              backgroundSize: "160% 160%",
              border: "1px solid rgba(237,0,237,0.35)",
              color: "#ffffff",
            } : {
              backgroundColor: "rgba(237,0,237,0.12)",
              border: "1px solid rgba(237,0,237,0.28)",
              color: "#ED00ED",
            }}
          >
            Apply Now
          </button>
        </Link>
      </div>
    </div>
  );
}


function InfoCard({
  icon: Icon,
  title,
  text,
  buttonLabel,
  onButtonClick,
}: {
  icon: React.ElementType;
  title: string;
  text: string;
  buttonLabel: string;
  onButtonClick: () => void;
}) {
  return (
    <div
      className="careers-reveal group relative flex cursor-pointer flex-col gap-3 overflow-hidden rounded-2xl px-5 py-4 transition-all duration-200"
      style={{
        background: "linear-gradient(180deg, rgba(25,24,44,0.58), rgba(11,12,22,0.72))",
        backdropFilter: "blur(14px)",
        border: "1px solid rgba(144,141,206,0.18)",
        boxShadow: "0 16px 40px rgba(0,0,0,0.20)",
      }}
      onClick={onButtonClick}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = "rgba(237,0,237,0.30)";
        el.style.background = "linear-gradient(180deg, rgba(37,24,56,0.68), rgba(12,13,23,0.78))";
        el.style.transform = "translateY(-1px)";
        el.style.boxShadow = "0 22px 54px rgba(0,0,0,0.28), 0 0 0 1px rgba(237,0,237,0.08)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = "rgba(144,141,206,0.18)";
        el.style.background = "linear-gradient(180deg, rgba(25,24,44,0.58), rgba(11,12,22,0.72))";
        el.style.transform = "translateY(0)";
        el.style.boxShadow = "0 16px 40px rgba(0,0,0,0.20)";
      }}
    >
      <div
        className="absolute inset-x-0 top-0 h-px opacity-60"
        style={{ background: "linear-gradient(90deg, rgba(237,0,237,0.44), rgba(144,141,206,0.18), transparent)" }}
      />
      <div className="flex items-center gap-3">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
          style={{ background: "rgba(237,0,237,0.10)", border: "1px solid rgba(237,0,237,0.20)" }}
        >
          <Icon className="h-4 w-4" style={{ color: "#ED00ED" }} />
        </div>
        <p className="text-xs font-bold uppercase tracking-[0.15em]" style={{ color: "rgba(237,0,237,0.70)" }}>
          {title}
        </p>
      </div>
      <p className="text-sm leading-relaxed" style={{ color: "rgba(197,203,232,0.65)" }}>
        {text}
      </p>
      <div className="flex items-center justify-between mt-auto pt-1">
        <span
          className="inline-flex items-center gap-1.5 text-xs font-medium transition-colors"
          style={{ color: "#ED00ED" }}
        >
          {buttonLabel}
          <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </div>
  );
}


function CareersModal({
  title,
  onClose,
  children,
  maxWidth = "480px",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`careers-modal-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="my-3 flex max-h-[calc(100dvh-1.5rem)] w-full flex-col overflow-hidden rounded-2xl sm:my-0 sm:max-h-[calc(100dvh-2rem)]"
        style={{
          maxWidth,
          background: "linear-gradient(145deg, #12111f 0%, #0d0c1a 100%)",
          border: "1px solid rgba(144,141,206,0.22)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.70), 0 0 0 1px rgba(237,0,237,0.06), inset 0 1px 0 rgba(255,255,255,0.04)",
          animation: "dialogIn 0.22s cubic-bezier(0.16,1,0.3,1) both",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between px-5 py-4 sm:px-6"
          style={{ borderBottom: "1px solid rgba(144,141,206,0.12)" }}
        >
          <h3
            id={`careers-modal-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            className="text-sm font-semibold tracking-wide"
            style={{ color: "#C5CBE8" }}
          >
            {title}
          </h3>
          <button
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-150"
            style={{ color: "rgba(197,203,232,0.40)", background: "transparent" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(144,141,206,0.12)"; e.currentTarget.style.color = "#C5CBE8"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(197,203,232,0.40)"; }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* Content */}
        <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-6">
          {children}
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}
