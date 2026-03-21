import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

/**
 * Extracts the body of ensureCronProcess from the file content.
 * Finds the function declaration and captures everything up to its closing brace.
 */
function getEnsureCronProcessBody(): string {
  const content = sharedCtx.fileContent;
  const funcStart = content.indexOf('function ensureCronProcess');
  assert.ok(funcStart !== -1, 'Expected to find ensureCronProcess in webhookGatekeeper.ts');

  // Find the opening brace of the function body
  const bodyStart = content.indexOf('{', funcStart);
  assert.ok(bodyStart !== -1, 'Expected to find opening brace of ensureCronProcess');

  // Track braces to find the matching closing brace
  let depth = 0;
  let bodyEnd = -1;
  for (let i = bodyStart; i < content.length; i++) {
    if (content[i] === '{') depth++;
    if (content[i] === '}') depth--;
    if (depth === 0) {
      bodyEnd = i + 1;
      break;
    }
  }
  assert.ok(bodyEnd !== -1, 'Expected to find closing brace of ensureCronProcess');

  return content.slice(funcStart, bodyEnd);
}

Then(
  'the ensureCronProcess function calls isCronAliveForRepo regardless of cronSpawnedForRepo membership',
  function () {
    const body = getEnsureCronProcessBody();

    // isCronAliveForRepo must be called in the function
    assert.ok(
      body.includes('isCronAliveForRepo'),
      'Expected ensureCronProcess to call isCronAliveForRepo',
    );

    // The bare early-return on Set membership must NOT exist
    // (i.e. the Set check should not short-circuit before the liveness check)
    const hasBareCacheReturn = /if\s*\(cronSpawnedForRepo\.has\(repoKey\)\)\s*return/.test(body);
    assert.ok(
      !hasBareCacheReturn,
      'Expected ensureCronProcess NOT to have a bare early-return on cronSpawnedForRepo.has() that bypasses isCronAliveForRepo',
    );
  },
);

Then(
  'the ensureCronProcess function removes the repo from cronSpawnedForRepo when isCronAliveForRepo returns false',
  function () {
    const body = getEnsureCronProcessBody();

    assert.ok(
      body.includes('cronSpawnedForRepo.delete'),
      'Expected ensureCronProcess to call cronSpawnedForRepo.delete() when the cron process is dead',
    );
  },
);

Then(
  'the ensureCronProcess function returns without spawning when isCronAliveForRepo returns true',
  function () {
    const body = getEnsureCronProcessBody();

    // The function should check isCronAliveForRepo and return early when alive
    assert.ok(
      body.includes('isCronAliveForRepo'),
      'Expected ensureCronProcess to call isCronAliveForRepo',
    );

    // When the process is alive, the function should add to Set and return
    assert.ok(
      body.includes('cronSpawnedForRepo.add'),
      'Expected ensureCronProcess to add repo to cronSpawnedForRepo when alive',
    );
  },
);

Then(
  'the line {string} does not appear in ensureCronProcess',
  function (forbiddenLine: string) {
    const body = getEnsureCronProcessBody();

    assert.ok(
      !body.includes(forbiddenLine),
      `Expected ensureCronProcess NOT to contain "${forbiddenLine}"`,
    );
  },
);
