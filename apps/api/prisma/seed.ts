/**
 * Database seed.
 *
 * Idempotently creates a starter Plan, a demo Company (+ trialing Subscription),
 * a platform Super Admin, and a Company Admin so the platform is usable right
 * after `prisma migrate deploy`. Credentials come from SEED_* env vars and fall
 * back to safe-to-change defaults (printed at the end).
 *
 * Run: pnpm --filter @master-signage/api db:seed
 */
import { PrismaClient, SubscriptionStatus, UserRole, UserStatus } from '@prisma/client';
import { hash } from '@node-rs/argon2';

const prisma = new PrismaClient();

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function main(): Promise<void> {
  const superEmail = (
    process.env.SEED_SUPERADMIN_EMAIL ?? 'superadmin@mastersignage.local'
  ).toLowerCase();
  const superPassword = process.env.SEED_SUPERADMIN_PASSWORD ?? 'ChangeMe!2026Admin';
  const superName = process.env.SEED_SUPERADMIN_NAME ?? 'Platform Super Admin';
  const companyName = process.env.SEED_COMPANY_NAME ?? 'Demo Company';
  const usingDefaults = !process.env.SEED_SUPERADMIN_PASSWORD;

  // --- Starter plan ------------------------------------------------------
  const plan = await prisma.plan.upsert({
    where: { code: 'starter' },
    update: {},
    create: {
      name: 'Starter',
      code: 'starter',
      description: 'Default starter plan (seeded).',
      priceMonthly: 0,
      currency: 'USD',
      trialDays: 14,
      limits: {
        maxScreens: 10,
        maxLocations: 3,
        maxUsers: 10,
        storageGb: 5,
        maxFileSizeMb: 200,
        autoScreenshotsPerDay: 24,
        scheduledReports: 5,
        dataRetentionDays: 90,
        apiRequestsPerDay: 0,
        webhooks: 0,
      },
    },
  });

  // --- Demo company + subscription ---------------------------------------
  const company = await prisma.company.upsert({
    where: { slug: slugify(companyName) },
    update: {},
    create: {
      name: companyName,
      slug: slugify(companyName),
      status: 'ACTIVE',
      subscription: {
        create: {
          planId: plan.id,
          status: SubscriptionStatus.TRIALING,
          trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          currentPeriodStart: new Date(),
        },
      },
    },
  });

  // --- Super Admin (platform-level; will be forced to enrol 2FA on login) -
  const superHash = await hash(superPassword);
  const superAdmin = await prisma.user.upsert({
    where: { email: superEmail },
    update: {},
    create: {
      email: superEmail,
      name: superName,
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      companyId: null,
      passwordHash: superHash,
      emailVerifiedAt: new Date(),
      passwordHistory: { create: { passwordHash: superHash } },
    },
  });

  // --- Demo Company Admin ------------------------------------------------
  const adminEmail = `admin@${company.slug}.local`;
  const adminPassword = process.env.SEED_COMPANYADMIN_PASSWORD ?? 'ChangeMe!2026Company';
  const adminHash = await hash(adminPassword);
  const companyAdmin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: 'Company Admin',
      role: UserRole.COMPANY_ADMIN,
      status: UserStatus.ACTIVE,
      companyId: company.id,
      passwordHash: adminHash,
      emailVerifiedAt: new Date(),
      passwordHistory: { create: { passwordHash: adminHash } },
    },
  });

  /* eslint-disable no-console */
  console.log('\nMasterSignage seed complete:');
  console.log(`  Plan:           ${plan.name} (${plan.code})`);
  console.log(`  Company:        ${company.name} [${company.id}]`);
  console.log(`  Super Admin:    ${superAdmin.email}`);
  console.log(`  Company Admin:  ${companyAdmin.email}`);
  if (usingDefaults) {
    console.log('\n  ⚠  Default credentials in use — CHANGE THESE IMMEDIATELY:');
    console.log(`     Super Admin:   ${superEmail} / ${superPassword}`);
    console.log(`     Company Admin: ${adminEmail} / ${adminPassword}`);
    console.log('     Set SEED_SUPERADMIN_PASSWORD / SEED_COMPANYADMIN_PASSWORD to override.');
  }
  console.log('\n  Note: the Super Admin must enrol 2FA on first login (mandatory).\n');
  /* eslint-enable no-console */
}

main()
  .catch((error) => {
    /* eslint-disable-next-line no-console */
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
