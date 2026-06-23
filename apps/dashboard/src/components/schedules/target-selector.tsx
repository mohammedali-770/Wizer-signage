'use client';

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';

import { useApiResource } from '@/lib/use-api';
import type {
  LocationListItem,
  Paginated,
  Screen,
  ScheduleTargetType,
  ScreenGroup,
} from '@/lib/types';
import { Badge, Button, Select } from '@/components/ui';

export interface SelectedTarget {
  targetType: ScheduleTargetType;
  targetId: string;
}

/**
 * Picks schedule targets (screens / groups / locations / company-wide). Renders
 * the current targets as removable chips and an "add" row. The parent owns the
 * list (local state for create, API calls for an existing schedule).
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

  const screens = useApiResource<Paginated<Screen>>('/screens?pageSize=100');
  const groups = useApiResource<Paginated<ScreenGroup>>('/screen-groups?pageSize=100');
  const locations = useApiResource<Paginated<LocationListItem>>('/locations?pageSize=100');

  const labelFor = useMemo(() => {
    const map = new Map<string, string>();
    screens.data?.items.forEach((s) => map.set(`SCREEN:${s.id}`, s.name));
    groups.data?.items.forEach((g) => map.set(`SCREEN_GROUP:${g.id}`, g.name));
    locations.data?.items.forEach((l) => map.set(`LOCATION:${l.id}`, l.name));
    return (t: SelectedTarget) =>
      t.targetType === 'COMPANY'
        ? 'Company-wide'
        : (map.get(`${t.targetType}:${t.targetId}`) ?? t.targetId);
  }, [screens.data, groups.data, locations.data]);

  const options =
    type === 'SCREEN'
      ? (screens.data?.items.map((s) => ({ id: s.id, name: s.name })) ?? [])
      : type === 'SCREEN_GROUP'
        ? (groups.data?.items.map((g) => ({ id: g.id, name: g.name })) ?? [])
        : type === 'LOCATION'
          ? (locations.data?.items.map((l) => ({ id: l.id, name: l.name })) ?? [])
          : [];

  const add = () => {
    if (type === 'COMPANY') {
      onAdd({ targetType: 'COMPANY', targetId: 'company' });
      return;
    }
    if (!entityId) return;
    if (targets.some((t) => t.targetType === type && t.targetId === entityId)) return;
    onAdd({ targetType: type, targetId: entityId });
    setEntityId('');
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {targets.length === 0 ? (
          <span className="text-muted-foreground text-sm">No targets yet.</span>
        ) : (
          targets.map((t, i) => (
            <Badge key={`${t.targetType}:${t.targetId}`} tone="info" className="gap-1">
              <span className="opacity-70">{t.targetType.replace('_', ' ').toLowerCase()}:</span>{' '}
              {labelFor(t)}
              {!busy ? (
                <button onClick={() => onRemove(t, i)} aria-label="Remove target" className="ms-1">
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
          onChange={(e) => {
            setType(e.target.value as ScheduleTargetType);
            setEntityId('');
          }}
          className="w-44"
        >
          <option value="SCREEN">Screen</option>
          <option value="SCREEN_GROUP">Screen group</option>
          <option value="LOCATION">Location</option>
          <option value="COMPANY">Company-wide</option>
        </Select>
        {type !== 'COMPANY' ? (
          <Select value={entityId} onChange={(e) => setEntityId(e.target.value)} className="flex-1">
            <option value="">Select…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
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
