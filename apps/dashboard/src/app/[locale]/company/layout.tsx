import { CompanyShell } from '@/components/company/company-shell';

export default function CompanyLayout({ children }: { children: React.ReactNode }) {
  return <CompanyShell>{children}</CompanyShell>;
}
