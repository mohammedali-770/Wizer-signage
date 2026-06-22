import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { ThemeProvider } from 'next-themes';
import { routing, type Locale } from '@/i18n/routing';
import { AppProviders } from '@/components/app-providers';
import '../globals.css';

export const metadata: Metadata = {
  title: 'MasterSignage',
  description: 'Multi-tenant digital signage management platform.',
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

  const messages = await getMessages();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
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
