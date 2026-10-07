import { connectMongo, disconnectMongo } from '../lib/mongo.js';
import { logger } from '../lib/logger.js';
import { Product } from '../modules/products/product.model.js';
import { User } from '../modules/users/user.model.js';
import { ROLE_PERMISSIONS } from '../modules/roles/permissions.js';
import { seedDemoData, seedTemplates } from './demoData.js';

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@insurance.local';
const ADMIN_PASSWORD = process.env.SEED_PASSWORD ?? 'Demo@1234';
const ADVISOR_PASSWORD = process.env.SEED_ADVISOR_PASSWORD ?? 'Demo@1234';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

async function main() {
  await connectMongo();
  logger.info('Seeding database…');

  // Ensure platform admin role permissions are up to date
  await User.updateMany(
    { isPlatformAdmin: true },
    { $set: { permissions: ROLE_PERMISSIONS.platform_admin } },
  );
  logger.info('Updated platform admin permissions');

  // Templates — idempotent, adds missing ones and updates waTemplateName on existing
  const addedTemplates = await seedTemplates();
  if (addedTemplates) logger.info({ added: addedTemplates }, 'Added message templates');

  // Demo data (skipped in production)
  if (!IS_PRODUCTION) {
    await seedDemoData(ADMIN_PASSWORD, ADVISOR_PASSWORD);
    logger.info('Demo accounts and products seeded');
  }

  logger.info('Seed complete');
  await disconnectMongo();
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Seed failed');
  process.exit(1);
});
