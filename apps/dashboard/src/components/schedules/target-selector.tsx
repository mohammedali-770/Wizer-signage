'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';

import { api } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import {
  SELECTOR_RESULT_LIMIT,
  selectorEntityPath,
  selectorSearchPath,
  type SearchableSelectorType,
} from '@/lib/selector-search';
import type {
  LocationListItem,
  Paginated,
  Screen,
  ScheduleTargetType,
  ScreenGroup,
} from '@/lib/types';
import { Badge, Button, Input, Select } from '@/components/ui';

export interface SelectedTarget {
  targetType: ScheduleTargetType;
  targetId: string;
}

type SelectorEntity =
  | Pick<Screen, 'id' | 'name'>
  | Pick<ScreenGroup, 'id' | 'name'>
  | Pick<LocationListItem, 'id' | 'name'>;

/**
 * Picks schedule targets (screens / groups / locations / company-wide).
 *
 * Large tenants are searched SERVER-SIDE rather than downloading every page.
 * Only one bounded list is requested for the currently selected target type,
 * while existing selected targets are resolved individually when their label is
 * outside the current search result. Tenant size therefore never creates a
 * hidden "first 2,000" correctness ceiling.
 */
export function TargetSelector({
  targets,
  onAdd,
  onRemove,
  busy,
}: {
  targets: SelectedTarget[];
  onAdd: (target: SelectedTarget) => void;
  onRemove: (target: SelectedTarget, index: number) => void;
  busy?: boolean;
}) {
  const [type, setType] = useState<ScheduleTargetType>('SCREEN');
  const [entityId, setEntityId] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [resolvedLabels, setResolvedLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const searchableType = type === 'COMPANY' ? null : (type as SearchableSelectorType);
  const searchPath = searchableType ? selectorSearchPath(searchableType, debouncedSearch) : null;
  const resource = useApiResource<Paginated<SelectorEntity>>(searchPath);
  const options = useMemo(() => resource.data?.items ?? [], [resource.data]);

  // Cache labels from every search response we see. That means changing the
  // query never turns already-selected chips back into raw UUIDs.
  useEffect(() => {
    if (options.length === 0 || !searchableType) return;
    setResolvedLabels((current) => {
      let changed = false;
      const next = { ...current };
      for (const option of options) {
        const key = `${searchableType}:${option.id}`;
        if (next[key] !== option.name) {
          next[key] = option.name;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [options, searchableType]);

  // A selected target may not be in the current 50-result search page (or the
  // selector may open later on an existing schedule). Resolve only those few
  // missing labels individually instead of falling back to an all-pages crawl.
  useEffect(() => {
    let active = true;
    const missing = targets.filter((target) => {
      if (target.targetType === 'COMPANY') return false;
      return !resolvedLabels[`${target.targetType}:${target.targetId}`];
    });
    if (missing.length === 0) return;

    void Promise.all(
      missing.map(async (target) => {
        try {
          const entity = await api.get<SelectorEntity>(
            selectorEntityPath(target.targetType as SearchableSelectorType, target.targetId),
          );
          return [`${target.targetType}:${target.targetId}`, entity.name] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (!active) return;
      const valid = entries.filter((entry) => entry !== null);
      if (valid.length === 0) return;
      setResolvedLabels((current) => ({ ...current, ...Object.fromEntries(valid) }));
    });

    return () => {
      active = false;
    };
  }, [resolvedLabels, targets]);

  const labelFor = useMemo(
    () => (target: SelectedTarget) =>
      target.targetType === 'COMPANY'
        ? 'Company-wide'
        : (resolvedLabels[`${target.targetType}:${target.targetId}`] ?? target.targetId),
    [resolvedLabels],
  );

  const add = () => {
    if (type === 'COMPANY') {
      onAdd({ targetType: 'COMPANY', targetId: 'company' });
      return;
    }
    if (!entityId) return;
    if (targets.some((target) => target.targetType === type && target.targetId === entityId))
      return;
    onAdd({ targetType: type, targetId: entityId });
    setEntityId('');
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {targets.length === 0 ? (
          <span className="text-muted-foreground text-sm">No targets yet.</span>
        ) : (
          targets.map((target, index) => (
            <Badge key={`${target.targetType}:${target.targetId}`} tone="info" className="gap-1">
              <span className="opacity-70">
                {target.targetType.replace('_', ' ').toLowerCase()}:
              </span>{' '}
              {labelFor(target)}
              {!busy ? (
                <button
                  onClick={() => onRemove(target, index)}
                  aria-label="Remove target"
                  className="ms-1"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </Badge>
          ))
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Select
          value={type}
          onChange={(event) => {
            setType(event.target.value as ScheduleTargetType);
            setEntityId('');
            setSearch('');
            setDebouncedSearch('');
          }}
          className="w-44"
        >
          <option value="SCREEN">Screen</option>
          <option value="SCREEN_GROUP">Screen group</option>
          <option value="LOCATION">Location</option>
          <option value="COMPANY">Company-wide</option>
        </Select>

        {type !== 'COMPANY' ? (
          <div className="min-w-56 flex-1 space-y-2">
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setEntityId('');
                }}
                placeholder={`Search ${type.replace('_', ' ').toLowerCase()}s…`}
                className="ps-9"
                aria-label={`Search ${type.replace('_', ' ').toLowerCase()}s`}
              />
            </div>
            <Select
              value={entityId}
              onChange={(event) => setEntityId(event.target.value)}
              disabled={resource.loading || !!resource.error}
              className="w-full"
            >
              <option value="">
                {resource.loading
                  ? 'Searching…'
                  : resource.error
                    ? 'Search failed — try again'
                    : options.length === 0
                      ? 'No matches'
                      : 'Select…'}
              </option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
            <p className="text-muted-foreground text-xs">
              {resource.data?.meta?.total && resource.data.meta.total > SELECTOR_RESULT_LIMIT
                ? `${resource.data.meta.total} matches — refine your search to find any target.`
                : `Showing up to ${SELECTOR_RESULT_LIMIT} server matches.`}
            </p>
          </div>
        ) : null}

        <Button
          variant="outline"
          onClick={add}
          disabled={busy || (type !== 'COMPANY' && !entityId)}
        >
          Add target
        </Button>
      </div>
    </div>
  );
}
