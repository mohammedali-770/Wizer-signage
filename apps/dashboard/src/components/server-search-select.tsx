'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';

import { Input, Select } from '@/components/ui';
import { api } from '@/lib/api';
import {
  normalizeSelectorEntity,
  selectorEntityPath,
  selectorSearchPath,
  type SearchableSelectorType,
  type SelectorEntity,
} from '@/lib/selector-search';
import type { Paginated } from '@/lib/types';
import { useApiResource } from '@/lib/use-api';

export function ServerSearchSelect({
  type,
  value,
  onChange,
  emptyLabel = 'All',
  searchPlaceholder = 'Search…',
  disabled,
  required,
}: {
  type: SearchableSelectorType;
  value: string;
  onChange: (value: string) => void;
  emptyLabel?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedEntity, setSelectedEntity] = useState<SelectorEntity | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const resource = useApiResource<Paginated<Record<string, unknown>>>(
    selectorSearchPath(type, debouncedSearch),
  );
  const options = useMemo(
    () =>
      (resource.data?.items ?? [])
        .map((item) => normalizeSelectorEntity(type, item))
        .filter((item): item is SelectorEntity => item !== null),
    [resource.data, type],
  );

  useEffect(() => {
    if (!value) {
      setSelectedEntity(null);
      return;
    }
    const current = options.find((option) => option.id === value);
    if (current) {
      setSelectedEntity(current);
      return;
    }
    if (selectedEntity?.id === value) return;

    let active = true;
    void api
      .get<unknown>(selectorEntityPath(type, value))
      .then((payload) => {
        const entity = normalizeSelectorEntity(type, payload);
        if (active && entity) setSelectedEntity(entity);
      })
      .catch(() => {
        // Keep the id selected even if the label lookup fails. The list query
        // may succeed on the next search/reload and recover the human label.
      });
    return () => {
      active = false;
    };
  }, [options, selectedEntity?.id, type, value]);

  const selectOptions = useMemo(() => {
    if (!selectedEntity || options.some((option) => option.id === selectedEntity.id)) return options;
    return [selectedEntity, ...options];
  }, [options, selectedEntity]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={searchPlaceholder}
          className="ps-9"
          disabled={disabled}
          aria-label={searchPlaceholder}
        />
      </div>
      <Select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || resource.loading || !!resource.error}
        className="w-full"
        required={required}
      >
        <option value="">{emptyLabel}</option>
        {selectOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
