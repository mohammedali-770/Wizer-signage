import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';

import { messagesForGroup } from '@/i18n/messages';
import { CompanyShell } from '@/components/company/company-shell';

export default async function CompanyLayout({ children }: { children: React.ReactNode }) {
  // Re-provides the shared slice PLUS this group's namespaces. A nested
  // NextIntlClientProvider replaces rather than merges, so this must be the
  // union; the duplicated shared slice is the cost of not needing a
  // middleware-supplied pathname in the root layout.
  const messages = messagesForGroup(await getMessages(), 'company');

  return (
    <NextIntlClientProvider messages={messages}>
      <CompanyShell>{children}</CompanyShell>
    </NextIntlClientProvider>
  );
}
