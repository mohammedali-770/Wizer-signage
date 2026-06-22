import {
  dateInRange,
  localMoment,
  sharedDays,
  timeInWindow,
  timeRangesOverlap,
  windowsOverlap,
} from './schedule-time.util';

describe('schedule-time.util', () => {
  describe('localMoment', () => {
    it('resolves weekday/clock/date in a timezone', () => {
      const at = new Date('2026-06-15T12:00:00Z'); // a Monday
      const ny = localMoment(at, 'America/New_York'); // UTC-4 (DST)
      expect(ny).toEqual({ weekday: 1, hhmm: '08:00', ymd: '2026-06-15' });
      const tokyo = localMoment(at, 'Asia/Tokyo'); // UTC+9
      expect(tokyo).toEqual({ weekday: 1, hhmm: '21:00', ymd: '2026-06-15' });
    });

    it('rolls the date across midnight by timezone', () => {
      const at = new Date('2026-06-15T01:00:00Z'); // Monday 01:00 UTC
      const la = localMoment(at, 'America/Los_Angeles'); // Sunday 18:00 prior day
      expect(la.ymd).toBe('2026-06-14');
      expect(la.weekday).toBe(0); // Sunday
    });

    it('falls back to UTC for an unknown timezone', () => {
      const at = new Date('2026-06-15T12:00:00Z');
      expect(localMoment(at, 'Not/AZone').hhmm).toBe('12:00');
    });
  });

  describe('timeInWindow', () => {
    it('matches a normal daytime window', () => {
      expect(timeInWindow('10:00', '09:00', '17:00')).toBe(true);
      expect(timeInWindow('08:59', '09:00', '17:00')).toBe(false);
      expect(timeInWindow('17:00', '09:00', '17:00')).toBe(false); // end exclusive
    });

    it('matches an overnight window (end < start)', () => {
      expect(timeInWindow('23:30', '22:00', '06:00')).toBe(true);
      expect(timeInWindow('02:00', '22:00', '06:00')).toBe(true);
      expect(timeInWindow('12:00', '22:00', '06:00')).toBe(false);
    });

    it('treats start === end as all-day', () => {
      expect(timeInWindow('03:00', '00:00', '00:00')).toBe(true);
    });
  });

  describe('dateInRange', () => {
    it('is inclusive and treats null bounds as open', () => {
      expect(dateInRange('2026-06-15', '2026-06-01', '2026-06-30')).toBe(true);
      expect(dateInRange('2026-06-15', '2026-06-16', null)).toBe(false);
      expect(dateInRange('2026-06-15', null, '2026-06-14')).toBe(false);
      expect(dateInRange('2026-06-15', null, null)).toBe(true);
    });
  });

  describe('sharedDays / windowsOverlap', () => {
    it('empty day set means every day', () => {
      expect(sharedDays([], [3])).toBe(true);
      expect(sharedDays([1, 2], [3, 4])).toBe(false);
    });

    it('overlaps when days + times intersect', () => {
      expect(windowsOverlap([1], '09:00', '12:00', false, [1], '11:00', '14:00', false)).toBe(true);
      expect(windowsOverlap([1], '09:00', '10:00', false, [1], '11:00', '14:00', false)).toBe(
        false,
      );
      expect(windowsOverlap([1], '09:00', '10:00', false, [2], '09:00', '10:00', false)).toBe(
        false,
      );
      expect(windowsOverlap([1], '00:00', '00:00', true, [1], '09:00', '10:00', false)).toBe(true);
    });
  });

  describe('timeRangesOverlap with overnight spans', () => {
    it('detects overlap across midnight', () => {
      expect(timeRangesOverlap('22:00', '06:00', '05:00', '07:00')).toBe(true);
      expect(timeRangesOverlap('22:00', '06:00', '07:00', '08:00')).toBe(false);
    });
  });
});
