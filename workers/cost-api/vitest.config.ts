import { join } from 'node:path';
import {
  defineWorkersConfig,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers/config';

// Read migrations in the Node.js context so they can be passed to the
// Workers runtime as a JSON binding. The Workers runtime cannot use
// node:fs, so we serialise the migration data at config-load time.
const migrations = await readD1Migrations(
  join(import.meta.dirname, 'src/migrations'),
);

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        isolatedStorage: true,
        miniflare: {
          bindings: {
            COST_API_TOKEN: 'test-secret-token',
            ALLOWED_ORIGINS: 'http://localhost',
            // Serialised D1Migration[] — deserialised in beforeEach via applyD1Migrations.
            TEST_MIGRATIONS: JSON.stringify(migrations),
          },
        },
      },
    },
  },
});
