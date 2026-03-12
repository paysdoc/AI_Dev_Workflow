import { describe, it, expect } from 'vitest';

/**
 * Tests that triggers pass repo identity explicitly without relying on
 * the global setTargetRepo/getTargetRepo registry.
 *
 * After the refactor (issue #118):
 * - trigger_cron.ts uses a local `cronRepoInfo` constant instead of setTargetRepo()
 * - trigger_webhook.ts does NOT call setTargetRepo() — repo info is extracted
 *   from webhook payloads and passed explicitly to handler functions
 * - Spawned orchestrator processes receive --target-repo and --clone-url args
 *   and create their own RepoContext at startup
 */

describe('trigger_cron — no setTargetRepo', () => {
  it('does not import setTargetRepo from targetRepoRegistry', async () => {
    // Verify that trigger_cron.ts no longer imports setTargetRepo.
    // We check the source file to ensure the import was removed.
    const fs = await import('fs');
    const cronSource = fs.readFileSync(
      new URL('../../triggers/trigger_cron.ts', import.meta.url).pathname.replace('/__tests__/../', '/'),
      'utf-8',
    );
    expect(cronSource).not.toContain('setTargetRepo');
    expect(cronSource).not.toContain('getTargetRepo');
  });

  it('uses cronRepoInfo constant for explicit repo info passing', async () => {
    const fs = await import('fs');
    const cronSource = fs.readFileSync(
      new URL('../../triggers/trigger_cron.ts', import.meta.url).pathname.replace('/__tests__/../', '/'),
      'utf-8',
    );
    expect(cronSource).toContain('cronRepoInfo');
    expect(cronSource).toContain('getRepoInfo()');
  });
});

describe('trigger_webhook — no setTargetRepo', () => {
  it('does not import setTargetRepo from core', async () => {
    const fs = await import('fs');
    const webhookSource = fs.readFileSync(
      new URL('../../triggers/trigger_webhook.ts', import.meta.url).pathname.replace('/__tests__/../', '/'),
      'utf-8',
    );
    expect(webhookSource).not.toContain('setTargetRepo');
  });

  it('still passes --target-repo args to spawned processes via extractTargetRepoArgs', async () => {
    const fs = await import('fs');
    const webhookSource = fs.readFileSync(
      new URL('../../triggers/trigger_webhook.ts', import.meta.url).pathname.replace('/__tests__/../', '/'),
      'utf-8',
    );
    expect(webhookSource).toContain('extractTargetRepoArgs');
    expect(webhookSource).toContain('--target-repo');
  });

  it('extracts webhook repo info from payload via getRepoInfoFromPayload', async () => {
    const fs = await import('fs');
    const webhookSource = fs.readFileSync(
      new URL('../../triggers/trigger_webhook.ts', import.meta.url).pathname.replace('/__tests__/../', '/'),
      'utf-8',
    );
    expect(webhookSource).toContain('getRepoInfoFromPayload');
  });
});

describe('webhookHandlers — no hasTargetRepo', () => {
  it('does not import hasTargetRepo from targetRepoRegistry', async () => {
    const fs = await import('fs');
    const handlersSource = fs.readFileSync(
      new URL('../../triggers/webhookHandlers.ts', import.meta.url).pathname.replace('/__tests__/../', '/'),
      'utf-8',
    );
    expect(handlersSource).not.toContain('hasTargetRepo');
  });

  it('uses existsSync to check workspace path instead of registry', async () => {
    const fs = await import('fs');
    const handlersSource = fs.readFileSync(
      new URL('../../triggers/webhookHandlers.ts', import.meta.url).pathname.replace('/__tests__/../', '/'),
      'utf-8',
    );
    expect(handlersSource).toContain('existsSync');
  });
});
