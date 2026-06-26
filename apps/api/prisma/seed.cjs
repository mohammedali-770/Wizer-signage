/* eslint-disable */
/**
 * Database seed — plain CommonJS so it runs ANYWHERE with only `node` + the
 * production dependencies that ship in the runtime image (@prisma/client,
 * @node-rs/argon2). No ts-node required, so this works inside the production
 * Docker container:
 *
 *   docker compose -f infra/docker/docker-compose.yml exec api node prisma/seed.cjs
 *
 * Locally: `pnpm --filter @master-signage/api db:seed` (runs this via `prisma db seed`).
 *
 * Idempotent: upserts the Starter/Business/Enterprise plan catalog and a demo
 * Company + Super Admin + Company Admin. Re-running resets the plan catalog to
 * these defaults (prices are otherwise editable in the DB), but never duplicates
 * the demo company or users.
 */
const { PrismaClient, SubscriptionStatus, UserRole, UserStatus } = require('@prisma/client');
const { hash } = require('@node-rs/argon2');

const prisma = new PrismaClient();

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Defaults in SAR; the marketing pricing page reads these from the DB, so they
// are configurable later via the Super Admin / database.
const PLAN_SEED = [
  {
    name: 'Starter',
    code: 'starter',
    description: 'For a single small business getting started with digital signage.',
    priceMonthly: 199,
    priceYearly: 1990,
    currency: 'SAR',
    trialDays: 14,
    isPublic: true,
    limits: {
      maxScreens: 5,
      maxLocations: 1,
      maxUsers: 3,
      storageGb: 5,
      maxFileSizeMb: 200,
      autoScreenshotsPerDay: 12,
      scheduledReports: 1,
      dataRetentionDays: 30,
      apiRequestsPerDay: 0,
      webhooks: 0,
    },
  },
  {
    name: 'Business',
    code: 'business',
    description: 'For multi-branch businesses that need monitoring and central control.',
    priceMonthly: 599,
    priceYearly: 5990,
    currency: 'SAR',
    trialDays: 14,
    isPublic: true,
    limits: {
      maxScreens: 25,
      maxLocations: 10,
      maxUsers: 15,
      storageGb: 50,
      maxFileSizeMb: 500,
      autoScreenshotsPerDay: 48,
      scheduledReports: 10,
      dataRetentionDays: 90,
      apiRequestsPerDay: 10000,
      webhooks: 5,
    },
  },
  {
    name: 'Enterprise',
    code: 'enterprise',
    description: 'For large screen networks. Custom pricing, SLA, and onboarding.',
    priceMonthly: 0, // 0 = "custom / contact us" on the pricing page
    priceYearly: null,
    currency: 'SAR',
    trialDays: 14,
    isPublic: true,
    limits: {
      maxScreens: null,
      maxLocations: null,
      maxUsers: null,
      storageGb: null,
      maxFileSizeMb: 2048,
      autoScreenshotsPerDay: null,
      scheduledReports: null,
      dataRetentionDays: 365,
      apiRequestsPerDay: null,
      webhooks: null,
    },
  },
];

async function main() {
  const superEmail = (
    process.env.SEED_SUPERADMIN_EMAIL ?? 'superadmin@mastersignage.local'
  ).toLowerCase();
  const superPassword = process.env.SEED_SUPERADMIN_PASSWORD ?? 'ChangeMe!2026Admin';
  const superName = process.env.SEED_SUPERADMIN_NAME ?? 'Platform Super Admin';
  const companyName = process.env.SEED_COMPANY_NAME ?? 'Demo Company';
  const usingDefaults = !process.env.SEED_SUPERADMIN_PASSWORD;

  // --- Plans: Starter / Business / Enterprise ----------------------------
  for (const { code, ...rest } of PLAN_SEED) {
    await prisma.plan.upsert({ where: { code }, update: { ...rest }, create: { code, ...rest } });
  }
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'starter' } });

  // --- Demo company + trialing subscription ------------------------------
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

  console.log('\nMasterSignage seed complete:');
  console.log(`  Plans:          ${PLAN_SEED.map((p) => p.code).join(', ')}`);
  console.log(`  Company:        ${company.name} [${company.id}]`);
  console.log(`  Super Admin:    ${superAdmin.email}`);
  console.log(`  Company Admin:  ${companyAdmin.email}`);
  if (usingDefaults) {
    console.log('\n  WARNING: default credentials in use — CHANGE THESE IMMEDIATELY:');
    console.log(`     Super Admin:   ${superEmail} / ${superPassword}`);
    console.log(`     Company Admin: ${adminEmail} / ${adminPassword}`);
    console.log('     Set SEED_SUPERADMIN_PASSWORD / SEED_COMPANYADMIN_PASSWORD to override.');
  }
  console.log('\n  Note: the Super Admin must enrol 2FA on first login (mandatory).\n');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
