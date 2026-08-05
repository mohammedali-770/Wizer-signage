import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';

import { messagesForGroup } from '@/i18n/messages';
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

  // Re-provides the shared slice PLUS this group's namespaces. A nested
  // NextIntlClientProvider replaces rather than merges, so this must be the
  // union; the duplicated shared slice is the cost of not needing a
  // middleware-supplied pathname in the root layout.
  const messages = messagesForGroup(await getMessages(), 'marketing');

  return (
    <NextIntlClientProvider messages={messages}>
      <div dir="ltr" className="force-light flex min-h-screen flex-col bg-white text-slate-900">
        <MarketingNavbar />
        <main className="flex-1">{children}</main>
        <MarketingFooter />
      </div>
    </NextIntlClientProvider>
  );
}
