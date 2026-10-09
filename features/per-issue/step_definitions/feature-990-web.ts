/**
 * What a "web" target repository adds to the feature-990 harness: the environment its run needs. The scenario phase of a
 * web repository runs ADW's Playwright project through `npm` and `npx`, so the stand-ins of feature-992 lead `PATH` and
 * the scenarios run without the registry or a browser; the issue's scenarios then fail when no dev server answers while
 * they run. `NODE_OPTIONS` is blank for the run: the stand-ins are Node programs that start in a worktree, where
 * the harness's `--import tsx` has no `tsx` to resolve.
 */

import * as path from 'path';

import { requireHarness } from '../../regression/support/subprocessHarness.ts';

import { disposeToolchain, toolchain, writeStandIns } from '../../regression/step_definitions/feature-992-standins.ts';
import { requireWorld, s } from './feature-990-world.ts';

/** The tag the stand-in `npx playwright test` is asked for: the issue's own, without the `@`. */
function issueTag(issue: number): string {
  return `adw-${issue}`;
}

/** Laid over the hermetic environment of the run; empty for a repository that is not "web". */
export function webRunEnvironment(issue: number): Record<string, string> {
  if (!s.web) return {};

  const world = requireWorld();
  toolchain.behaviour.serverTags = s.issueScenariosNeedServer ? [issueTag(issue)] : [];
  const standIns = writeStandIns();
  world.cleanup.push(disposeToolchain);

  const harness = requireHarness(world);
  return {
    PATH: [standIns.binDir, harness.ghBinDir, harness.recorder.binDir, process.env['PATH']].filter(Boolean).join(path.delimiter),
    NODE_OPTIONS: '',
  };
}
