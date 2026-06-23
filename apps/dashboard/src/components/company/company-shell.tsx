'use client';

import { useEffect } from 'react';
import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  FileSpreadsheet,
  LayoutDashboard,
  Library,
  ListVideo,
  MapPin,
  Megaphone,
  Monitor,
  ScrollText,
  Settings,
  Tags,
  Upload,
  Users,
} from 'lucide-react';

import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Button, Spinner } from '@/components/ui';
import { NotificationBell } from '@/components/notification-bell';

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; exact?: boolean };

// Grouped navigation — sections keep a 17-item list scannable instead of one
// long flat column. Routes are unchanged.
const NAV_SECTIONS: { title?: string; items: NavItem[] }[] = [
  { items: [{ href: '/company', label: 'Overview', icon: LayoutDashboard, exact: true }] },
  {
    title: 'Operations',
    items: [
      { href: '/company/screens', label: 'Screens', icon: Monitor },
      { href: '/company/screen-groups', label: 'Screen Groups', icon: Users },
      { href: '/company/locations', label: 'Locations', icon: Building2 },
      { href: '/company/monitoring', label: 'Monitoring', icon: Activity },
      { href: '/company/alerts', label: 'Alerts', icon: Bell },
      { href: '/company/emergency-broadcasts', label: 'Emergency', icon: Megaphone },
    ],
  },
  {
    title: 'Content',
    items: [
      { href: '/company/content', label: 'Content Library', icon: Library },
      { href: '/company/playlists', label: 'Playlists', icon: ListVideo },
      { href: '/company/schedules', label: 'Schedules', icon: CalendarClock },
    ],
  },
  {
    title: 'Reports',
    items: [
      { href: '/company/reports/proof-of-play', label: 'Proof of Play', icon: BarChart3 },
      { href: '/company/reports/scheduled', label: 'Scheduled Reports', icon: FileSpreadsheet },
      { href: '/company/imports', label: 'Imports', icon: Upload },
    ],
  },
  {
    title: 'Settings',
    items: [
      { href: '/company/tags', label: 'Tags', icon: Tags },
      { href: '/company/map', label: 'Map View', icon: MapPin },
      { href: '/company/settings', label: 'Settings', icon: Settings },
      { href: '/company/activity-logs', label: 'Activity Logs', icon: ScrollText },
    ],
  },
];

/** Protected Company Admin shell: auth guard + sidebar + top bar. */
export function CompanyShell({ children }: { children: React.ReactNode }) {
  const { status, user, needsTwoFactorSetup, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'unauthenticated' || (status === 'authenticated' && needsTwoFactorSetup)) {
      router.replace('/login');
    } else if (status === 'authenticated' && user?.role === 'SUPER_ADMIN') {
      // Platform admins belong in the Super Admin console.
      router.replace('/admin');
    }
  }, [status, needsTwoFactorSetup, user?.role, router]);

  if (
    status === 'loading' ||
    status === 'unauthenticated' ||
    needsTwoFactorSetup ||
    user?.role === 'SUPER_ADMIN'
  ) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="text-primary size-6" />
      </div>
    );
  }

  return (
    <div className="bg-background flex min-h-screen">
      <aside className="border-border bg-card hidden w-64 shrink-0 flex-col border-e md:flex">
        <div className="border-border flex h-16 items-center gap-2 border-b px-5">
          <div className="bg-primary size-7 rounded-md" />
          <span className="font-semibold">MasterSignage</span>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          {NAV_SECTIONS.map((section, i) => (
            <div key={section.title ?? `section-${i}`} className="space-y-1">
              {section.title ? (
                <p className="text-muted-foreground/70 px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider">
                  {section.title}
                </p>
              ) : null}
              {section.items.map((item) => {
                const active = item.exact
                  ? pathname === item.href
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition',
                      active
                        ? "bg-primary/10 text-primary before:bg-primary font-medium before:absolute before:inset-y-1 before:start-0 before:w-0.5 before:rounded-full before:content-['']"
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="border-border text-muted-foreground border-t p-4 text-xs">
          Company Console
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border bg-card flex h-16 items-center justify-between gap-3 border-b px-4 md:px-6">
          <span className="text-muted-foreground text-xs uppercase tracking-wide">
            Company Management
          </span>
          <div className="flex items-center gap-2">
            <NotificationBell basePath="/company" />
            <LocaleSwitcher />
            <ThemeToggle />
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight">{user?.name}</p>
              <p className="text-muted-foreground text-xs leading-tight">{user?.email}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => logout()}>
              Sign out
            </Button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
