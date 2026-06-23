'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Info, MapPin, MapPinOff, Monitor } from 'lucide-react';

import { useApiResource } from '@/lib/use-api';
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

/** Translation key suffix for a derived display status label. */
type DerivedLabelKey = 'unknownActive' | 'inactive' | 'archived' | 'unknown';

interface DerivedStatus {
  tone: BadgeTone;
  labelKey: DerivedLabelKey;
}

/** Map a location's lifecycle status to a derived display status. */
function deriveStatus(status: LocationStatus): DerivedStatus {
  switch (status) {
    case 'ACTIVE':
      return { tone: 'info', labelKey: 'unknownActive' };
    case 'INACTIVE':
      return { tone: 'neutral', labelKey: 'inactive' };
    case 'ARCHIVED':
      return { tone: 'neutral', labelKey: 'archived' };
    default:
      return { tone: 'neutral', labelKey: 'unknown' };
  }
}

const DOT_TONES: Record<BadgeTone, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-blue-600',
  neutral: 'bg-muted-foreground/50',
};

const LEGEND: { tone: BadgeTone; statusKey: string }[] = [
  { tone: 'success', statusKey: 'ONLINE' },
  { tone: 'danger', statusKey: 'OFFLINE' },
  { tone: 'warning', statusKey: 'WARNING' },
  { tone: 'info', statusKey: 'UNKNOWN' },
];

function hasCoordinates(loc: LocationListItem): boolean {
  return typeof loc.latitude === 'number' && typeof loc.longitude === 'number';
}

export default function MapViewPage() {
  const t = useTranslations('pages.map');
  const te = useTranslations('enums');
  const { data, loading, error } =
    useApiResource<Paginated<LocationListItem>>('/locations?pageSize=200');

  const items = useMemo(() => data?.items ?? [], [data]);

  return (
    <div>
      <PageHeader title={t('title')} description={t('description')} />

      {!MAP_PROVIDER && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-blue-600/40 bg-blue-600/10 px-4 py-3 text-sm text-blue-700 dark:text-blue-300">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            {t('providerHintBefore')}{' '}
            <code className="rounded bg-blue-600/15 px-1 py-0.5 font-mono text-xs">
              NEXT_PUBLIC_MAP_PROVIDER
            </code>{' '}
            {t('providerHintAfter')}
          </p>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}

      {!loading && error && <EmptyState title={t('loadError')} description={error} />}

      {!loading && !error && items.length === 0 && (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      )}

      {!loading && !error && items.length > 0 && (
        <div className="space-y-6">
          {/* Legend */}
          <Card className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                {t('statusLegend')}
              </span>
              {LEGEND.map((entry) => (
                <span key={entry.statusKey} className="flex items-center gap-2 text-sm">
                  <span
                    className={`inline-block size-2.5 rounded-full ${DOT_TONES[entry.tone]}`}
                    aria-hidden
                  />
                  {te(`screenStatus.${entry.statusKey}`)}
                </span>
              ))}
            </div>
            <p className="text-muted-foreground mt-3 text-xs">{t('legendNote')}</p>
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

                  <p className="text-muted-foreground mt-1 text-sm">{place || t('noCityRegion')}</p>

                  <div className="mt-3 flex items-center gap-2">
                    <Badge tone={derived.tone}>{t(`derivedStatus.${derived.labelKey}`)}</Badge>
                    <span className="text-muted-foreground flex items-center gap-1 text-xs">
                      <Monitor className="size-3.5" aria-hidden />
                      {t('screenCount', { count: loc.screenCount })}
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
                          {t('viewOnMap')}
                        </a>
                      </div>
                    ) : (
                      <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                        <MapPinOff className="size-3.5" aria-hidden />
                        {t('noCoordinates')}
                      </span>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          <p className="text-muted-foreground text-xs">
            {t('showingLocations', { count: items.length })}
          </p>
        </div>
      )}
    </div>
  );
}
