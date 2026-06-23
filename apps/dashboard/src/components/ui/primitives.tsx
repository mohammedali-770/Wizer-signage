import { cloneElement, forwardRef, isValidElement, useId, type ReactElement } from 'react';

import { cn } from '@/lib/cn';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'bg-muted text-foreground hover:bg-muted/70',
  outline: 'border border-border bg-transparent hover:bg-muted',
  ghost: 'bg-transparent hover:bg-muted',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};
const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'focus-visible:ring-primary/40 inline-flex items-center justify-center gap-2 rounded-md font-medium transition focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'border-border bg-background placeholder:text-muted-foreground focus-visible:ring-primary/40 h-10 w-full rounded-md border px-3 text-sm outline-none transition focus-visible:ring-2 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'border-border bg-background placeholder:text-muted-foreground focus-visible:ring-primary/40 w-full rounded-md border px-3 py-2 text-sm outline-none transition focus-visible:ring-2',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'border-border bg-background focus-visible:ring-primary/40 h-10 w-full rounded-md border px-3 text-sm outline-none transition focus-visible:ring-2',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('text-foreground mb-1.5 block text-sm font-medium', className)}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  /** Optional inline validation message (shown in place of the hint, in red). */
  error?: string;
  children: React.ReactNode;
}) {
  // Associate the label with the control for accessibility: generate an id and
  // attach it to the single child input (unless it already has one).
  const generatedId = useId();
  let control = children;
  let controlId: string | undefined;
  if (isValidElement(children)) {
    const el = children as ReactElement<{ id?: string; 'aria-invalid'?: boolean }>;
    controlId = el.props.id ?? generatedId;
    control = cloneElement(el, {
      id: controlId,
      'aria-invalid': error ? true : el.props['aria-invalid'],
    });
  }
  return (
    <div>
      <Label htmlFor={controlId}>{label}</Label>
      {control}
      {error ? (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-muted-foreground mt-1 text-xs">{hint}</p>
      ) : null}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        'inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
    />
  );
}
