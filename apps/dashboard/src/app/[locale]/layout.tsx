import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';

import { sharedMessages } from '@/i18n/messages';
import { ThemeProvider } from 'next-themes';
import { routing, type Locale } from '@/i18n/routing';
import { AppProviders } from '@/components/app-providers';
import { montserrat, saira, tajawal } from '@/lib/fonts';
import '../globals.css';

export const metadata: Metadata = {
  title: {
    default: 'WIZER — Smart Systems. Clearer Decisions.',
    template: '%s · WIZER',
  },
  description:
    'WIZER builds SaaS products that connect systems, organize operations, and turn data into confident decisions. Wizer Signage is our cloud digital signage platform.',
};

/**
 * Pre-render a static route for each supported locale.
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

type LocaleLayoutProps = {
  children: React.ReactNode;
  // Next.js 15: dynamic route params are async (a Promise).
  params: Promise<{ locale: string }>;
};

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;

  // Reject unknown locales early.
  if (!routing.locales.includes(locale as Locale)) {
    notFound();
  }

  // Enable static rendering for this request's locale.
  setRequestLocale(locale);

  // The SHARED slice only. Each route group's layout re-provides the union of
  // this and its own namespaces; login and accept-invitation have no group
  // layout and are served entirely by what is here. Shipping the whole
  // catalogue put 83 KB of `en` (113 KB of `ar`) into every page's RSC payload,
  // including a login screen that renders six strings.
  const messages = sharedMessages(await getMessages());
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${montserrat.variable} ${saira.variable} ${tajawal.variable}`}
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground min-h-screen font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <NextIntlClientProvider messages={messages}>
            <AppProviders>{children}</AppProviders>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
