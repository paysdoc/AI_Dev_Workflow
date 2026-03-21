import { Given, Then } from '@cucumber/cucumber';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps';

const ROOT = process.cwd();

// ── STAGE_ORDER checks ────────────────────────────────────────────────────────

Then('the STAGE_ORDER array should contain {string}', function (stage: string) {
  assert.ok(
    sharedCtx.fileContent.includes(`'${stage}'`),
    `Expected STAGE_ORDER to contain '${stage}'`,
  );
});

Then('{string} should appear after {string} in STAGE_ORDER', function (stage: string, after: string) {
  const content = sharedCtx.fileContent;
  const stageIdx = content.indexOf(`'${stage}'`);
  const afterIdx = content.indexOf(`'${after}'`);
  assert.ok(stageIdx > -1, `'${stage}' not found in file`);
  assert.ok(afterIdx > -1, `'${after}' not found in file`);
  assert.ok(stageIdx > afterIdx, `Expected '${stage}' to appear after '${after}' in STAGE_ORDER`);
});

Then('{string} should appear before {string} in STAGE_ORDER', function (stage: string, before: string) {
  const content = sharedCtx.fileContent;
  const stageIdx = content.indexOf(`'${stage}'`);
  const beforeIdx = content.indexOf(`'${before}'`);
  assert.ok(stageIdx > -1, `'${stage}' not found in file`);
  assert.ok(beforeIdx > -1, `'${before}' not found in file`);
  assert.ok(stageIdx < beforeIdx, `Expected '${stage}' to appear before '${before}' in STAGE_ORDER`);
});

// ── STAGE_HEADER_MAP check ────────────────────────────────────────────────────

Then('the STAGE_HEADER_MAP should map {string} to {string}', function (header: string, stage: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(header),
    `Expected STAGE_HEADER_MAP to contain header "${header}"`,
  );
  assert.ok(
    content.includes(`'${stage}'`),
    `Expected STAGE_HEADER_MAP to map to stage '${stage}'`,
  );
  // Verify the header and stage appear on the same line
  const line = content.split('\n').find(l => l.includes(header));
  assert.ok(line && line.includes(`'${stage}'`), `Expected "${header}" to map to '${stage}' on the same line`);
});

// ── Phase file structural checks ──────────────────────────────────────────────

Then('the file should destructure {string} from the config parameter', function (prop: string) {
  assert.ok(
    sharedCtx.fileContent.includes(prop),
    `Expected file '${sharedCtx.filePath}' to destructure '${prop}' from config`,
  );
});

Then('the file should call shouldExecuteStage with {string} and recoveryState', function (stage: string) {
  assert.ok(
    sharedCtx.fileContent.includes(`shouldExecuteStage('${stage}', recoveryState)`),
    `Expected file '${sharedCtx.filePath}' to call shouldExecuteStage('${stage}', recoveryState)`,
  );
});

Then('the file should return a result with zero cost when the stage is skipped', function () {
  assert.ok(
    sharedCtx.fileContent.includes('costUsd: 0'),
    `Expected file '${sharedCtx.filePath}' to return zero costUsd when stage is skipped`,
  );
});

Then('the file should log a skip message when the stage is skipped', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('Skipping') && content.includes('already completed'),
    `Expected file '${sharedCtx.filePath}' to log a skip message containing 'Skipping' and 'already completed'`,
  );
});

Then('the file should import {string} from the core module', function (symbol: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(symbol) && content.includes('../core'),
    `Expected file '${sharedCtx.filePath}' to import '${symbol}' from '../core'`,
  );
});

// ── Orchestrator checks ───────────────────────────────────────────────────────

Then(
  'each orchestrator should invoke the scenario phase and plan validation phase without recovery guards',
  function () {
    const orchestratorFiles = [
      'adws/adwSdlc.tsx',
      'adws/adwPlanBuildTestReview.tsx',
      'adws/adwPlanBuildReview.tsx',
    ];
    for (const file of orchestratorFiles) {
      const fullPath = join(ROOT, file);
      assert.ok(existsSync(fullPath), `Expected orchestrator file to exist: ${file}`);
      const content = readFileSync(fullPath, 'utf-8');
      assert.ok(
        !content.includes('shouldExecuteStage'),
        `Orchestrator '${file}' should not call shouldExecuteStage directly — recovery guard belongs inside the phase`,
      );
    }
  },
);

Then('the phase-internal guards should handle skipping transparently', function () {
  const phaseFiles = ['adws/phases/scenarioPhase.ts', 'adws/phases/planValidationPhase.ts'];
  for (const file of phaseFiles) {
    const fullPath = join(ROOT, file);
    assert.ok(existsSync(fullPath), `Expected phase file to exist: ${file}`);
    const content = readFileSync(fullPath, 'utf-8');
    assert.ok(
      content.includes('shouldExecuteStage'),
      `Expected phase file '${file}' to contain an internal shouldExecuteStage guard`,
    );
  }
});

// ── TypeScript type-check given ───────────────────────────────────────────────

Given('the ADW codebase has been modified for issue 254', function () {
  const keyFiles = [
    'adws/core/workflowCommentParsing.ts',
    'adws/phases/scenarioPhase.ts',
    'adws/phases/planValidationPhase.ts',
  ];
  for (const file of keyFiles) {
    assert.ok(
      existsSync(join(ROOT, file)),
      `Expected modified file to exist: ${file}`,
    );
  }
});
