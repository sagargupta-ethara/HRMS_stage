import type { Metadata } from 'next';
import './globals.css';
import { TopNav } from '@/components/top-nav';
import { isMockMode } from '@/lib/documenso';

export const metadata: Metadata = {
  title: 'HRMS · Template Builder',
  description: 'Documenso-style PDF template builder for HR contracts & offer letters',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const mockMode = isMockMode();
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas text-ink">
        <TopNav mockMode={mockMode} />
        <main>{children}</main>
      </body>
    </html>
  );
}
