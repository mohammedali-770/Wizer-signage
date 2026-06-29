import { Montserrat, Saira, Tajawal } from 'next/font/google';

/**
 * WIZER brand typography.
 * - English UI + website:  Montserrat  (--font-montserrat) -> --font-sans (en)
 * - WIZER wordmark / display headings (Latin): Saira  (--font-saira) -> --font-display (en)
 * - Arabic UI + website:   Tajawal     (--font-tajawal)    -> --font-sans + --font-display (ar)
 *
 * globals.css maps --font-sans / --font-display to these per locale; the WIZER
 * Latin wordmark always uses Saira via the `font-wordmark` Tailwind family.
 */
export const montserrat = Montserrat({
  subsets: ['latin'],
  variable: '--font-montserrat',
  display: 'swap',
});

export const saira = Saira({
  subsets: ['latin'],
  variable: '--font-saira',
  display: 'swap',
});

export const tajawal = Tajawal({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '700', '800'],
  variable: '--font-tajawal',
  display: 'swap',
});
