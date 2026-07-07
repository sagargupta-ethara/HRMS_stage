import type { Metadata } from "next";
import { LegalPage, LegalSection as Section } from "@/components/layout/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service — Ethara.AI",
  description: "Terms and conditions governing your access to and use of Ethara.AI services.",
};

export default function TermsOfServicePage() {
  return (
    <LegalPage title="Terms of Service" lastUpdated="May 2026">
          <Section title="Introduction and Acceptance of Terms">
            <p>Welcome to Ethara.AI. These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of the Ethara.AI website, platform, APIs, and all related services provided by Ethara.AI.</p>
            <p>By accessing our website, creating an account, or using any of our services, you acknowledge that you have read, understood, and agree to be bound by these Terms in their entirety. If you are accepting these Terms on behalf of an organization or entity, you represent and warrant that you have the authority to bind that organization to these Terms.</p>
            <p>If you do not agree with any provision of these Terms, you must discontinue use of our website and services immediately.</p>
          </Section>

          <Section title="Description of Services">
            <p>Ethara.AI is an artificial intelligence research company specializing in Reinforcement Learning as a Service (RLaaS) for AGI training. Our platform provides a comprehensive suite of tools and infrastructure designed to accelerate the development, training, and evaluation of intelligent systems.</p>
            <p>Our services include, but are not limited to:</p>
            <ul>
              <li><strong>Reinforcement Learning as a Service (RLaaS):</strong> Cloud-hosted infrastructure for training reinforcement learning agents at scale, including distributed compute orchestration, hyperparameter optimization, and model versioning.</li>
              <li><strong>AI Training Environments:</strong> Custom and pre-built simulation environments designed for training autonomous agents across diverse task domains.</li>
              <li><strong>Evaluation Pipelines:</strong> Automated benchmarking and evaluation frameworks that measure agent performance, safety alignment, and robustness.</li>
              <li><strong>Datasets and Benchmarks:</strong> Curated datasets, reward signal libraries, and standardized benchmarks for training and evaluating AI systems.</li>
              <li><strong>Research and Publications:</strong> Access to our published research papers, technical reports, and methodological resources.</li>
            </ul>
            <p>We reserve the right to modify, suspend, or discontinue any aspect of our services at any time. We are not liable for any modification, suspension, or discontinuation of services.</p>
          </Section>

          <Section title="User Accounts and Registration">
            <p>Certain features and services require you to create an account. When registering, you agree to provide accurate, current, and complete information. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account.</p>
            <ul>
              <li>You must be at least 18 years of age to create an account and use our services.</li>
              <li>Each individual may maintain only one account unless explicitly authorized otherwise in writing.</li>
              <li>Accounts are non-transferable. You may not sell, trade, or assign your account to any other party.</li>
              <li>We reserve the right to suspend or terminate accounts that violate these Terms or are suspected of fraudulent activity.</li>
            </ul>
          </Section>

          <Section title="Acceptable Use Policy">
            <p>You agree to use our services only for lawful purposes and in accordance with these Terms. The following activities are strictly prohibited:</p>
            <ul>
              <li>Developing, training, or deploying AI systems intended to cause harm to individuals, groups, or critical infrastructure.</li>
              <li>Using our platform to create weapons systems, surveillance tools targeting protected populations, or systems designed to deceive or manipulate without consent.</li>
              <li>Attempting to reverse-engineer, decompile, or extract proprietary algorithms, model weights, or trade secrets from our platform.</li>
              <li>Introducing malicious code, viruses, or any form of malware into our systems or infrastructure.</li>
              <li>Circumventing or attempting to circumvent rate limits, access controls, authentication mechanisms, or other security measures.</li>
              <li>Using our services to infringe upon the intellectual property rights of any third party.</li>
              <li>Reselling, sublicensing, or redistributing access to our platform without prior written authorization.</li>
            </ul>
            <p>Violation of this Acceptable Use Policy may result in immediate account suspension or termination, without refund, and may subject you to civil or criminal liability.</p>
          </Section>

          <Section title="Intellectual Property Rights">
            <p>All content, software, algorithms, models, documentation, trademarks, logos, and other intellectual property available through our website and platform are the exclusive property of Ethara.AI or its licensors. Your use of our services does not grant you ownership of or any intellectual property rights in our platform or its underlying technology.</p>
            <p>You are granted a limited, non-exclusive, non-transferable, revocable licence to use our services in accordance with these Terms. Models, agents, and outputs that you create using our platform remain your intellectual property, subject to the conditions specified in your service agreement.</p>
          </Section>

          <Section title="API and Service Usage Terms">
            <p>Access to our APIs and computational resources is subject to usage limits, rate restrictions, and fair-use policies as defined in your subscription tier. We strive to maintain high availability but do not guarantee uninterrupted access to our services.</p>
            <p>We reserve the right to modify API specifications, deprecate endpoints, or alter service features with reasonable notice. Continued use of the API following such changes constitutes acceptance.</p>
          </Section>

          <Section title="Confidentiality">
            <p>During your use of our services, you may gain access to confidential information belonging to Ethara.AI, including technical documentation, system architectures, research methodologies, and business strategies. You agree to hold all such information in strict confidence.</p>
            <p>Similarly, we treat your proprietary data, training configurations, model architectures, and experimental results as confidential. Confidentiality obligations survive the termination of these Terms for a period of three (3) years, except for trade secrets, which remain protected indefinitely.</p>
          </Section>

          <Section title="Limitation of Liability">
            <p>To the maximum extent permitted by applicable law, Ethara.AI shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of profits, revenue, data, or business opportunities.</p>
            <p>Our total cumulative liability to you for all claims arising out of or related to these Terms shall not exceed the total fees paid by you to Ethara.AI during the twelve (12) months immediately preceding the event giving rise to the claim.</p>
          </Section>

          <Section title="Indemnification">
            <p>You agree to indemnify, defend, and hold harmless Ethara.AI, its officers, directors, employees, contractors, agents, licensors, and suppliers from and against any claims, liabilities, damages, judgments, awards, losses, costs, expenses, or fees arising out of or relating to your violation of these Terms or your use or misuse of our services.</p>
          </Section>

          <Section title="Termination">
            <p>Either party may terminate these Terms at any time. We may terminate or suspend your access immediately, without prior notice or liability, for any reason, including if you breach any provision of these Terms.</p>
            <p>Upon termination, your right to access and use our services ceases immediately. We may delete your account data after a grace period of thirty (30) days. Any outstanding fees owed to Ethara.AI become immediately due and payable.</p>
          </Section>

          <Section title="Governing Law">
            <p>These Terms shall be governed by and construed in accordance with the laws of India, without regard to its conflict of law provisions. Any legal proceedings arising out of or in connection with these Terms shall be subject to the exclusive jurisdiction of the courts located in India.</p>
          </Section>

          <Section title="Dispute Resolution">
            <p>In the event of any dispute, both parties agree to first attempt resolution through good-faith negotiation. If the dispute cannot be resolved within thirty (30) days, either party may submit the matter to binding arbitration administered in accordance with the Arbitration and Conciliation Act, 1996 (as amended) of India.</p>
          </Section>

          <Section title="Modifications to Terms">
            <p>We reserve the right to modify these Terms at any time. When we make material changes, we will update the &ldquo;Last updated&rdquo; date at the top of this page and, where appropriate, provide additional notice. Your continued use of our services after the effective date of any modifications constitutes your acceptance of the revised Terms.</p>
          </Section>

          <Section title="Contact Information">
            <p>If you have questions about these Terms of Service, require clarification on any provision, or wish to report a violation, please contact us at <a href="mailto:info@ethara.ai" style={{ color: "#ED00ED" }}>info@ethara.ai</a>.</p>
          </Section>
    </LegalPage>
  );
}
