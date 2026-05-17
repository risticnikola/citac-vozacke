'use client';

import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-full">
      {mobileOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar onMobileMenuToggle={() => setMobileOpen((o) => !o)} />
        <main className="flex-1 overflow-y-auto bg-neutral-950 p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
