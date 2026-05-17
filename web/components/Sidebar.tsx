'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Car,
  BellDot,
  Wrench,
  Settings,
  LogOut,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuth } from '@/hooks/useAuth';

const NAV = [
  { href: '/dashboard', label: 'Dashboard',  icon: LayoutDashboard, adminOnly: false },
  { href: '/vehicles',  label: 'Vehicles',   icon: Car,             adminOnly: false },
  { href: '/reminders', label: 'Reminders',  icon: BellDot,         adminOnly: false },
  { href: '/jobs',      label: 'Jobs',       icon: Wrench,          adminOnly: false },
  { href: '/settings',  label: 'Settings',   icon: Settings,        adminOnly: true  },
];

const LOGO_SVG = (
  <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0M13 17h-2V5l-3 3m0 0 3 3m-3-3h10" />
  </svg>
);

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

function NavItems({
  collapsed,
  onLinkClick,
}: {
  collapsed?: boolean;
  onLinkClick?: () => void;
}) {
  const pathname = usePathname();
  const { user } = useAuth();

  return (
    <>
      {NAV.map(({ href, label, icon: Icon, adminOnly }) => {
        if (adminOnly && user?.role !== 'garage_admin' && user?.role !== 'saas_admin') return null;
        const active = pathname === href || pathname.startsWith(href + '/');
        return (
          <Link
            key={href}
            href={href}
            onClick={onLinkClick}
            title={collapsed ? label : undefined}
            className={cn(
              'group flex items-center gap-2.5 rounded-lg py-2 text-sm font-medium transition-colors',
              collapsed ? 'justify-center px-2' : 'px-3',
              active
                ? 'bg-orange-500/10 text-orange-400'
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && label}
            {!collapsed && active && <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-50" />}
          </Link>
        );
      })}
    </>
  );
}

export function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const { user, logout } = useAuth();

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden md:flex h-full shrink-0 flex-col border-r border-neutral-800 bg-neutral-900 transition-all duration-200',
          collapsed ? 'w-14' : 'w-56',
        )}
      >
        {/* Brand */}
        <div className="flex h-14 shrink-0 items-center border-b border-neutral-800 px-2">
          {collapsed ? (
            <button
              onClick={onToggle}
              title="Expand sidebar"
              className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 transition-colors"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          ) : (
            <>
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-orange-500">
                {LOGO_SVG}
              </div>
              <span className="ml-2.5 flex-1 text-sm font-semibold tracking-tight text-neutral-100">CarMech</span>
              <button
                onClick={onToggle}
                title="Collapse sidebar"
                className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </>
          )}
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-3">
          <NavItems collapsed={collapsed} />
        </nav>

        {/* User + logout */}
        <div className="border-t border-neutral-800 p-3">
          {user && !collapsed && (
            <div className="mb-1 truncate px-3 py-1.5 text-xs text-neutral-500">
              {user.role.replace('_', ' ')}
            </div>
          )}
          <button
            onClick={logout}
            title={collapsed ? 'Sign out' : undefined}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg py-2 text-sm font-medium text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-red-400',
              collapsed ? 'justify-center px-2' : 'px-3',
            )}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed && 'Sign out'}
          </button>
        </div>
      </aside>

      {/* Mobile sidebar (slide-in overlay) */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-neutral-800 bg-neutral-900 transition-transform duration-200 md:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Brand */}
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-neutral-800 px-4">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-orange-500">
            {LOGO_SVG}
          </div>
          <span className="text-sm font-semibold tracking-tight text-neutral-100">CarMech</span>
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-3">
          <NavItems onLinkClick={onMobileClose} />
        </nav>

        {/* User + logout */}
        <div className="border-t border-neutral-800 p-3">
          {user && (
            <div className="mb-1 truncate px-3 py-1.5 text-xs text-neutral-500">
              {user.role.replace('_', ' ')}
            </div>
          )}
          <button
            onClick={logout}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-red-400"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
