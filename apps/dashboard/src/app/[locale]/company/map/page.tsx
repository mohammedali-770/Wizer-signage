'use client';

import { useMemo } from 'react';
import { useLocale } from 'next-intl';
import { Info, MapPin, MapPinOff, Monitor } from 'lucide-react';

import { useApiResource } from '@/lib/use-api';
import { formatNumber } from '@/lib/format';
import type { LocationListItem, LocationStatus, Paginated } from '@/lib/types';
import { Link } from '@/i18n/navigation';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '@/components/ui';

/**
 * Map View — provider-flexible foundation.
 *
 * A real interactive map (Leaflet / Mapbox / Google) plugs in later once
 * `NEXT_PUBLIC_MAP_PROVIDER` and an API key are configured. Until then we keep
 * the abstraction in place and render the location list with coordinates so the
 * page is useful immediately.
 *
 * Status shown here is DERIVED from each location's lifecycle status — real
 * online/offline/warning status arrives with device heartbeats in a later phase.
 */

const MAP_PROVIDER = process.env.NEXT_PUBLIC_MAP_PROVIDER;

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

interface DerivedStatus {
  tone: BadgeTone;
  label: string;
}

/** Map a location's lifecycle status to a derived display status. */
function deriveStatus(status: LocationStatus): DerivedStatus {
  switch (status) {
    case 'ACTIVE':
      return { tone: 'info', label: 'Unknown (active)' };
    case 'INACTIVE':
      return { tone: 'neutral', label: 'Inactive' };
    case 'ARCHIVED':
      return { tone: 'neutral', label: 'Archived' };
    default:
      return { tone: 'neutral', label: 'Unknown' };
  }
}

const DOT_TONES: Record<BadgeTone, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-blue-500',
  neutral: 'bg-muted-foreground/50',
};

const LEGEND: { tone: BadgeTone; label: string }[] = [
  { tone: 'success', label: 'Online' },
  { tone: 'danger', label: 'Offline' },
  { tone: 'warning', label: 'Warning' },
  { tone: 'info', label: 'Unknown' },
];

function hasCoordinates(loc: LocationListItem): boolean {
  return typeof loc.latitude === 'number' && typeof loc.longitude === 'number';
}

export default function MapViewPage() {
  const locale = useLocale();
  const { data, loading, error } =
    useApiResource<Paginated<LocationListItem>>('/locations?pageSize=200');

  const items = useMemo(() => data?.items ?? [], [data]);

  return (
    <div>
      <PageHeader
        title="Map View"
        description="Your locations at a glance, with coordinates and screen counts. An interactive map can be enabled once a map provider is configured."
      />

      {!MAP_PROVIDER && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-sm text-blue-700 dark:text-blue-300">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            Configure{' '}
            <code className="rounded bg-blue-500/15 px-1 py-0.5 font-mono text-xs">
              NEXT_PUBLIC_MAP_PROVIDER
            </code>{' '}
            and a map API key to enable an interactive map. Showing the location list with
            coordinates for now.
          </p>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}

      {!loading && error && <EmptyState title="Could not load locations" description={error} />}

      {!loading && !error && items.length === 0 && (
        <EmptyState
          title="No locations yet"
          description="Create a location to see it on the map view."
        />
      )}

      {!loading && !error && items.length > 0 && (
        <div className="space-y-6">
          {/* Legend */}
          <Card className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                Status legend
              </span>
              {LEGEND.map((entry) => (
                <span key={entry.label} className="flex items-center gap-2 text-sm">
                  <span
                    className={`inline-block size-2.5 rounded-full ${DOT_TONES[entry.tone]}`}
                    aria-hidden
                  />
                  {entry.label}
                </span>
              ))}
            </div>
            <p className="text-muted-foreground mt-3 text-xs">
              Statuses below are derived from each location&apos;s lifecycle status. Real online /
              offline / warning status arrives with device heartbeats in a later phase.
            </p>
          </Card>

          {/* Location grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((loc) => {
              const derived = deriveStatus(loc.status);
              const place = [loc.city, loc.region].filter(Boolean).join(', ');
              const coords = hasCoordinates(loc);
              const lat = loc.latitude as number;
              const lon = loc.longitude as number;
              const mapHref = coords
                ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`
                : null;

              return (
                <Card key={loc.id} className="flex flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={`/company/locations/${loc.id}`}
                      className="text-foreground hover:text-primary font-medium hover:underline"
                    >
                      {loc.name}
                    </Link>
                    <span
                      className={`mt-1.5 inline-block size-2.5 shrink-0 rounded-full ${DOT_TONES[derived.tone]}`}
                      aria-hidden
                    />
                  </div>

                  <p className="text-muted-foreground mt-1 text-sm">
                    {place || 'No city / region'}
                  </p>

                  <div className="mt-3 flex items-center gap-2">
                    <Badge tone={derived.tone}>{derived.label}</Badge>
                    <span className="text-muted-foreground flex items-center gap-1 text-xs">
                      <Monitor className="size-3.5" aria-hidden />
                      {formatNumber(loc.screenCount, locale)}{' '}
                      {loc.screenCount === 1 ? 'screen' : 'screens'}
                    </span>
                  </div>

                  <div className="border-border mt-4 border-t pt-3">
                    {coords ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground flex items-center gap-1.5 font-mono text-xs">
                          <MapPin className="size-3.5" aria-hidden />
                          {lat.toFixed(5)}, {lon.toFixed(5)}
                        </span>
                        <a
                          href={mapHref ?? undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary text-xs font-medium hover:underline"
                        >
                          View on map
                        </a>
                      </div>
                    ) : (
                      <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                        <MapPinOff className="size-3.5" aria-hidden />
                        No coordinates
                      </span>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          <p className="text-muted-foreground text-xs">
            Showing {formatNumber(items.length, locale)}{' '}
            {items.length === 1 ? 'location' : 'locations'}.
          </p>
        </div>
      )}
    </div>
  );
}
