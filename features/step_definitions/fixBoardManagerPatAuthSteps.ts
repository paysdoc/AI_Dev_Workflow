import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

/**
 * Extracts the body of a method on the GitHubBoardManager class by matching
 * a leading signature fragment. Returns the substring from the signature to
 * the file end — callers should constrain their checks to the first matching
 * closing brace or a sufficient window.
 */
function getMethodBody(signatureFragment: string): string {
  const content = sharedCtx.fileContent;
  const idx = content.indexOf(signatureFragment);
  assert.ok(
    idx !== -1,
    `Expected "${signatureFragment}" in "${sharedCtx.filePath}"`,
  );
  return content.slice(idx);
}

/**
 * Extracts the withProjectBoardAuth method body: from the private method definition
 * through a conservative 2000-char window (covers the wrapper + finally block).
 */
function getWrapperBody(): string {
  const body = getMethodBody('private async withProjectBoardAuth');
  return body.slice(0, 2000);
}

// ── withProjectBoardAuth structural assertions ───────────────────────────────

Then(
  'withProjectBoardAuth calls refreshTokenIfNeeded before swapping GH_TOKEN',
  function () {
    const body = getWrapperBody();
    const refreshIdx = body.indexOf('refreshTokenIfNeeded');
    assert.ok(
      refreshIdx !== -1,
      'Expected withProjectBoardAuth to call refreshTokenIfNeeded',
    );
    const swapIdx = body.indexOf('process.env.GH_TOKEN =');
    assert.ok(
      swapIdx !== -1,
      'Expected withProjectBoardAuth to assign process.env.GH_TOKEN',
    );
    assert.ok(
      refreshIdx < swapIdx,
      'Expected refreshTokenIfNeeded to be called before the GH_TOKEN swap',
    );
  },
);

Then(
  'withProjectBoardAuth guards the PAT swap with isGitHubAppConfigured and GITHUB_PAT presence',
  function () {
    const body = getWrapperBody();
    assert.ok(
      body.includes('isGitHubAppConfigured'),
      'Expected withProjectBoardAuth to check isGitHubAppConfigured',
    );
    assert.ok(
      body.includes('GITHUB_PAT'),
      'Expected withProjectBoardAuth to reference GITHUB_PAT',
    );
    // The guard must also verify the PAT differs from the current token,
    // mirroring the reference pattern in projectBoardApi.ts::moveIssueToStatus.
    assert.ok(
      body.includes('GITHUB_PAT !== process.env.GH_TOKEN'),
      'Expected withProjectBoardAuth to compare GITHUB_PAT against current GH_TOKEN',
    );
  },
);

Then(
  'withProjectBoardAuth assigns GITHUB_PAT to process.env.GH_TOKEN',
  function () {
    const body = getWrapperBody();
    assert.ok(
      /process\.env\.GH_TOKEN\s*=\s*GITHUB_PAT/.test(body),
      'Expected withProjectBoardAuth to assign GITHUB_PAT to process.env.GH_TOKEN',
    );
  },
);

Then(
  'withProjectBoardAuth saves the original GH_TOKEN before swapping',
  function () {
    const body = getWrapperBody();
    // Accept common save variable names or a generic `const X = process.env.GH_TOKEN`.
    const savesOriginal =
      body.includes('savedToken') ||
      body.includes('originalToken') ||
      body.includes('prevToken') ||
      body.includes('originalGhToken') ||
      /(?:let|const)\s+\w+[^=]*=\s*process\.env\.GH_TOKEN/.test(body);
    assert.ok(
      savesOriginal,
      'Expected withProjectBoardAuth to save the original GH_TOKEN before swapping',
    );
  },
);

Then(
  'withProjectBoardAuth restores the original GH_TOKEN in a finally block',
  function () {
    const body = getWrapperBody();
    const finallyIdx = body.indexOf('finally');
    assert.ok(
      finallyIdx !== -1,
      'Expected withProjectBoardAuth to contain a finally block',
    );
    // Look for a GH_TOKEN restore inside the finally block (next ~400 chars).
    const finallyBlock = body.slice(finallyIdx, finallyIdx + 400);
    assert.ok(
      /process\.env\.GH_TOKEN\s*=/.test(finallyBlock),
      'Expected withProjectBoardAuth finally block to restore process.env.GH_TOKEN',
    );
  },
);

// ── Public-method delegation assertions ──────────────────────────────────────

function assertMethodDelegatesToWrapper(methodName: string): void {
  const content = sharedCtx.fileContent;
  const signatureIdx = content.indexOf(`async ${methodName}(`);
  assert.ok(
    signatureIdx !== -1,
    `Expected "async ${methodName}(" in "${sharedCtx.filePath}"`,
  );
  // Limit to 1500 chars — enough for the method body in any of the three methods.
  const methodBody = content.slice(signatureIdx, signatureIdx + 1500);
  // The method must forward to the wrapper (either direct call or arrow-delegation).
  assert.ok(
    /this\.withProjectBoardAuth\s*[<(]/.test(methodBody),
    `Expected ${methodName} to delegate to this.withProjectBoardAuth(...)`,
  );
}

Then('the findBoard method delegates to withProjectBoardAuth', function () {
  assertMethodDelegatesToWrapper('findBoard');
});

Then('the createBoard method delegates to withProjectBoardAuth', function () {
  assertMethodDelegatesToWrapper('createBoard');
});

Then('the ensureColumns method delegates to withProjectBoardAuth', function () {
  assertMethodDelegatesToWrapper('ensureColumns');
});

// ── findBoard no longer carries the stale lazy-retry ─────────────────────────

function getFindBoardBody(): string {
  const content = sharedCtx.fileContent;
  const idx = content.indexOf('async findBoard(');
  assert.ok(
    idx !== -1,
    `Expected "async findBoard(" in "${sharedCtx.filePath}"`,
  );
  // Find the method end by scanning for the next top-level `async ` sibling
  // or for the class closing. 1500 chars is safely larger than any findBoard body.
  return content.slice(idx, idx + 1500);
}

Then(
  'the findBoard method does not contain {string}',
  function (unexpected: string) {
    const body = getFindBoardBody();
    assert.ok(
      !body.includes(unexpected),
      `Expected findBoard NOT to contain "${unexpected}"`,
    );
  },
);

Then(
  'the findBoard method does not assign to process.env.GH_TOKEN',
  function () {
    const body = getFindBoardBody();
    assert.ok(
      !/process\.env\.GH_TOKEN\s*=/.test(body),
      'Expected findBoard NOT to assign to process.env.GH_TOKEN (handled by withProjectBoardAuth)',
    );
  },
);
