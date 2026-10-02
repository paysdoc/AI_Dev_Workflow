import { log } from '../../../adws/core/logger.ts';
import type { RegressionWorld } from '../step_definitions/world.ts';

/** Last in, first out. A failing entry is logged and the rest still run. */
export async function runCleanup(world: Pick<RegressionWorld, 'cleanup'>): Promise<void> {
  for (const entry of world.cleanup.splice(0).reverse()) {
    try {
      await entry();
    } catch (err) {
      log(`Cleanup entry failed: ${String(err)}`, 'warn');
    }
  }
}
