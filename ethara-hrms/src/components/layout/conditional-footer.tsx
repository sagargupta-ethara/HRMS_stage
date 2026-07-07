"use client";

import { usePathname } from "next/navigation";
import { Footer } from "./footer";

export function ConditionalFooter() {
  const pathname = usePathname();
  const showFooter = pathname === "/careers" || pathname.startsWith("/careers/");
  if (!showFooter) return null;
  return <Footer />;
}
