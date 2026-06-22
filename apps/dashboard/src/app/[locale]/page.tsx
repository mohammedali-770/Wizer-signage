'use client';

import { useEffect } from 'react';

import { useRouter } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth-context';
import { roleHome } from '@/lib/roles';
import { Spinner } from '@/components/ui';

/** Routes the visitor to the right area: login, Super Admin, or Company console. */
export default function LocaleHome() {
  const { status, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'unauthenticated') router.replace('/login');
    else router.replace(roleHome(user?.role));
  }, [status, user?.role, router]);

  return (
    <div className="bg-background flex min-h-screen items-center justify-center">
      <Spinner className="text-primary size-6" />
    </div>
  );
}
