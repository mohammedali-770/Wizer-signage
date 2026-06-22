'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Toggles between light and dark themes via `next-themes`.
 *
 * Renders a stable placeholder until mounted to avoid hydration mismatches
 * (the resolved theme is only known on the client).
 */
export function ThemeToggle() {
  const t = useTranslations('theme');
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = resolvedTheme === 'dark';

  return (
    <button
      type="button"
      aria-label={t('toggle')}
      title={t('toggle')}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={cn(
        'border-border inline-flex h-9 w-9 items-center justify-center rounded-md border',
        'bg-background text-foreground transition-colors',
        'hover:bg-muted focus-visible:ring-primary focus-visible:outline-none focus-visible:ring-2',
      )}
    >
      {mounted && isDark ? (
        <Sun className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}
