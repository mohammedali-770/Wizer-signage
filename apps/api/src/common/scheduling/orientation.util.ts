import { Orientation } from '@prisma/client';

/** Aggregate orientation of a playlist's content. */
export type OrientationProfile = 'LANDSCAPE' | 'PORTRAIT' | 'MIXED' | 'UNKNOWN';

/** Derive a playlist's orientation profile from its items' content orientations. */
export function orientationProfile(orientations: Orientation[]): OrientationProfile {
  const known = orientations.filter(
    (o) => o === Orientation.LANDSCAPE || o === Orientation.PORTRAIT,
  );
  if (known.length === 0) return 'UNKNOWN';
  const hasLandscape = known.includes(Orientation.LANDSCAPE);
  const hasPortrait = known.includes(Orientation.PORTRAIT);
  if (hasLandscape && hasPortrait) return 'MIXED';
  return hasLandscape ? 'LANDSCAPE' : 'PORTRAIT';
}

/**
 * A human-readable orientation warning when a playlist profile does not match a
 * screen's orientation, or null when they are compatible. Warning-only — callers
 * never block on this.
 */
export function orientationWarning(
  profile: OrientationProfile,
  screenOrientation: Orientation,
  label = 'Playlist',
): string | null {
  if (screenOrientation === Orientation.UNKNOWN || profile === 'UNKNOWN') return null;
  if (profile === 'MIXED') {
    return `${label} has mixed orientations; some content may not fit a ${screenOrientation.toLowerCase()} screen.`;
  }
  if (profile !== screenOrientation) {
    return `${label} is ${profile.toLowerCase()} but the screen is ${screenOrientation.toLowerCase()}.`;
  }
  return null;
}
