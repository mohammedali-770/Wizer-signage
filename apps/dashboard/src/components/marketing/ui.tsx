import { cn } from '@/lib/cn';
import { Reveal } from '@/components/marketing/reveal';

/** Centered max-width content container with responsive padding. */
export function Container({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8', className)}>{children}</div>
  );
}

type SectionHeadingProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  align?: 'center' | 'start';
  tone?: 'light' | 'dark';
  className?: string;
};

/** Eyebrow + title + subtitle block used at the top of marketing sections. */
export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = 'center',
  tone = 'light',
  className,
}: SectionHeadingProps) {
  return (
    <Reveal
      className={cn(
        'flex flex-col gap-3',
        align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl',
        className,
      )}
    >
      {eyebrow ? (
        <span className="text-sm font-semibold uppercase tracking-wider text-[#2563EB]">
          {eyebrow}
        </span>
      ) : null}
      <h2
        className={cn(
          'font-display text-3xl font-bold tracking-tight sm:text-4xl',
          tone === 'dark' ? 'text-white' : 'text-slate-900',
        )}
      >
        {title}
      </h2>
      {subtitle ? (
        <p
          className={cn(
            'text-lg leading-relaxed',
            tone === 'dark' ? 'text-slate-300' : 'text-slate-600',
          )}
        >
          {subtitle}
        </p>
      ) : null}
    </Reveal>
  );
}

/** Rounded icon chip used on feature/benefit cards. */
export function IconBadge({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#2563EB]/10 text-[#2563EB]',
        className,
      )}
    >
      {children}
    </span>
  );
}
