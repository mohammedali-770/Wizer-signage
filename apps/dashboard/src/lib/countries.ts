/**
 * Curated country + international dial-code list for the marketing forms.
 * GCC first (the primary market), then wider MENA, then a few internationals.
 * Names are bilingual; dial codes use Latin digits. Easily extensible.
 */
export interface Country {
  /** ISO 3166-1 alpha-2 code (used as a stable key + compact label). */
  iso: string;
  /** International dialing code, e.g. "+966". */
  dial: string;
  en: string;
  ar: string;
}

export const COUNTRIES: Country[] = [
  { iso: 'SA', dial: '+966', en: 'Saudi Arabia', ar: 'السعودية' },
  { iso: 'AE', dial: '+971', en: 'United Arab Emirates', ar: 'الإمارات' },
  { iso: 'QA', dial: '+974', en: 'Qatar', ar: 'قطر' },
  { iso: 'KW', dial: '+965', en: 'Kuwait', ar: 'الكويت' },
  { iso: 'BH', dial: '+973', en: 'Bahrain', ar: 'البحرين' },
  { iso: 'OM', dial: '+968', en: 'Oman', ar: 'عُمان' },
  { iso: 'EG', dial: '+20', en: 'Egypt', ar: 'مصر' },
  { iso: 'JO', dial: '+962', en: 'Jordan', ar: 'الأردن' },
  { iso: 'LB', dial: '+961', en: 'Lebanon', ar: 'لبنان' },
  { iso: 'IQ', dial: '+964', en: 'Iraq', ar: 'العراق' },
  { iso: 'SY', dial: '+963', en: 'Syria', ar: 'سوريا' },
  { iso: 'YE', dial: '+967', en: 'Yemen', ar: 'اليمن' },
  { iso: 'PS', dial: '+970', en: 'Palestine', ar: 'فلسطين' },
  { iso: 'SD', dial: '+249', en: 'Sudan', ar: 'السودان' },
  { iso: 'LY', dial: '+218', en: 'Libya', ar: 'ليبيا' },
  { iso: 'TN', dial: '+216', en: 'Tunisia', ar: 'تونس' },
  { iso: 'DZ', dial: '+213', en: 'Algeria', ar: 'الجزائر' },
  { iso: 'MA', dial: '+212', en: 'Morocco', ar: 'المغرب' },
  { iso: 'TR', dial: '+90', en: 'Turkey', ar: 'تركيا' },
  { iso: 'PK', dial: '+92', en: 'Pakistan', ar: 'باكستان' },
  { iso: 'IN', dial: '+91', en: 'India', ar: 'الهند' },
  { iso: 'GB', dial: '+44', en: 'United Kingdom', ar: 'المملكة المتحدة' },
  { iso: 'US', dial: '+1', en: 'United States', ar: 'الولايات المتحدة' },
];

/** Localized display name for a country. */
export function countryLabel(c: Country, locale: string): string {
  return locale === 'ar' ? c.ar : c.en;
}
