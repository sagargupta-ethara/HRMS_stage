"use client";

import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth-context";
import { markClientHydrated } from "@/lib/hydration-state";
import { Toaster } from "@/components/ui/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

function HydrationStateProvider({ children }: { children: React.ReactNode }) {
  const [, setHydrated] = useState(false);

  useEffect(() => {
    markClientHydrated();
    const frameId = window.requestAnimationFrame(() => {
      setHydrated(true);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  return <>{children}</>;
}

// Applies page-enter animation on route changes for public (non-dashboard/portal) pages
const ANIMATED_INTERNALLY = ["/dashboard", "/portal"];

function PublicPageAnimator({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [key, setKey] = useState(0);
  const isInternal = ANIMATED_INTERNALLY.some((p) => pathname.startsWith(p));
  const prevPath = useRef(pathname);

  useEffect(() => {
    if (pathname !== prevPath.current && !isInternal) {
      prevPath.current = pathname;
      setKey((k) => k + 1);
    }
  }, [pathname, isInternal]);

  if (isInternal) return <>{children}</>;

  return (
    <div key={key} className="page-enter flex flex-col min-h-screen">
      {children}
    </div>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  // Create a stable QueryClient per session
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Retry once on failure (handles intermittent network issues)
            retry: 1,
            // Don't refetch on window focus in dev to reduce noise
            refetchOnWindowFocus: process.env.NODE_ENV === "production",
          },
          mutations: {
            retry: 0,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <HydrationStateProvider>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange storageKey="ethara-theme">
          <AuthProvider>
            <TooltipProvider delay={0}>
              <PublicPageAnimator>
                {children}
              </PublicPageAnimator>
              <Toaster richColors position="top-right" />
            </TooltipProvider>
          </AuthProvider>
        </ThemeProvider>
      </HydrationStateProvider>
    </QueryClientProvider>
  );
}
