'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
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
  Menu,
  Monitor,
  ScrollText,
  Settings,
  Tags,
  Upload,
  UserCog,
  Users,
  X,
} from 'lucide-react';

import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Button, Spinner } from '@/components/ui';
import { NotificationBell } from '@/components/notification-bell';
import { Logo } from '@/components/brand/logo';
import { isImpersonating } from '@/lib/impersonation';
import { ImpersonationBanner } from '@/components/company/impersonation-banner';

type NavItem = {
  href: string;
  tkey?: string;
  labels?: { en: string; ar: string };
  icon: typeof LayoutDashboard;
  exact?: boolean;
};

// Grouped navigation — sections keep a 17-item list scannable instead of one
// long flat column. Labels resolve via the `nav` i18n namespace (en/ar). Routes
// are unchanged except for production-only operator surfaces that use a small
// bilingual inline label to avoid expanding the large shared catalogue for one
// isolated control page.
const NAV_SECTIONS: { titleKey?: string; items: NavItem[] }[] = [
  { items: [{ href: '/company', tkey: 'overview', icon: LayoutDashboard, exact: true }] },
  {
    titleKey: 'operations',
    items: [
      { href: '/company/screens', tkey: 'items.screens', icon: Monitor },
      { href: '/company/screen-groups', tkey: 'items.screenGroups', icon: Users },
      { href: '/company/locations', tkey: 'items.locations', icon: Building2 },
      { href: '/company/monitoring', tkey: 'items.monitoring', icon: Activity },
      { href: '/company/alerts', tkey: 'items.alerts', icon: Bell },
      { href: '/company/emergency-broadcasts', tkey: 'items.emergency', icon: Megaphone },
    ],
  },
  {
    titleKey: 'content',
    items: [
      { href: '/company/content', tkey: 'items.content', icon: Library },
      { href: '/company/playlists', tkey: 'items.playlists', icon: ListVideo },
      { href: '/company/schedules', tkey: 'items.schedules', icon: CalendarClock },
    ],
  },
  {
    titleKey: 'reports',
    items: [
      { href: '/company/reports/proof-of-play', tkey: 'items.proofOfPlay', icon: BarChart3 },
      { href: '/company/reports/scheduled', tkey: 'items.scheduledReports', icon: FileSpreadsheet },
      { href: '/company/imports', tkey: 'items.imports', icon: Upload },
    ],
  },
  {
    titleKey: 'settings',
    items: [
      { href: '/company/users', tkey: 'items.users', icon: UserCog },
      { href: '/company/tags', tkey: 'items.tags', icon: Tags },
      { href: '/company/map', tkey: 'items.map', icon: MapPin },
      { href: '/company/settings', tkey: 'items.settings', icon: Settings, exact: true },
      {
        href: '/company/settings/android-ota',
        labels: { en: 'Android OTA', ar: 'تحديثات Android' },
        icon: Settings,
      },
      { href: '/company/activity-logs', tkey: 'items.activityLogs', icon: ScrollText },
    ],
  },
];

