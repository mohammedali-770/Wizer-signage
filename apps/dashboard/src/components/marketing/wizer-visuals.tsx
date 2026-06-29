import { cn } from '@/lib/cn';

/* WIZER "connected intelligence" visuals — pure SVG, brand-exact, language-neutral.
   Navy #0B1020 · Blue #2563EB · Cyan #06B6D4. Placeholder identity art.
   TODO(brand): replace with official network artwork from the brand board. */

/**
 * Central WIZER node connected to a ring of product nodes — the "modular product
 * ecosystem / connected intelligence network". Sits on dark (navy) hero surfaces.
 */
export function NetworkHero({ className }: { className?: string }) {
  // 6 satellites around a center node (matches the 6 future products + signage).
  const satellites = [
    { x: 160, y: 28, c: '#2563EB', r: 9 }, // top — Signage (highlighted)
    { x: 268, y: 96, c: '#06B6D4', r: 6 },
    { x: 268, y: 204, c: '#2563EB', r: 6 },
    { x: 160, y: 272, c: '#06B6D4', r: 6 },
    { x: 52, y: 204, c: '#2563EB', r: 6 },
    { x: 52, y: 96, c: '#06B6D4', r: 6 },
  ];
  const cx = 160;
  const cy = 150;
  return (
    <div
      dir="ltr"
      className={cn(
        'relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#0B1020] to-[#111a33] p-6 shadow-2xl ring-1 ring-white/5',
        className,
      )}
    >
      <svg viewBox="0 0 320 300" className="h-full w-full" fill="none" aria-hidden="true">
        {/* links */}
        {satellites.map((s, i) => (
          <line
            key={`l-${i}`}
            x1={cx}
            y1={cy}
            x2={s.x}
            y2={s.y}
            stroke="#2563EB"
            strokeWidth="1.25"
            opacity="0.35"
          />
        ))}
        {/* faint ring */}
        <circle cx={cx} cy={cy} r="122" stroke="#2563EB" strokeWidth="1" opacity="0.12" />
        {/* satellites */}
        {satellites.map((s, i) => (
          <g key={`s-${i}`}>
            <circle cx={s.x} cy={s.y} r={s.r + 6} fill={s.c} opacity="0.12" />
            <circle cx={s.x} cy={s.y} r={s.r} fill={s.c} />
          </g>
        ))}
        {/* center node (WIZER) */}
        <circle cx={cx} cy={cy} r="34" fill="#2563EB" opacity="0.14" />
        <circle cx={cx} cy={cy} r="22" fill="url(#wz-core)" />
        <text
          x={cx}
          y={cy + 5}
          textAnchor="middle"
          className="font-wordmark"
          fontSize="13"
          fontWeight="700"
          fill="#FFFFFF"
          letterSpacing="1"
        >
          W
        </text>
        <defs>
          <linearGradient id="wz-core" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2563EB" />
            <stop offset="1" stopColor="#06B6D4" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

/** Small status pill — "Available now" (green) or "Coming soon" (slate). */
export function StatusPill({ available, label }: { available?: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        available ? 'bg-[#10B981]/15 text-[#059669]' : 'bg-slate-200 text-slate-500',
      )}
    >
      <span
        className={cn('h-1.5 w-1.5 rounded-full', available ? 'bg-[#10B981]' : 'bg-slate-400')}
      />
      {label}
    </span>
  );
}
