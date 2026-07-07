import type { Metadata } from "next";
import { LegalPage, LegalSection as Section } from "@/components/layout/legal-page";

export const metadata: Metadata = {
  title: "Cookies Policy — Ethara.AI",
  description: "Learn how Ethara.AI uses cookies and similar tracking technologies on our website.",
};

export default function CookiesPolicyPage() {
  return (
    <LegalPage title="Cookies Policy" lastUpdated="May 2026">
          <Section title="What Are Cookies">
            <p>Ethara.AI (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) uses cookies and similar technologies on ethara.ai. Cookies are small text files that websites place on your device when you browse them. They are widely used to make websites function properly, work more efficiently, and provide reporting information to site operators.</p>
          </Section>

          <Section title="Types of Cookies We Use">
            <p>Our website uses several categories of cookies, each serving a distinct purpose.</p>

            <CookieCard
              title="Essential / Strictly Necessary Cookies"
              color="rgba(34,197,94,0.15)"
              borderColor="rgba(34,197,94,0.25)"
              labelColor="#22c55e"
            >
              <p>These cookies are fundamental to the operation of our website. Without them, core features such as page navigation, secure login, and access to protected areas would not function. Essential cookies cannot be disabled without breaking basic site functionality.</p>
              <ul>
                <li>Session management and authentication tokens</li>
                <li>Security cookies that detect and prevent fraudulent activity</li>
                <li>Load-balancing cookies for consistent performance</li>
                <li>Cookie consent preferences</li>
              </ul>
            </CookieCard>

            <CookieCard
              title="Performance / Analytics Cookies"
              color="rgba(56,189,248,0.08)"
              borderColor="rgba(56,189,248,0.20)"
              labelColor="#38BDF8"
            >
              <p>Performance cookies collect aggregated, anonymous information about how visitors use our website. The data gathered through these cookies is used solely to improve how ethara.ai works.</p>
              <ul>
                <li>Page load times and server response metrics</li>
                <li>Navigation paths and bounce rates</li>
                <li>Aggregated visitor counts, geographic regions, and device types</li>
                <li>Error tracking data</li>
              </ul>
            </CookieCard>

            <CookieCard
              title="Functional Cookies"
              color="rgba(144,141,206,0.08)"
              borderColor="rgba(144,141,206,0.20)"
              labelColor="#908DCE"
            >
              <ul>
                <li>Language and regional preferences that persist across browsing sessions</li>
                <li>Theme settings (such as light or dark mode)</li>
                <li>Previously entered form data to reduce repetitive input</li>
                <li>Video or embedded content preferences</li>
              </ul>
            </CookieCard>

            <CookieCard
              title="Targeting / Advertising Cookies"
              color="rgba(245,158,11,0.06)"
              borderColor="rgba(245,158,11,0.18)"
              labelColor="#f59e0b"
            >
              <p>Ethara.AI does not currently deploy advertising or targeting cookies on our website. We do not serve third-party advertisements, nor do we participate in behavioural advertising networks. Should this change in the future, we will update this policy and seek your explicit consent.</p>
            </CookieCard>
          </Section>

          <Section title="Third-Party Cookies">
            <p>Some cookies on our website are placed by third-party services that we use to operate and improve ethara.ai. These third parties have their own privacy and cookie policies.</p>
            <ul>
              <li><strong>Hosting and Infrastructure Providers:</strong> May set technical cookies for load balancing, DDoS protection, and CDN delivery.</li>
              <li><strong>Google Analytics:</strong> Analytics cookies for usage measurement.</li>
              <li><strong>Embedded Content:</strong> Where we embed external content, the third-party provider may set their own cookies.</li>
            </ul>
          </Section>

          <Section title="How to Manage Cookies">
            <p>You have the right to decide whether to accept or reject cookies. Most web browsers are set to accept cookies by default, but you can modify your browser settings to decline cookies if you prefer.</p>
            <p>For Google Analytics specifically, you can install the Google Analytics Opt-out Browser Add-on, which prevents the Google Analytics JavaScript from sharing visit information with Google Analytics.</p>
            <p>You may also manage cookies through our cookie consent mechanism when it appears on your first visit to ethara.ai.</p>
          </Section>

          <Section title="Cookie Duration">
            <p>Cookies can remain on your device for different lengths of time depending on their purpose:</p>
            <ul>
              <li><strong>Session Cookies:</strong> Temporary cookies that exist only while your browser is open. Once you close your browser, session cookies are automatically deleted.</li>
              <li><strong>Persistent Cookies:</strong> These remain on your device for a set period or until you manually delete them. The expiration period for our persistent cookies ranges from 30 days to 24 months, depending on their function.</li>
            </ul>
          </Section>

          <Section title="Impact of Disabling Cookies">
            <p>If you choose to disable or reject cookies, you can still access our website. However, certain features may be affected:</p>
            <ul>
              <li>You may need to log in each time you visit, as session persistence will not function without authentication cookies.</li>
              <li>Personalisation features such as saved preferences and theme settings will reset on every visit.</li>
              <li>Some interactive elements and embedded content may not display or operate correctly.</li>
              <li>We will be unable to gather anonymous analytics data.</li>
            </ul>
          </Section>

          <Section title="Updates to This Cookie Policy">
            <p>We encourage you to check this page regularly so you remain informed about our use of cookies. Your continued use of ethara.ai after any changes to this policy constitutes your acceptance of the updated terms.</p>
          </Section>

          <Section title="Contact Us">
            <p>If you have questions about our use of cookies or need help managing your cookie preferences, please contact us at <a href="mailto:info@ethara.ai" style={{ color: "#ED00ED" }}>info@ethara.ai</a>.</p>
          </Section>
    </LegalPage>
  );
}

function CookieCard({
  title, children, color, borderColor, labelColor,
}: {
  title: string; children: React.ReactNode;
  color: string; borderColor: string; labelColor: string;
}) {
  return (
    <div className="mt-4 rounded-xl p-4 space-y-2" style={{ background: color, border: `1px solid ${borderColor}` }}>
      <p className="text-sm font-semibold" style={{ color: labelColor }}>{title}</p>
      <div className="space-y-2 text-sm" style={{ color: "rgba(197,203,232,0.70)" }}>{children}</div>
    </div>
  );
}
