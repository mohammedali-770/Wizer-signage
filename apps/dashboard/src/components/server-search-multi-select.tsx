'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';

import { Badge, Input, Spinner } from '@/components/ui';
import {
  normalizeSelectorEntity,
  selectorSearchPath,
  type SearchableSelectorType,
  type SelectorEntity,
  type TagApplicability,
} from '@/lib/selector-search';
import type { Paginated } from '@/lib/types';
import { useApiResource } from '@/lib/use-api';

/**
 * Bounded server-search multi-select. Selected entities are caller-owned and
 * therefore survive query changes; only the candidate page is replaced.
 */
export function ServerSearchMultiSelect({
  type,
  value,
  onChange,
  searchPlaceholder = 'Search…',
  emptyText = 'No results',
  disabled,
  tagApplicability,
  excludeIds = [],
}: {
  type: SearchableSelectorType;
  value: SelectorEntity[];
  onChange: (value: SelectorEntity[]) => void;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  tagApplicability?: TagApplicability;
  excludeIds?: string[];
}) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const resource = useApiResource<Paginated<Record<string, unknown>>>(
    selectorSearchPath(type, debouncedSearch, { tagApplicability }),
  );
  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);
  const selectedIds = useMemo(() => new Set(value.map((item) => item.id)), [value]);
  const options = useMemo(
    () =>
      (resource.data?.items ?? [])
        .map((item) => normalizeSelectorEntity(type, item))
        .filter((item): item is SelectorEntity => item !== null && !excluded.has(item.id)),
    [excluded, resource.data, type],
  );

  const toggle = (item: SelectorEntity) => {
    if (disabled) return;
    onChange(
      selectedIds.has(item.id) ? value.filter((v) => v.id !== item.id) : [...value, item],
    );
  };

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(value.filter((v) => v.id !== item.id))}
              className="focus-visible:ring-primary/40 rounded-full focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50"
            >
              <Badge tone="info">
                {item.name} <X aria-hidden className="ms-1 inline size-3" />
              </Badge>
            </button>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="ps-9"
          disabled={disabled}
        />
      </div>

      {resource.loading && options.length === 0 ? (
        <div className="text-muted-foreground flex items-center gap-2 py-2 text-sm">
          <Spinner className="size-4" />
          {searchPlaceholder}
        </div>
      ) : resource.error ? (
        <p className="text-destructive text-sm">{resource.error}</p>
      ) : options.length === 0 ? (
        <p className="text-muted-foreground py-2 text-sm">{emptyText}</p>
      ) : (
        <ul className="divide-border border-border max-h-56 divide-y overflow-y-auto rounded-md border">
          {options.map((item) => {
            const checked = selectedIds.has(item.id);
            return (
              <li key={item.id}>
                <label className="hover:bg-muted flex cursor-pointer items-center gap-3 px-3 py-2 transition">
                  <input
                    type="checkbox"
                    className="border-border accent-primary size-4 rounded"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggle(item)}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
