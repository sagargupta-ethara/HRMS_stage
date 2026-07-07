import Link from "next/link";

export default function PortalNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center animate-fade-in">
      <div
        className="flex h-14 w-14 items-center justify-center rounded-xl"
        style={{ background: "rgba(237,0,237,0.10)", border: "1px solid rgba(237,0,237,0.25)" }}
      >
        <svg
          className="h-6 w-6"
          style={{ color: "#ED00ED" }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z"
          />
        </svg>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: "rgba(197,203,232,0.45)" }}>
          Error 404
        </p>
        <h2 className="mt-2 text-lg font-semibold" style={{ color: "#C5CBE8" }}>
          Page not found
        </h2>
        <p className="mt-1 text-sm" style={{ color: "rgba(197,203,232,0.55)" }}>
          The page you&apos;re looking for doesn&apos;t exist or may have moved.
        </p>
      </div>
      <Link
        href="/portal/dashboard"
        className="rounded-xl px-4 py-2 text-sm font-medium text-white transition-all"
        style={{ background: "linear-gradient(135deg, #ED00ED 0%, #908DCE 100%)" }}
      >
        Back to dashboard
      </Link>
    </div>
  );
}
