import { Orientation, ScheduleTargetType } from '@prisma/client';

import {
  type ConflictSchedule,
  compareSchedulePrecedence,
  expandTargets,
  pickWinner,
  scheduleActiveAt,
  schedulesConflict,
  type ScreenIndex,
  screenMatchesTargets,
} from './schedule-targeting';

function index(): ScreenIndex {
  return {
    allScreenIds: ['s1', 's2', 's3'],
    byId: new Map([
      [
        's1',
        { id: 's1', locationId: 'locA', orientation: Orientation.LANDSCAPE, groupIds: ['g1'] },
      ],
      ['s2', { id: 's2', locationId: 'locA', orientation: Orientation.PORTRAIT, groupIds: [] }],
      [
        's3',
        { id: 's3', locationId: 'locB', orientation: Orientation.LANDSCAPE, groupIds: ['g1'] },
      ],
    ]),
    byLocation: new Map([
      ['locA', ['s1', 's2']],
      ['locB', ['s3']],
    ]),
    byGroup: new Map([['g1', ['s1', 's3']]]),
  };
}

function schedule(over: Partial<ConflictSchedule> = {}): ConflictSchedule {
  return {
    id: 'sch1',
    name: 'Sch',
    priority: 0,
    scheduleType: 'NORMAL',
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    startDate: new Date('2026-06-01T00:00:00Z'),
    endDate: null,
    startTime: '09:00',
    endTime: '17:00',
    isAllDay: false,
    daysOfWeek: [],
    ...over,
  };
}

describe('schedule-targeting', () => {
  describe('expandTargets', () => {
    it('expands SCREEN/LOCATION/GROUP/COMPANY to screen ids', () => {
      const idx = index();
      expect([
        ...expandTargets([{ targetType: ScheduleTargetType.SCREEN, targetId: 's2' }], idx),
      ]).toEqual(['s2']);
      expect(
        [
          ...expandTargets([{ targetType: ScheduleTargetType.LOCATION, targetId: 'locA' }], idx),
        ].sort(),
      ).toEqual(['s1', 's2']);
      expect(
        [
          ...expandTargets([{ targetType: ScheduleTargetType.SCREEN_GROUP, targetId: 'g1' }], idx),
        ].sort(),
      ).toEqual(['s1', 's3']);
      expect(
        [
          ...expandTargets([{ targetType: ScheduleTargetType.COMPANY, targetId: 'c1' }], idx),
        ].sort(),
      ).toEqual(['s1', 's2', 's3']);
    });
  });

  describe('screenMatchesTargets', () => {
    it('matches by direct/location/group/company', () => {
      const s = {
        id: 's1',
        locationId: 'locA',
        orientation: Orientation.LANDSCAPE,
        groupIds: ['g1'],
      };
      expect(
        screenMatchesTargets(s, [{ targetType: ScheduleTargetType.SCREEN, targetId: 's1' }]),
      ).toBe(true);
      expect(
        screenMatchesTargets(s, [{ targetType: ScheduleTargetType.SCREEN, targetId: 'sX' }]),
      ).toBe(false);
      expect(
        screenMatchesTargets(s, [{ targetType: ScheduleTargetType.LOCATION, targetId: 'locA' }]),
      ).toBe(true);
      expect(
        screenMatchesTargets(s, [{ targetType: ScheduleTargetType.SCREEN_GROUP, targetId: 'g1' }]),
      ).toBe(true);
      expect(
        screenMatchesTargets(s, [{ targetType: ScheduleTargetType.COMPANY, targetId: 'c1' }]),
      ).toBe(true);
    });
  });

  describe('precedence', () => {
    it('higher priority wins', () => {
      const high = schedule({ id: 'high', priority: 10 });
      const low = schedule({ id: 'low', priority: 1 });
      expect(pickWinner(high, low)).toBe('high');
      expect(pickWinner(low, high)).toBe('high');
    });
    it('CAMPAIGN beats NORMAL at equal priority', () => {
      const campaign = schedule({ id: 'camp', scheduleType: 'CAMPAIGN', priority: 5 });
      const normal = schedule({ id: 'norm', scheduleType: 'NORMAL', priority: 5 });
      expect(pickWinner(campaign, normal)).toBe('camp');
      expect(pickWinner(normal, campaign)).toBe('camp');
    });
    it('newest updatedAt breaks a full tie deterministically', () => {
      const older = schedule({ id: 'old', updatedAt: new Date('2026-06-01T00:00:00Z') });
      const newer = schedule({ id: 'new', updatedAt: new Date('2026-06-10T00:00:00Z') });
      expect(pickWinner(older, newer)).toBe('new');
      expect(compareSchedulePrecedence(newer, older)).toBeLessThan(0);
    });
  });

  describe('schedulesConflict', () => {
    it('conflicts when screens, dates and time windows overlap', () => {
      const a = schedule({ id: 'a', startTime: '09:00', endTime: '12:00' });
      const b = schedule({ id: 'b', startTime: '11:00', endTime: '14:00' });
      const res = schedulesConflict(a, new Set(['s1', 's2']), b, new Set(['s2', 's3']));
      expect(res.conflicts).toBe(true);
      expect(res.sharedScreenIds).toEqual(['s2']);
    });
    it('no conflict without shared screens', () => {
      const a = schedule({ id: 'a' });
      const b = schedule({ id: 'b' });
      expect(schedulesConflict(a, new Set(['s1']), b, new Set(['s2'])).conflicts).toBe(false);
    });
    it('no conflict when time windows are disjoint', () => {
      const a = schedule({ id: 'a', startTime: '08:00', endTime: '09:00' });
      const b = schedule({ id: 'b', startTime: '10:00', endTime: '11:00' });
      expect(schedulesConflict(a, new Set(['s1']), b, new Set(['s1'])).conflicts).toBe(false);
    });
  });

  describe('scheduleActiveAt', () => {
    it('respects date range, day-of-week and time window', () => {
      const s = schedule({
        daysOfWeek: [1],
        startTime: '09:00',
        endTime: '17:00',
        startDate: new Date('2026-06-01T00:00:00Z'),
      });
      expect(scheduleActiveAt(s, '2026-06-15', 1, '10:00')).toBe(true); // Monday in window
      expect(scheduleActiveAt(s, '2026-06-15', 1, '18:00')).toBe(false); // outside time
      expect(scheduleActiveAt(s, '2026-06-16', 2, '10:00')).toBe(false); // wrong day
      expect(scheduleActiveAt(s, '2026-05-31', 0, '10:00')).toBe(false); // before start date
    });
    it('all-day schedule ignores time', () => {
      const s = schedule({ isAllDay: true, startTime: null, endTime: null, daysOfWeek: [] });
      expect(scheduleActiveAt(s, '2026-06-15', 1, '23:59')).toBe(true);
    });
  });
});
