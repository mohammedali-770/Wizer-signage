import Image from 'next/image';

import { cn } from '@/lib/cn';

/**
 * MasterSignage brand lockup for dark surfaces (the navy command-center
 * sidebar + mobile drawer): the official mark, recolored white/Signal-Blue for
 * navy, plus the wordmark. "Master" inherits the surrounding color (white on
 * the sidebar); "Signage" is Signal Blue.
 */
export function Logo({
  className,
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <Image
        src="/brand/master-signage-mark-white.png"
        alt={showWordmark ? '' : 'MasterSignage'}
        width={43}
        height={32}
        className="shrink-0"
      />
      {showWordmark ? (
        <span className="font-display text-lg font-bold tracking-tight">
          Master<span className="text-primary">Signage</span>
        </span>
      ) : null}
    </span>
  );
}
