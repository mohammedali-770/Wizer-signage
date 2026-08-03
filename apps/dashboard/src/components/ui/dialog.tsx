'use client';

import { useCallback, useEffect, useId, useRef } from 'react';

import { cn } from '@/lib/cn';

/** Everything focusable, in DOM order, excluding anything explicitly removed from the tab ring. */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const focusable = useCallback(
    () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
    [],
  );

  // Move focus INTO the dialog on open, and put it back where it came from on
  // close. Without this a keyboard or screen-reader user is left with focus on
  // the page behind the overlay — they cannot reach the fields, and on close
  // they are returned to the top of the document rather than to the control
  // they activated.
  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    const id = window.setTimeout(() => (focusable()[0] ?? panelRef.current)?.focus(), 0);

    return () => {
      window.clearTimeout(id);
      restoreTo.current?.focus?.();
    };
  }, [open, focusable]);

  // Escape closes; Tab cycles WITHIN the dialog. An untrapped Tab walks out into
  // the page behind the overlay, where clicks are blocked but focus is not — so
  // the user ends up typing into a form they cannot see.
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const items = focusable();
      if (items.length === 0) {
        // Nothing to focus: hold focus on the panel rather than let it escape.
        e.preventDefault();
        panelRef.current?.focus();
        return;
      }

      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;

      if (e.shiftKey && (active === first || !panelRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, focusable]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'border-border bg-card relative z-10 w-full max-w-lg rounded-2xl border p-6 shadow-lg outline-none',
          className,
        )}
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {description ? (
          <p id={descriptionId} className="text-muted-foreground mt-1 text-sm">
            {description}
          </p>
        ) : null}
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
