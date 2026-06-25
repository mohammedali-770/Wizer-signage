import { setRequestLocale } from 'next-intl/server';

import { MarketingNavbar } from '@/components/marketing/navbar';
import { MarketingFooter } from '@/components/marketing/footer';

/**
 * Public marketing shell (navbar + footer). Sits inside the locale layout, so
 * it inherits fonts, i18n, and `dir`. Marketing is brand-fixed light: sections
 * set explicit brand colors rather than theme tokens.
 */
export default async function MarketingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <MarketingNavbar />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  );
}
