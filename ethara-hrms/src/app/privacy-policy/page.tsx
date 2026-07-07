import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection as Section } from "@/components/layout/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy — Ethara.AI",
  description: "Learn how Ethara.AI collects, uses, and protects your personal information.",
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPage title="Privacy Policy" lastUpdated="May 2026">
          <Section title="Introduction">
            <p>Ethara.AI (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) operates the website ethara.ai and provides artificial intelligence research services, including Reinforcement Learning as a Service (RLaaS) for AGI training environments and evaluation pipelines. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website or engage with our services.</p>
            <p>By accessing or using our website and services, you acknowledge that you have read, understood, and agree to be bound by this Privacy Policy. If you do not agree with the terms outlined here, please discontinue use of our website and services immediately.</p>
          </Section>

          <Section title="Information We Collect">
            <p>We collect information that you provide directly, information generated through your use of our services, and information obtained from third-party sources.</p>
            <SubSection title="Personal Information">
              <p>When you create an account, request a demo, subscribe to our newsletter, or contact us, we may collect:</p>
              <ul>
                <li>Full name and professional title</li>
                <li>Email address and phone number</li>
                <li>Company or organization name</li>
                <li>Billing and payment information (processed through secure third-party payment providers)</li>
                <li>Any other information you voluntarily provide through forms, correspondence, or support requests</li>
              </ul>
            </SubSection>
            <SubSection title="Usage Data">
              <p>We automatically collect certain technical information when you interact with our website and platform:</p>
              <ul>
                <li>IP address, browser type, and operating system</li>
                <li>Pages visited, time spent on each page, and navigation paths</li>
                <li>Referring URLs and exit pages</li>
                <li>Device identifiers and screen resolution</li>
                <li>API usage patterns, request timestamps, and service interaction logs</li>
              </ul>
            </SubSection>
            <SubSection title="Cookies and Tracking Technologies">
              <p>Our website uses cookies, web beacons, and similar tracking technologies to enhance your browsing experience and gather analytical data. You can control cookie preferences through your browser settings. See our <Link href="/cookies-policy" style={{ color: "#ED00ED" }}>Cookies Policy</Link> for details.</p>
            </SubSection>
          </Section>

          <Section title="How We Use Your Information">
            <p>We process the information we collect for the following purposes:</p>
            <ul>
              <li>To provide, operate, and maintain our RLaaS platform and associated training environments</li>
              <li>To process transactions and send related billing confirmations</li>
              <li>To respond to your inquiries, support requests, and service-related communications</li>
              <li>To send technical notices, platform updates, security alerts, and administrative messages</li>
              <li>To analyse usage trends and improve the performance, reliability, and user experience of our services</li>
              <li>To detect, prevent, and address fraud, abuse, or technical issues</li>
              <li>To comply with legal obligations and enforce our terms of service</li>
              <li>To communicate research findings, product announcements, or marketing materials (with your consent, where required by law)</li>
            </ul>
          </Section>

          <Section title="Data Sharing and Disclosure">
            <p>We do not sell your personal information to third parties. We may share your data only in the following circumstances:</p>
            <ul>
              <li><strong>Service Providers:</strong> Trusted third-party vendors who perform services on our behalf, such as cloud hosting, payment processing, analytics, and customer support. These providers are contractually obligated to protect your data.</li>
              <li><strong>Legal Compliance:</strong> We may disclose your information if required by law, regulation, legal process, or governmental request.</li>
              <li><strong>Business Transfers:</strong> In the event of a merger, acquisition, or sale of assets, your information may be transferred. We will notify affected users before their data becomes subject to a different privacy policy.</li>
              <li><strong>With Your Consent:</strong> We may share your information for any other purpose with your explicit consent.</li>
            </ul>
          </Section>

          <Section title="Data Security">
            <p>We implement industry-standard technical and organizational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction. These include encryption of data in transit and at rest, regular security audits, access controls, and continuous monitoring of our infrastructure.</p>
            <p>While we strive to protect your information using commercially reasonable safeguards, no method of electronic transmission or storage is completely secure. We cannot guarantee absolute security, but we commit to promptly addressing any breach in accordance with applicable notification laws.</p>
          </Section>

          <Section title="Data Retention">
            <p>We retain your personal information only for as long as necessary to fulfil the purposes described in this policy, unless a longer retention period is required or permitted by law. When personal data is no longer needed, we securely delete or anonymize it.</p>
          </Section>

          <Section title="Your Rights">
            <p>Depending on your jurisdiction, you may have the following rights regarding your personal information:</p>
            <ul>
              <li><strong>Right of Access:</strong> Request a copy of the personal data we hold about you.</li>
              <li><strong>Right to Correction:</strong> Request that we correct inaccurate or incomplete personal data.</li>
              <li><strong>Right to Deletion:</strong> Request the deletion of your personal data where it is no longer necessary.</li>
              <li><strong>Right to Data Portability:</strong> Request a machine-readable copy of your personal data.</li>
              <li><strong>Right to Object:</strong> Object to the processing of your data for direct marketing or legitimate interests.</li>
              <li><strong>Right to Restrict Processing:</strong> Request that we limit the processing of your data under certain circumstances.</li>
            </ul>
            <p>To exercise any of these rights, please contact us at <a href="mailto:info@ethara.ai" style={{ color: "#ED00ED" }}>info@ethara.ai</a>.</p>
          </Section>

          <Section title="International Data Transfers">
            <p>Ethara.AI is headquartered in India. Your information may be transferred to, stored, and processed in countries other than the one in which it was collected. When we transfer personal data internationally, we implement appropriate safeguards to ensure your data receives an adequate level of protection.</p>
          </Section>

          <Section title="Children's Privacy">
            <p>Our services are not directed at individuals under the age of 18. We do not knowingly collect personal information from children. If you believe that a child has provided us with personal data, please contact us immediately at <a href="mailto:info@ethara.ai" style={{ color: "#ED00ED" }}>info@ethara.ai</a>.</p>
          </Section>

          <Section title="Changes to This Policy">
            <p>We may update this Privacy Policy from time to time to reflect changes in our practices, technologies, or legal requirements. When we make material changes, we will notify you by posting the revised policy on our website with an updated &ldquo;Last updated&rdquo; date. Your continued use of our website and services after any modifications constitutes your acceptance of the updated Privacy Policy.</p>
          </Section>

          <Section title="Contact Us">
            <p>If you have questions, concerns, or requests regarding this Privacy Policy or our data practices, please reach out to us at <a href="mailto:info@ethara.ai" style={{ color: "#ED00ED" }}>info@ethara.ai</a>.</p>
          </Section>
    </LegalPage>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold mb-2" style={{ color: "rgba(197,203,232,0.85)" }}>{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
