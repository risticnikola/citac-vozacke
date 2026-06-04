'use client';

import { usePathname } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { Menu, ChevronDown, Check } from 'lucide-react';
import { useBridge } from './BridgeProvider';
import { cn } from '@/lib/cn';
import type { OnlineDevice } from '@/types';

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

function deviceLabel(d: OnlineDevice): string {
  if (d.name) return d.name;
  if (d.platform) return d.platform.charAt(0).toUpperCase() + d.platform.slice(1);
  return 'Unknown device';
}

function BridgeDevicePicker() {
  const { onlineDevices, selectedDeviceId, setSelectedDeviceId } = useBridge();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (onlineDevices.length === 0) {
    return (
      <div
        title="No card reader connected"
        className="flex items-center gap-1.5 text-xs text-neutral-500"
      >
        <span className="h-2 w-2 rounded-full bg-neutral-700" />
        <span className="hidden sm:inline">No reader</span>
      </div>
    );
  }

  const selected = onlineDevices.find((d) => d.id === selectedDeviceId) ?? null;
  const needsSelection = !selected;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={needsSelection ? 'Select a card reader' : `Using: ${deviceLabel(selected!)}`}
        className="flex items-center gap-1.5 text-xs text-neutral-400 transition-colors hover:text-neutral-200"
      >
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            needsSelection
              ? 'bg-amber-500'
              : 'bg-green-500 shadow-[0_0_6px] shadow-green-500/60',
          )}
        />
        <span className="hidden sm:inline">
          {needsSelection ? 'Select reader' : deviceLabel(selected!)}
        </span>
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-neutral-700 bg-neutral-900 py-1 shadow-xl">
          {onlineDevices.map((d) => (
            <button
              key={d.id}
              onClick={() => {
                setSelectedDeviceId(d.id === selectedDeviceId ? null : d.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-neutral-300 transition-colors hover:bg-neutral-800"
            >
              <span className="flex-1 truncate">{deviceLabel(d)}</span>
              {d.id === selectedDeviceId && (
                <Check className="h-3 w-3 shrink-0 text-green-400" />
              )}
            </button>
          ))}
        </div>
      )}
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
      <BridgeDevicePicker />
    </header>
  );
}