/** Grouped nav links, shared by the desktop sidebar and the mobile drawer. */
function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const locale = useLocale();
  const tNav = useTranslations('nav');
  return (
    <nav className="flex-1 space-y-4 overflow-y-auto p-3">
      {NAV_SECTIONS.map((section, i) => (
        <div key={section.titleKey ?? `section-${i}`} className="space-y-1">
          {section.titleKey ? (
            <p className="text-sidebar-muted/70 px-3 pb-1 text-xs font-semibold uppercase tracking-wider">
              {tNav(`sections.${section.titleKey}`)}
            </p>
          ) : null}
          {section.items.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            const label = item.tkey
              ? tNav(item.tkey)
              : item.labels?.[locale === 'ar' ? 'ar' : 'en'] ?? item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition',
                  active
                    ? "bg-sidebar-accent/15 text-sidebar-accent before:bg-sidebar-accent font-medium before:absolute before:inset-y-1 before:start-0 before:w-0.5 before:rounded-full before:content-['']"
                    : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/5',
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** Protected Company Admin shell: auth guard + sidebar + top bar. */
export function CompanyShell({ children }: { children: React.ReactNode }) {
  const { status, user, needsTwoFactorSetup, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const tShell = useTranslations('shell');
  // Pin the sidebar to the left in both languages: the shell chrome is LTR;
  // the page content keeps the locale's direction (RTL for Arabic).
  const contentDir = useLocale() === 'ar' ? 'rtl' : 'ltr';
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Read once on mount rather than during render: localStorage is unavailable
  // during SSR, and reading it in the render body would desync hydration.
  const [impersonating, setImpersonating] = useState(false);
  useEffect(() => setImpersonating(isImpersonating()), []);

  useEffect(() => {
    if (status === 'unauthenticated' || (status === 'authenticated' && needsTwoFactorSetup)) {
      router.replace('/login');
    } else if (status === 'authenticated' && user?.role === 'SUPER_ADMIN' && !impersonating) {
      // Platform admins belong in the Super Admin console — UNLESS they are
      // inside an audited impersonation, which exists precisely so they can use
      // this console as the tenant sees it.
      router.replace('/admin');
    }
  }, [status, needsTwoFactorSetup, user?.role, impersonating, router]);

  // Close the mobile drawer on navigation + on Escape.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileNavOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileNavOpen]);

  if (
    status === 'loading' ||
    status === 'unauthenticated' ||
    needsTwoFactorSetup ||
    (user?.role === 'SUPER_ADMIN' && !impersonating)
  ) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="text-primary size-6" />
      </div>
    );
  }

  return (
    <div className="bg-background flex min-h-screen flex-col" dir="ltr">
      <ImpersonationBanner />
      <div className="flex min-h-0 flex-1">
        <aside className="border-sidebar-border bg-sidebar text-sidebar-foreground hidden w-64 shrink-0 flex-col border-e md:flex">
          <div className="border-sidebar-border flex h-16 items-center border-b px-5">
            <Logo product="Signage" />
          </div>
          <NavLinks />
          <div className="border-sidebar-border text-sidebar-muted border-t p-4 text-xs">
            {tShell('companyConsole')}
          </div>
        </aside>

        {/* Mobile drawer + backdrop (md:hidden) */}
        {mobileNavOpen ? (
          <div className="fixed inset-0 z-50 md:hidden">
            <button
              type="button"
              aria-label={tShell('closeMenu')}
              className="absolute inset-0 bg-black/40"
              onClick={() => setMobileNavOpen(false)}
            />
            <div className="bg-sidebar text-sidebar-foreground border-sidebar-border absolute inset-y-0 start-0 flex w-64 flex-col border-e shadow-lg">
              <div className="border-sidebar-border flex h-16 items-center justify-between border-b px-5">
                <Logo product="Signage" />
                <button
                  type="button"
                  aria-label={tShell('closeMenu')}
                  className="text-sidebar-muted hover:text-sidebar-foreground rounded-md p-1"
                  onClick={() => setMobileNavOpen(false)}
                >
                  <X className="size-5" />
                </button>
              </div>
              <NavLinks onNavigate={() => setMobileNavOpen(false)} />
              <div className="border-sidebar-border text-sidebar-muted border-t p-4 text-xs">
                {tShell('companyConsole')}
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-border bg-card flex h-16 items-center justify-between gap-3 border-b px-4 md:px-6">
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label={tShell('openMenu')}
                className="text-muted-foreground hover:bg-muted hover:text-foreground -ms-1 rounded-md p-2 md:hidden"
                onClick={() => setMobileNavOpen(true)}
              >
                <Menu className="size-5" />
              </button>
              <span className="text-muted-foreground text-xs uppercase tracking-wide">
                {tShell('companyManagement')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <NotificationBell basePath="/company" />
              <LocaleSwitcher />
              <ThemeToggle />
              <div className="hidden text-end sm:block">
                <p className="text-sm font-medium leading-tight">{user?.name}</p>
                <p className="text-muted-foreground text-xs leading-tight">{user?.email}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => logout()}>
                {tShell('signOut')}
              </Button>
            </div>
          </header>
          <main dir={contentDir} className="flex-1 overflow-y-auto p-4 md:p-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
