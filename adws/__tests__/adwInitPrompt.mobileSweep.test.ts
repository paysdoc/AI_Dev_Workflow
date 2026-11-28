import { describe, it, expect } from 'vitest';
import { resolveStepUsageReader } from '../core/unusedStepReport';
import { ADW_INIT_PATH, SCENARIO_RUN_CONTRACT_SECTION, fencedBlockAfter, readLines, stepLines } from './adwInitPrompt.helpers';

/**
 * The Per-Issue Sweep derives its cucumber-jvm dry run from the run-by-tag command `adw_init.md` writes for a mobile:kotlincm
 * repository, so the `## Scenario Run Contract` must have the `:scenarios` module hand the properties it adds to cucumber-jvm.
 */
const GRADLE_RUN_BY_TAG = './gradlew :scenarios:test --rerun -Dcucumber.filter.tags="@{tag}"';
const BDD_FRAMEWORK = 'cucumber-jvm';

describe("the mobile:kotlincm scenario run contract and the Per-Issue Sweep's dry run", () => {
  const contract = (): string => fencedBlockAfter(stepLines(readLines(ADW_INIT_PATH), 8), `\`${SCENARIO_RUN_CONTRACT_SECTION}\` →`).join('\n');

  it("has the :scenarios test task hand cucumber-jvm every system property the sweep's dry run adds to the run-by-tag command, and says a dry run touches no device", () => {
    const lookup = resolveStepUsageReader(BDD_FRAMEWORK);
    if (lookup.kind !== 'supported') throw new Error(`expected the ${BDD_FRAMEWORK} reader`);
    const dryRun = lookup.reader.dryRunCommand(GRADLE_RUN_BY_TAG) ?? '';
    const added = [...dryRun.matchAll(/-D([\w.-]+)=/g)].map((match) => match[1]);
    const text = contract();

    expect(stepLines(readLines(ADW_INIT_PATH), 8).join('\n')).toContain(GRADLE_RUN_BY_TAG);
    expect(added).toEqual(['cucumber.execution.dry-run', 'cucumber.plugin']);
    expect(text).toContain('every `cucumber.*` system property');
    for (const name of [...added, 'cucumber.filter.tags']) expect(text, `the contract names ${name}`).toContain(`\`${name}\``);
    expect(text).toContain('touches no device');
  });
});
