"use client";

export default function PortalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center animate-fade-in">
      <div
        className="flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.25)" }}
      >
        <svg className="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      </div>
      <div>
        <h2 className="text-base font-semibold" style={{ color: "#C5CBE8" }}>Something went wrong</h2>
        <p className="text-sm mt-1" style={{ color: "rgba(197,203,232,0.50)" }}>
          Please try again or contact support.
        </p>
      </div>
      <button
        onClick={reset}
        className="rounded-xl px-4 py-2 text-sm font-medium text-white transition-all"
        style={{ background: "linear-gradient(135deg, #ED00ED 0%, #908DCE 100%)" }}
      >
        Try again
      </button>
    </div>
  );
}
