'use client';

import { useEffect } from 'react';

import { cn } from '@/lib/cn';

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'border-border bg-card relative z-10 w-full max-w-lg rounded-2xl border p-6 shadow-lg',
          className,
        )}
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        {description ? <p className="text-muted-foreground mt-1 text-sm">{description}</p> : null}
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
