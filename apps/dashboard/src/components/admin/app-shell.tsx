'use client';

import { useEffect } from 'react';
import {
  Building2,
  CreditCard,
  DatabaseBackup,
  FileText,
  LayoutDashboard,
  Package,
  ScrollText,
  Settings,
  ShieldCheck,
} from 'lucide-react';

import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { NotificationBell } from '@/components/notification-bell';
import { Button, Spinner } from '@/components/ui';

const NAV = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/companies', label: 'Companies', icon: Building2 },
  { href: '/admin/plans', label: 'Plans', icon: Package },
  { href: '/admin/subscriptions', label: 'Subscriptions', icon: CreditCard },
  { href: '/admin/invoices', label: 'Invoices', icon: FileText },
  { href: '/admin/super-admins', label: 'Super Admins', icon: ShieldCheck },
  { href: '/admin/backups', label: 'Backups', icon: DatabaseBackup },
  { href: '/admin/settings', label: 'System Settings', icon: Settings },
  { href: '/admin/activity-logs', label: 'Activity Logs', icon: ScrollText },
];

/** Protected Super Admin shell: auth guard + sidebar + top bar. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { status, user, needsTwoFactorSetup, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'unauthenticated' || (status === 'authenticated' && needsTwoFactorSetup)) {
      router.replace('/login');
    } else if (status === 'authenticated' && user && user.role !== 'SUPER_ADMIN') {
      // Company users belong in the Company console.
      router.replace('/company');
    }
  }, [status, needsTwoFactorSetup, user, router]);

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
    <div className="bg-background flex min-h-screen">
      <aside className="border-border bg-card hidden w-64 shrink-0 flex-col border-e md:flex">
        <div className="border-border flex h-16 items-center gap-2 border-b px-5">
          <div className="bg-primary size-7 rounded-md" />
          <span className="font-semibold">MasterSignage</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition',
                  active
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-border text-muted-foreground border-t p-4 text-xs">
          Super Admin Console
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border bg-card flex h-16 items-center justify-between gap-3 border-b px-4 md:px-6">
          <span className="text-muted-foreground text-xs uppercase tracking-wide">
            Platform Administration
          </span>
          <div className="flex items-center gap-2">
            <NotificationBell basePath="/admin" />
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
