import { Inter, Manrope } from 'next/font/google';
import localFont from 'next/font/local';

/**
 * Brand typography (MasterSignage brand guidelines v1.0).
 * - English UI:        Inter      (--font-inter)
 * - English marketing: Manrope    (--font-manrope, used for display headings)
 * - Arabic:            Thmanyah Sans (--font-arabic, self-hosted woff2)
 *
 * globals.css maps --font-sans / --font-display to these per locale:
 *   en -> Inter / Manrope, ar -> Thmanyah Sans for both.
 */
export const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
  display: 'swap',
});

export const thmanyah = localFont({
  variable: '--font-arabic',
  display: 'swap',
  src: [
    { path: '../fonts/thmanyah/thmanyahsans-Light.woff2', weight: '300', style: 'normal' },
    { path: '../fonts/thmanyah/thmanyahsans-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/thmanyah/thmanyahsans-Medium.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/thmanyah/thmanyahsans-Bold.woff2', weight: '700', style: 'normal' },
    { path: '../fonts/thmanyah/thmanyahsans-Black.woff2', weight: '900', style: 'normal' },
  ],
});
