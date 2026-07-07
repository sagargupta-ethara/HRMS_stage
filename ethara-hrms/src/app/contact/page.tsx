"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2, Mail, MapPin, Phone } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function ContactPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    company: "",
    queryType: "",
    message: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 1200));
    setSubmitting(false);
    setSubmitted(true);
  };

  return (
    <main className="min-h-screen" style={{ background: "var(--background)" }}>
      <header
        className="sticky top-0 z-20 border-b backdrop-blur-md"
        style={{
          borderColor: "rgba(144,141,206,0.18)",
          background: "rgba(11,11,18,0.72)",
        }}
      >
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link href="/careers" aria-label="Ethara.AI careers">
            <Image src="/logo.png" alt="Ethara.AI" width={96} height={26} priority className="object-contain" style={{ width: "auto", height: "auto" }} />
          </Link>
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-white/5"
            style={{ color: "rgba(197,203,232,0.72)" }}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="mb-12 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] mb-3" style={{ color: "rgba(237,0,237,0.70)" }}>Get in Touch</p>
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#C5CBE8" }}>Let&apos;s Build the Future Together</h1>
          <p className="mt-3 text-sm max-w-xl mx-auto" style={{ color: "rgba(197,203,232,0.65)" }}>
            Connect with our experts who combine domain expertise with real-world experience to serve as true thought partners in your LLM training and data curation needs.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:gap-8">
          <div
            className="overflow-hidden rounded-2xl p-4 sm:p-8"
            style={{ background: "rgba(25,24,44,0.80)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(20px)" }}
          >
            {submitted ? (
              <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
                <div
                  className="flex h-16 w-16 items-center justify-center rounded-full"
                  style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.30)" }}
                >
                  <CheckCircle2 className="h-8 w-8" style={{ color: "#22c55e" }} />
                </div>
                <h2 className="text-xl font-semibold" style={{ color: "#C5CBE8" }}>Message Sent Successfully</h2>
                <p className="text-sm" style={{ color: "rgba(197,203,232,0.60)" }}>We&apos;ll get back to you soon.</p>
                <button
                  onClick={() => { setSubmitted(false); setForm({ firstName: "", lastName: "", email: "", company: "", queryType: "", message: "" }); }}
                  className="mt-2 text-xs transition-colors"
                  style={{ color: "rgba(197,203,232,0.62)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "#ED00ED"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(197,203,232,0.62)"; }}
                >
                  Send another message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate className="space-y-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <FormField label="First Name" required>
                    <ContactInput
                      placeholder="Your First Name"
                      value={form.firstName}
                      onChange={(v) => setForm((p) => ({ ...p, firstName: v }))}
                      required
                    />
                  </FormField>
                  <FormField label="Last Name" required>
                    <ContactInput
                      placeholder="Your Last Name"
                      value={form.lastName}
                      onChange={(v) => setForm((p) => ({ ...p, lastName: v }))}
                      required
                    />
                  </FormField>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <FormField label="Email" required>
                    <ContactInput
                      type="email"
                      placeholder="your@email.com"
                      value={form.email}
                      onChange={(v) => setForm((p) => ({ ...p, email: v }))}
                      required
                    />
                  </FormField>
                  <FormField label="Company">
                    <ContactInput
                      placeholder="Your Company Name"
                      value={form.company}
                      onChange={(v) => setForm((p) => ({ ...p, company: v }))}
                    />
                  </FormField>
                </div>

                <FormField label="Query Type" required>
                  <Select value={form.queryType} onValueChange={(v) => setForm((p) => ({ ...p, queryType: v ?? "" }))}>
                    <SelectTrigger
                      className="h-10 w-full rounded-xl px-3 text-sm transition-all duration-200"
                      style={{
                        background: "rgba(144,141,206,0.07)",
                        border: "1px solid rgba(144,141,206,0.20)",
                        color: form.queryType ? "#C5CBE8" : "rgba(197,203,232,0.55)",
                      }}
                    >
                      <SelectValue placeholder="Select query type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rlaas">RLaaS</SelectItem>
                      <SelectItem value="research">Research</SelectItem>
                      <SelectItem value="ots">OTS</SelectItem>
                      <SelectItem value="careers">Careers</SelectItem>
                      <SelectItem value="others">Others</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>

                <FormField label="Message" required>
                  <textarea
                    placeholder="Tell us about your project requirements, timeline, and any specific needs..."
                    className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none resize-none transition-all duration-200"
                    style={{
                      background: "rgba(144,141,206,0.07)",
                      border: "1px solid rgba(144,141,206,0.20)",
                      color: "#C5CBE8",
                      minHeight: "120px",
                    }}
                    value={form.message}
                    onChange={(e) => setForm((p) => ({ ...p, message: e.target.value }))}
                    required
                    onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(237,0,237,0.50)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(144,141,206,0.20)"; }}
                  />
                </FormField>

                <button
                  type="submit"
                  disabled={submitting}
                  className="h-10 w-full rounded-xl text-sm font-semibold text-white transition-all duration-200 active:scale-[0.98] disabled:opacity-60"
                  style={{
                    background: submitting
                      ? "rgba(144,141,206,0.35)"
                      : "linear-gradient(135deg, #ED00ED 0%, #908DCE 100%)",
                    boxShadow: submitting ? "none" : "0 0 20px rgba(237,0,237,0.30)",
                  }}
                >
                  {submitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Sending...
                    </span>
                  ) : "Send Message"}
                </button>
              </form>
            )}
          </div>

          <div className="min-w-0 space-y-5">
            <div
              className="space-y-5 overflow-hidden rounded-2xl p-4 sm:p-6"
              style={{ background: "rgba(25,24,44,0.80)", border: "1px solid rgba(144,141,206,0.18)" }}
            >
              <h2 className="text-sm font-semibold" style={{ color: "#C5CBE8" }}>Contact Information</h2>

              <ContactInfoRow icon={<MapPin className="h-4 w-4" />}>
                5th Floor, Quattro Iconic, Plot No. 273, Phase II, Udyog Vihar, Sector 20, Gurugram, Haryana 122016, India
              </ContactInfoRow>

              <ContactInfoRow icon={<Mail className="h-4 w-4" />}>
                <a href="mailto:info@ethara.ai" style={{ color: "#ED00ED" }}>info@ethara.ai</a>
              </ContactInfoRow>

              <ContactInfoRow icon={<Phone className="h-4 w-4" />}>
                0124 433 3224
              </ContactInfoRow>
            </div>

            <div
              className="space-y-4 overflow-hidden rounded-2xl p-4 sm:p-6"
              style={{ background: "rgba(25,24,44,0.80)", border: "1px solid rgba(144,141,206,0.18)" }}
            >
              <h2 className="text-sm font-semibold" style={{ color: "#C5CBE8" }}>What Happens Next</h2>
              <div className="space-y-3">
                {[
                  { step: "01", text: "Initial consultation call within 24 hours" },
                  { step: "02", text: "Custom proposal based on your needs" },
                  { step: "03", text: "Pilot project to demonstrate value" },
                ].map((item) => (
                  <div key={item.step} className="flex items-start gap-3">
                    <span
                      className="shrink-0 flex h-6 w-6 items-center justify-center rounded-lg text-xs font-bold"
                      style={{ background: "rgba(237,0,237,0.12)", color: "#ED00ED", border: "1px solid rgba(237,0,237,0.25)" }}
                    >
                      {item.step}
                    </span>
                    <p className="text-sm pt-0.5" style={{ color: "rgba(197,203,232,0.65)" }}>{item.text}</p>
                  </div>
                ))}
              </div>
            </div>

            <div
              className="overflow-hidden rounded-2xl p-4 sm:p-5"
              style={{ background: "rgba(237,0,237,0.05)", border: "1px solid rgba(237,0,237,0.18)" }}
            >
              <p className="text-xs font-medium" style={{ color: "rgba(197,203,232,0.65)" }}>Website</p>
              <a
                href="https://www.ethara.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-sm font-medium transition-colors"
                style={{ color: "#ED00ED" }}
              >
                https://www.ethara.ai
              </a>
            </div>
          </div>
        </div>
        <div
          className="mt-12 flex justify-start border-t pt-6 sm:justify-end"
          style={{ borderColor: "rgba(144,141,206,0.14)" }}
        >
          <Link
            href="/careers"
            className="text-sm font-medium"
            style={{ color: "rgba(237,0,237,0.85)" }}
          >
            Return to home
          </Link>
        </div>
      </div>
    </main>
  );
}

function FormField({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium" style={{ color: "#C5CBE8" }}>
        {label}{required && <span style={{ color: "rgba(237,0,237,0.80)" }}> *</span>}
      </label>
      {children}
    </div>
  );
}

function ContactInput({
  type = "text",
  placeholder,
  value,
  onChange,
  required,
}: {
  type?: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      className="h-10 w-full rounded-xl px-3 text-sm focus:outline-none transition-all duration-200"
      style={{
        background: "rgba(144,141,206,0.07)",
        border: "1px solid rgba(144,141,206,0.20)",
        color: "#C5CBE8",
      }}
      onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(237,0,237,0.50)"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(237,0,237,0.08)"; }}
      onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(144,141,206,0.20)"; e.currentTarget.style.boxShadow = "none"; }}
    />
  );
}

function ContactInfoRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="shrink-0 mt-0.5" style={{ color: "rgba(144,141,206,0.70)" }}>{icon}</div>
      <p className="min-w-0 break-words text-sm" style={{ color: "rgba(197,203,232,0.65)" }}>{children}</p>
    </div>
  );
}
