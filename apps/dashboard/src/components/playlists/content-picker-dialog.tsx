'use client';

import { useState } from 'react';

import { useApiResource } from '@/lib/use-api';
import type { Content, ContentType, Orientation, Paginated } from '@/lib/types';
import { Badge, Dialog, EmptyState, Input, Select, Spinner } from '@/components/ui';

export interface PickedContent {
  id: string;
  title: string;
  type: ContentType;
  orientation: Orientation;
}

/**
 * Picks ACTIVE content from the library to add to a playlist. Stays open so
 * several items can be added in one session; the parent performs the add and
 * may pass `busy` to disable the list during the request.
 */
export function ContentPickerDialog({
  open,
  onClose,
  onPick,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (content: PickedContent) => void;
  busy?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [orientation, setOrientation] = useState('');

  const params = new URLSearchParams({ status: 'ACTIVE', expiry: 'active', pageSize: '100' });
  if (search) params.set('search', search);
  if (type) params.set('type', type);
  if (orientation) params.set('orientation', orientation);
  const { data, loading, error } = useApiResource<Paginated<Content>>(
    open ? `/content?${params.toString()}` : null,
  );

  return (
    <Dialog open={open} onClose={onClose} title="Add content" className="max-w-2xl">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="Search content…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1"
          />
          <Select value={type} onChange={(e) => setType(e.target.value)} className="w-36">
            <option value="">All types</option>
            <option value="IMAGE">Image</option>
            <option value="VIDEO">Video</option>
            <option value="PDF">PDF</option>
            <option value="URL">URL</option>
            <option value="TEXT">Text</option>
          </Select>
          <Select
            value={orientation}
            onChange={(e) => setOrientation(e.target.value)}
            className="w-40"
          >
            <option value="">Any orientation</option>
            <option value="LANDSCAPE">Landscape</option>
            <option value="PORTRAIT">Portrait</option>
            <option value="UNKNOWN">Unknown</option>
          </Select>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner className="text-primary size-5" />
          </div>
        ) : error ? (
          <EmptyState title="Could not load content" description={error} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title="No active content"
            description="Only active, non-expired content can be added."
          />
        ) : (
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {data.items.map((c) => (
              <button
                key={c.id}
                disabled={busy}
                onClick={() =>
                  onPick({ id: c.id, title: c.title, type: c.type, orientation: c.orientation })
                }
                className="border-border hover:bg-muted flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition disabled:opacity-50"
              >
                <span className="truncate">{c.title}</span>
                <span className="flex items-center gap-2">
                  <Badge tone="neutral">{c.type}</Badge>
                  <Badge tone="info">{c.orientation}</Badge>
                </span>
              </button>
            ))}
          </div>
        )}
        <p className="text-muted-foreground text-xs">
          Click an item to add it. Expired, archived, or trashed content is hidden.
        </p>
      </div>
    </Dialog>
  );
}
