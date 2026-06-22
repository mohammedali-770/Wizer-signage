/**
 * @master-signage/ui
 *
 * Shared React UI foundation for the MasterSignage dashboard.
 *
 * Consumed directly as TypeScript source (no build step). `react` and
 * `react-dom` are peer dependencies provided by the host app. Components are
 * styled exclusively with Tailwind utility classes and carry no business logic.
 *
 * Phase 0 scope: the class-name helper plus a handful of foundational
 * primitives. Richer components arrive in later phases.
 */

export { cn } from './cn';

export { Spinner } from './spinner';
export type { SpinnerProps, SpinnerSize } from './spinner';

export { Badge } from './badge';
export type { BadgeProps, BadgeVariant } from './badge';

export { Card } from './card';
