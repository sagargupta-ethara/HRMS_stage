"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0B0B12", color: "#C5CBE8", fontFamily: "Arial, sans-serif" }}>
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem", gap: "1.5rem", textAlign: "center" }}>
          <p style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.15em", color: "rgba(237,0,237,0.70)" }}>Something went wrong</p>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>Application Error</h1>
          <p style={{ color: "rgba(197,203,232,0.55)", maxWidth: "400px", fontSize: "0.875rem", margin: 0 }}>
            An unexpected error occurred. Please try refreshing the page.
          </p>
          <button
            onClick={reset}
            style={{
              background: "linear-gradient(135deg, #ED00ED 0%, #908DCE 100%)",
              color: "white", border: "none", borderRadius: "12px",
              padding: "0.5rem 1.5rem", fontSize: "0.875rem", fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
