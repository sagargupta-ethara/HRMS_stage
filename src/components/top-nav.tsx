'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { FileIcon, PlusIcon, SendIcon } from './icons';

const links = [
  { href: '/templates', label: 'Templates', icon: FileIcon },
  { href: '/documents', label: 'Documents', icon: SendIcon },
];

export function TopNav({ mockMode }: { mockMode: boolean }) {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-edge bg-canvas/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-5">
        <Link href="/" className="flex items-center gap-2 font-semibold text-ink">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-accent-ink">H</span>
          <span className="hidden sm:block">HRMS · Docs</span>
        </Link>

        <nav className="flex items-center gap-1">
          {links.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition',
                  active ? 'bg-panel-2 text-ink' : 'text-ink-dim hover:text-ink hover:bg-panel-2/60',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {mockMode && (
            <span
              title="DOCUMENSO_API_URL / DOCUMENSO_API_KEY not set — running with the built-in mock client."
              className="hidden items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300 sm:inline-flex"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              Mock Documenso
            </span>
          )}
          <Link
            href="/templates/new"
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink transition hover:brightness-110"
          >
            <PlusIcon className="h-4 w-4" />
            New Template
          </Link>
        </div>
      </div>
    </header>
  );
}
