"use client";

import Link from "next/link";
import Image from "next/image";

const FOOTER_LINKS = [
  { label: "Privacy Policy", href: "/privacy-policy" },
  { label: "Terms of Service", href: "/terms-of-service" },
  { label: "Cookies Policy", href: "/cookies-policy" },
  { label: "Contact Us", href: "/contact" },
];

const SOCIAL_LINKS = [
  {
    label: "LinkedIn",
    href: "https://in.linkedin.com/company/ethara-ai",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
  },
  {
    label: "Instagram",
    href: "https://www.instagram.com/ethara.ai/",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
      </svg>
    ),
  },
];

export function Footer() {
  return (
    <footer
      className="mt-auto border-t"
      style={{
        borderColor: "rgba(144,141,206,0.12)",
        background: "rgba(8,8,16,0.80)",
        backdropFilter: "blur(20px)",
      }}
    >
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-3">
            <div>
              <Image
                src="/logo.png"
                alt="Ethara.AI"
                width={100}
                height={28}
                className="object-contain"
                style={{ width: "auto", height: "auto" }}
              />
            </div>
            <p className="text-xs max-w-xs" style={{ color: "rgba(197,203,232,0.40)" }}>
              AI-driven talent intelligence and HR management platform.
            </p>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
            <nav className="flex flex-wrap gap-x-6 gap-y-2">
              {FOOTER_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-xs transition-colors duration-200"
                  style={{ color: "rgba(197,203,232,0.50)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "#ED00ED"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(197,203,232,0.50)"; }}
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            <div className="flex items-center gap-3">
              {SOCIAL_LINKS.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={social.label}
                  className="flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200"
                  style={{
                    background: "rgba(144,141,206,0.08)",
                    border: "1px solid rgba(144,141,206,0.18)",
                    color: "rgba(197,203,232,0.50)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(237,0,237,0.10)";
                    e.currentTarget.style.borderColor = "rgba(237,0,237,0.30)";
                    e.currentTarget.style.color = "#ED00ED";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(144,141,206,0.08)";
                    e.currentTarget.style.borderColor = "rgba(144,141,206,0.18)";
                    e.currentTarget.style.color = "rgba(197,203,232,0.50)";
                  }}
                >
                  {social.icon}
                </a>
              ))}
            </div>
          </div>
        </div>

        <div
          className="mt-6 pt-5 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
          style={{ borderTop: "1px solid rgba(144,141,206,0.10)" }}
        >
          <p className="text-xs" style={{ color: "rgba(197,203,232,0.28)" }}>
            © {new Date().getFullYear()} Ethara.AI. All rights reserved.
          </p>
          <p className="text-xs" style={{ color: "rgba(197,203,232,0.28)" }}>
            5th Floor, Plot No. 273, Udyog Vihar Phase 1, Sector 20, Gurugram, Haryana 122016
          </p>
        </div>
      </div>
    </footer>
  );
}
