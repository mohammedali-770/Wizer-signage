import { Orientation } from '@prisma/client';

import { orientationProfile, orientationWarning } from './orientation.util';

describe('orientation.util', () => {
  describe('orientationProfile', () => {
    it('classifies single-orientation playlists', () => {
      expect(orientationProfile([Orientation.LANDSCAPE, Orientation.LANDSCAPE])).toBe('LANDSCAPE');
      expect(orientationProfile([Orientation.PORTRAIT])).toBe('PORTRAIT');
    });
    it('classifies mixed and unknown', () => {
      expect(orientationProfile([Orientation.LANDSCAPE, Orientation.PORTRAIT])).toBe('MIXED');
      expect(orientationProfile([Orientation.UNKNOWN, Orientation.UNKNOWN])).toBe('UNKNOWN');
      expect(orientationProfile([])).toBe('UNKNOWN');
    });
    it('ignores UNKNOWN when a known orientation is present', () => {
      expect(orientationProfile([Orientation.UNKNOWN, Orientation.PORTRAIT])).toBe('PORTRAIT');
    });
  });

  describe('orientationWarning', () => {
    it('warns on a clear mismatch', () => {
      expect(orientationWarning('LANDSCAPE', Orientation.PORTRAIT)).toContain('landscape');
      expect(orientationWarning('PORTRAIT', Orientation.LANDSCAPE)).toContain('portrait');
    });
    it('does not warn when compatible or unknown', () => {
      expect(orientationWarning('LANDSCAPE', Orientation.LANDSCAPE)).toBeNull();
      expect(orientationWarning('UNKNOWN', Orientation.LANDSCAPE)).toBeNull();
      expect(orientationWarning('LANDSCAPE', Orientation.UNKNOWN)).toBeNull();
    });
    it('warns (softly) on a mixed playlist', () => {
      expect(orientationWarning('MIXED', Orientation.LANDSCAPE)).toContain('mixed');
    });
  });
});
