'use client';

import { useEffect, useMemo, useState } from 'react';

import { ServerSearchMultiSelect } from '@/components/server-search-multi-select';
import type {
  SearchableSelectorType,
  SelectorEntity,
  TagApplicability,
} from '@/lib/selector-search';

/**
 * Adapter for existing forms that store only entity ids. Labels from the
 * current record and from subsequent searches are retained locally, so a
 * selected item stays readable while the operator performs unrelated searches.
 */
export function ServerSearchIdMultiSelect({
  type,
  valueIds,
  initialItems = [],
  onChangeIds,
  searchPlaceholder,
  emptyText,
  disabled,
  tagApplicability,
  excludeIds,
}: {
  type: SearchableSelectorType;
  valueIds: string[];
  initialItems?: SelectorEntity[];
  onChangeIds: (ids: string[]) => void;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  tagApplicability?: TagApplicability;
  excludeIds?: string[];
}) {
  const [known, setKnown] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialItems.map((item) => [item.id, item.name])),
  );

  useEffect(() => {
    if (initialItems.length === 0) return;
    setKnown((current) => {
      const next = { ...current };
      for (const item of initialItems) next[item.id] = item.name;
      return next;
    });
  }, [initialItems]);

  const value = useMemo<SelectorEntity[]>(
    () => valueIds.map((id) => ({ id, name: known[id] ?? id })),
    [known, valueIds],
  );

  return (
    <ServerSearchMultiSelect
      type={type}
      value={value}
      onChange={(items) => {
        setKnown((current) => {
          const next = { ...current };
          for (const item of items) next[item.id] = item.name;
          return next;
        });
        onChangeIds(items.map((item) => item.id));
      }}
      searchPlaceholder={searchPlaceholder}
      emptyText={emptyText}
      disabled={disabled}
      tagApplicability={tagApplicability}
      excludeIds={excludeIds}
    />
  );
}
