import type { Metadata } from "next";
import { Plus_Jakarta_Sans, DM_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { ConditionalFooter } from "@/components/layout/conditional-footer";
import "./globals.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

const dmMono = DM_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ethara.AI",
  description: "Production-ready full-stack hiring, onboarding, evaluation, and compliance management platform for Ethara.",
  keywords: ["HRMS", "hiring", "onboarding", "evaluation", "compliance", "Ethara"],
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon.png", type: "image/png" },
    ],
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <body className={`${plusJakartaSans.variable} ${dmMono.variable} antialiased flex flex-col min-h-screen`}>
        <Providers>
          {children}
          <ConditionalFooter />
        </Providers>
      </body>
    </html>
  );
}
