'use client';

import { useState } from 'react';

import { useApiResource } from '@/lib/use-api';
import type { Content, Orientation, Paginated } from '@/lib/types';
import { Badge, Button, Dialog, EmptyState, Input, Spinner } from '@/components/ui';

/**
 * Selects a company fallback content item (Phase 4). Only ACTIVE content can be
 * chosen; the picker surfaces expiry and orientation warnings but does not block
 * (the player ignores invalid fallback in later phases).
 */
export function FallbackContentPicker({
  value,
  onChange,
  orientation,
  busy,
}: {
  value: string | null;
  onChange: (contentId: string | null) => void;
  /** Screen orientation, to warn on mismatch (omit for location/company). */
  orientation?: Orientation;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = useApiResource<Content>(value ? `/content/${value}` : null);

  const current = selected.data;
  const warnings: string[] = [];
  if (value && !selected.loading && selected.error) {
    warnings.push('The selected content is no longer available (archived, trashed, or removed).');
  }
  if (current && current.status !== 'ACTIVE') {
    warnings.push(
      `The selected content is ${current.status.toLowerCase()} and will not play until restored.`,
    );
  }
  if (current?.isExpired) warnings.push('The selected content has expired.');
  if (
    current &&
    orientation &&
    current.orientation !== 'UNKNOWN' &&
    current.orientation !== orientation
  ) {
    warnings.push(
      `Orientation mismatch: content is ${current.orientation}, screen is ${orientation}.`,
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {value ? (
          <span className="text-sm">
            {selected.loading ? 'Loading…' : (current?.title ?? 'Selected content')}
            {current ? (
              <Badge tone="neutral" className="ms-2">
                {current.type}
              </Badge>
            ) : null}
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">No fallback content selected.</span>
        )}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setOpen(true)}>
          {value ? 'Change' : 'Choose'}
        </Button>
        {value ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onChange(null)}>
            Clear
          </Button>
        ) : null}
      </div>

      {warnings.map((w) => (
        <p key={w} className="text-xs text-amber-600 dark:text-amber-400">
          ⚠ {w}
        </p>
      ))}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Select fallback content"
        className="max-w-2xl"
      >
        <div className="space-y-3">
          <Input
            placeholder="Search content…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <ContentChooser
            search={search}
            onPick={(id) => {
              onChange(id);
              setOpen(false);
            }}
          />
        </div>
      </Dialog>
    </div>
  );
}

function ContentChooser({ search, onPick }: { search: string; onPick: (id: string) => void }) {
  const q = new URLSearchParams({ status: 'ACTIVE', pageSize: '100' });
  if (search) q.set('search', search);
  const { data, loading, error } = useApiResource<Paginated<Content>>(`/content?${q.toString()}`);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner className="text-primary size-5" />
      </div>
    );
  }
  if (error) return <EmptyState title="Could not load content" description={error} />;
  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        title="No active content"
        description="Upload content first to use it as fallback."
      />
    );
  }

  return (
    <div className="max-h-80 space-y-1 overflow-y-auto">
      {data.items.map((c) => (
        <button
          key={c.id}
          onClick={() => onPick(c.id)}
          className="border-border hover:bg-muted flex w-full items-center justify-between rounded-md border px-3 py-2 text-start text-sm transition"
        >
          <span className="truncate">{c.title}</span>
          <span className="flex items-center gap-2">
            {c.isExpired ? <Badge tone="danger">Expired</Badge> : null}
            <Badge tone="neutral">{c.type}</Badge>
            <Badge tone="info">{c.orientation}</Badge>
          </span>
        </button>
      ))}
    </div>
  );
}
