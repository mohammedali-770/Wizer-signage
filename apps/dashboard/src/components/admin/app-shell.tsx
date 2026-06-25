'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Building2,
  CalendarClock,
  CreditCard,
  DatabaseBackup,
  FileText,
  LayoutDashboard,
  MessageSquare,
  Menu,
  Package,
  ScrollText,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react';

import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { NotificationBell } from '@/components/notification-bell';
import { Button, Spinner } from '@/components/ui';
import { Logo } from '@/components/brand/logo';

type NavItem = { href: string; tkey: string; icon: typeof LayoutDashboard; exact?: boolean };

// Labels resolve via the `adminNav` i18n namespace (en/ar). Routes are unchanged.
const NAV: NavItem[] = [
  { href: '/admin', tkey: 'overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/companies', tkey: 'companies', icon: Building2 },
  { href: '/admin/plans', tkey: 'plans', icon: Package },
  { href: '/admin/subscriptions', tkey: 'subscriptions', icon: CreditCard },
  { href: '/admin/trials', tkey: 'trials', icon: CalendarClock },
  { href: '/admin/demo-requests', tkey: 'demoRequests', icon: MessageSquare },
  { href: '/admin/invoices', tkey: 'invoices', icon: FileText },
  { href: '/admin/super-admins', tkey: 'superAdmins', icon: ShieldCheck },
  { href: '/admin/backups', tkey: 'backups', icon: DatabaseBackup },
  { href: '/admin/settings', tkey: 'settings', icon: Settings },
  { href: '/admin/activity-logs', tkey: 'activityLogs', icon: ScrollText },
];

/** Nav links shared by the desktop sidebar and the mobile drawer. */
function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const tNav = useTranslations('adminNav');
  return (
    <nav className="flex-1 space-y-1 overflow-y-auto p-3">
      {NAV.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
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
            {tNav(item.tkey)}
          </Link>
        );
      })}
    </nav>
  );
}

/** Protected Super Admin shell: auth guard + sidebar + top bar. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { status, user, needsTwoFactorSetup, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const tShell = useTranslations('shell');
  // Pin the sidebar to the left in both languages: chrome is LTR, content keeps locale dir.
  const contentDir = useLocale() === 'ar' ? 'rtl' : 'ltr';
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated' || (status === 'authenticated' && needsTwoFactorSetup)) {
      router.replace('/login');
    } else if (status === 'authenticated' && user && user.role !== 'SUPER_ADMIN') {
      // Company users belong in the Company console.
      router.replace('/company');
    }
  }, [status, needsTwoFactorSetup, user, router]);

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
    (user && user.role !== 'SUPER_ADMIN')
  ) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="text-primary size-6" />
      </div>
    );
  }

  return (
    <div className="bg-background flex min-h-screen" dir="ltr">
      <aside className="border-sidebar-border bg-sidebar text-sidebar-foreground hidden w-64 shrink-0 flex-col border-e md:flex">
        <div className="border-sidebar-border flex h-16 items-center border-b px-5">
          <Logo />
        </div>
        <NavLinks />
        <div className="border-sidebar-border text-sidebar-muted border-t p-4 text-xs">
          {tShell('adminConsole')}
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
              <Logo />
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
              {tShell('adminConsole')}
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
              {tShell('platformAdministration')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell basePath="/admin" />
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
  );
}
