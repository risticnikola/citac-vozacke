'use client';

import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { useBridge } from './BridgeProvider';
import { cn } from '@/lib/cn';

const TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/vehicles':  'Vehicles',
  '/reminders': 'Service Reminders',
  '/jobs':      'Jobs',
};

function getTitle(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  const prefix = Object.keys(TITLES).find((k) => k !== '/dashboard' && pathname.startsWith(k + '/'));
  return prefix ? TITLES[prefix] : 'CarMech';
}

function BridgeStatus() {
  const { connected } = useBridge();
  return (
    <div
      title={connected ? 'Card reader connected' : 'Card reader not connected'}
      className="flex items-center gap-1.5 text-xs text-neutral-500"
    >
      <span className={cn(
        'h-2 w-2 rounded-full',
        connected ? 'bg-green-500 shadow-[0_0_6px] shadow-green-500/60' : 'bg-neutral-700',
      )} />
      <span className="hidden sm:inline">
        {connected ? 'Reader connected' : 'No reader'}
      </span>
    </div>
  );
}

export function TopBar({ onMobileMenuToggle }: { onMobileMenuToggle: () => void }) {
  const pathname = usePathname();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-800 px-4 md:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onMobileMenuToggle}
          className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200 md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="truncate text-sm font-medium text-neutral-200">{getTitle(pathname)}</h1>
      </div>
      <BridgeStatus />
    </header>
  );
}
