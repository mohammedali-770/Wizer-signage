import { cn } from '@/lib/cn';

/* MasterSignage marketing visuals — pure CSS/SVG, brand-exact, no images.
   Brand: Master Navy #0B1220 · Deep Slate #1E293B · Signal Blue #2563EB
          Online Green #10B981 · Amber #F59E0B · Red #EF4444 · Purple #7C3AED */

type Tone = 'online' | 'offline' | 'warning';
const TONE_HEX: Record<Tone, string> = {
  online: '#10B981',
  offline: '#EF4444',
  warning: '#F59E0B',
};

/** A small status indicator dot with a soft pulse (online/offline/warning). */
export function StatusDot({ tone = 'online', className }: { tone?: Tone; className?: string }) {
  const color = TONE_HEX[tone];
  return (
    <span className={cn('relative inline-flex h-2.5 w-2.5', className)} aria-hidden>
      <span
        className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:hidden"
        style={{ backgroundColor: color }}
      />
      <span
        className="relative inline-flex h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: color }}
      />
    </span>
  );
}

/**
 * Decorative "connected screen grid" — tiled rounded screen frames with link
 * lines and status dots. Render at low opacity behind dark sections.
 */
export function ScreenGridPattern({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="100%"
      height="100%"
      viewBox="0 0 480 320"
      fill="none"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <defs>
        <pattern id="ms-screens" x="0" y="0" width="120" height="120" patternUnits="userSpaceOnUse">
          <rect x="22" y="26" width="76" height="50" rx="7" stroke="currentColor" strokeWidth="2" />
          <rect x="56" y="76" width="8" height="10" fill="currentColor" />
          <rect x="44" y="86" width="32" height="3" rx="1.5" fill="currentColor" />
          <circle cx="90" cy="34" r="3" fill="#10B981" />
          <path d="M98 51 H120 M60 76 V120 M0 51 H22" stroke="currentColor" strokeWidth="1.5" />
        </pattern>
      </defs>
      <rect width="480" height="320" fill="url(#ms-screens)" />
    </svg>
  );
}

/**
 * Stylized cloud-dashboard mock: sidebar + a grid of screen cards with live
 * status, plus a small playlist row. The hero's centrepiece.
 */
export function DashboardMockup({ className }: { className?: string }) {
  const screens: { name: string; tone: Tone; pct: string }[] = [
    { name: 'Lobby — Riyadh', tone: 'online', pct: '100%' },
    { name: 'Drive-thru — Jeddah', tone: 'online', pct: '100%' },
    { name: 'Cashier — Dammam', tone: 'warning', pct: '62%' },
    { name: 'Entrance — Mecca', tone: 'online', pct: '100%' },
    { name: 'Waiting — Khobar', tone: 'offline', pct: '—' },
    { name: 'Menu — Riyadh 2', tone: 'online', pct: '100%' },
  ];
  return (
    <div
      dir="ltr"
      className={cn(
        'overflow-hidden rounded-2xl border border-white/10 bg-[#0B1220] shadow-2xl ring-1 ring-white/5',
        className,
      )}
    >
      {/* window bar */}
      <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[#EF4444]/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#F59E0B]/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#10B981]/80" />
        <span className="ml-3 text-[11px] font-medium text-slate-400">
          app.mastersignage.com / screens
        </span>
      </div>
      <div className="grid grid-cols-[120px_1fr] gap-0">
        {/* sidebar */}
        <div className="hidden flex-col gap-1 border-r border-white/10 bg-[#1E293B] p-3 sm:flex">
          <div className="mb-2 h-5 w-20 rounded bg-white/10" />
          {['Overview', 'Screens', 'Content', 'Playlists', 'Schedule', 'Branches'].map((l, i) => (
            <div
              key={l}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px]',
                i === 1 ? 'bg-[#2563EB] text-white' : 'text-slate-400',
              )}
            >
              <span className="h-2 w-2 rounded-sm bg-current opacity-70" />
              {l}
            </div>
          ))}
        </div>
        {/* content */}
        <div className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="h-4 w-28 rounded bg-white/10" />
            <div className="h-6 w-20 rounded-md bg-[#2563EB]" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {screens.map((s) => (
              <div key={s.name} className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
                <div className="mb-2 aspect-video rounded-md bg-gradient-to-br from-[#2563EB]/30 to-[#7C3AED]/20" />
                <div className="flex items-center justify-between">
                  <span className="truncate text-[10px] font-medium text-slate-200">{s.name}</span>
                  <StatusDot tone={s.tone} />
                </div>
                <div className="mt-1 text-[9px] text-slate-500">sync {s.pct}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Android-TV pairing mock: a screen frame showing a large pairing code.
 * Used in the "How it works" / pairing sections.
 */
export function PairingMock({
  code = 'M7K-42Q',
  className,
}: {
  code?: string;
  className?: string;
}) {
  return (
    <div
      dir="ltr"
      className={cn('rounded-2xl border border-white/10 bg-[#0B1220] p-4 shadow-xl', className)}
    >
      <div className="rounded-xl bg-gradient-to-br from-[#1E293B] to-[#0B1220] p-6 text-center ring-1 ring-white/10">
        <p className="text-[11px] uppercase tracking-widest text-slate-400">Pair this screen</p>
        <p className="mt-3 font-mono text-3xl font-bold tracking-[0.3em] text-white">{code}</p>
        <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#10B981]/15 px-3 py-1 text-[11px] text-[#10B981]">
          <StatusDot tone="online" /> Waiting to connect…
        </div>
      </div>
    </div>
  );
}
