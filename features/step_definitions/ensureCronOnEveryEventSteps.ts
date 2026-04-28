import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

function extractHandlerBody(content: string, startMarker: string): string {
  const handlerStart = content.indexOf(startMarker);
  assert.ok(handlerStart !== -1, `Expected to find handler marker "${startMarker}" in source`);
  const bodyStart = content.indexOf('{', handlerStart);
  assert.ok(bodyStart !== -1, `Expected to find opening brace after "${startMarker}"`);
  let depth = 0;
  let bodyEnd = -1;
  for (let i = bodyStart; i < content.length; i++) {
    if (content[i] === '{') depth++;
    if (content[i] === '}') depth--;
    if (depth === 0) { bodyEnd = i + 1; break; }
  }
  assert.ok(bodyEnd !== -1, `Expected to find closing brace of handler "${startMarker}"`);
  return content.slice(handlerStart, bodyEnd);
}

Then(
  '{string} is called at the request handler top-level in trigger_webhook.ts',
  function (funcName: string) {
    const content = sharedCtx.fileContent;
    const callIdx = content.indexOf(`${funcName}(`);
    assert.ok(callIdx !== -1, `Expected ${funcName} to be called in the file`);
    const authIdx = content.indexOf('ensureAppAuthForRepo(');
    assert.ok(authIdx !== -1, 'Expected to find ensureAppAuthForRepo');
    const firstEventBranch = content.indexOf("if (event === 'pull_request_review_comment')");
    assert.ok(firstEventBranch !== -1, 'Expected to find pull_request_review_comment branch');
    assert.ok(
      callIdx > authIdx && callIdx < firstEventBranch,
      `Expected ${funcName}( at offset ${callIdx} to be between ensureAppAuthForRepo( at ${authIdx} and first event branch at ${firstEventBranch}`,
    );
  },
);

Then(
  '{string} is called after {string} at the request handler top-level',
  function (funcName: string, afterFunc: string) {
    const content = sharedCtx.fileContent;
    const afterIdx = content.indexOf(`${afterFunc}(`);
    assert.ok(afterIdx !== -1, `Expected ${afterFunc} to be called in the file`);
    const callIdx = content.indexOf(`${funcName}(`);
    assert.ok(callIdx !== -1, `Expected ${funcName} to be called in the file`);
    assert.ok(
      callIdx > afterIdx,
      `Expected ${funcName}( at offset ${callIdx} to appear after ${afterFunc}( at offset ${afterIdx}`,
    );
  },
);

Then(
  '{string} is called before the first per-event branch in the request handler',
  function (funcName: string) {
    const content = sharedCtx.fileContent;
    const callIdx = content.indexOf(`${funcName}(`);
    assert.ok(callIdx !== -1, `Expected ${funcName} to be called in the file`);
    const firstEventBranch = content.indexOf("if (event === 'pull_request_review_comment')");
    assert.ok(firstEventBranch !== -1, 'Expected to find pull_request_review_comment branch');
    assert.ok(
      callIdx < firstEventBranch,
      `Expected ${funcName}( at offset ${callIdx} to appear before first event branch at offset ${firstEventBranch}`,
    );
  },
);

Then(
  '{string} is called exactly once in the trigger_webhook.ts request handler',
  function (funcName: string) {
    const content = sharedCtx.fileContent;
    const pattern = `${funcName}(`;
    let count = 0;
    let idx = 0;
    while ((idx = content.indexOf(pattern, idx)) !== -1) { count++; idx += pattern.length; }
    assert.strictEqual(count, 1, `Expected exactly one occurrence of ${pattern} in the file, found ${count}`);
  },
);

Then(
  '{string} is not called inside the issue_comment handler',
  function (funcName: string) {
    const content = sharedCtx.fileContent;
    const handler = extractHandlerBody(content, "if (event === 'issue_comment')");
    assert.ok(!handler.includes(`${funcName}(`), `Expected ${funcName} NOT to be called inside the issue_comment handler`);
  },
);

Then(
  '{string} is not called inside the issues.opened handler',
  function (funcName: string) {
    const content = sharedCtx.fileContent;
    const handler = extractHandlerBody(content, "if (action === 'opened')");
    assert.ok(!handler.includes(`${funcName}(`), `Expected ${funcName} NOT to be called inside the issues.opened handler`);
  },
);

Then(
  'the top-level {string} call is gated on a resolved repoInfo from {string}',
  function (funcName: string, _repoSource: string) {
    const content = sharedCtx.fileContent;
    const guardPattern = `if (webhookRepoInfo) ${funcName}(`;
    assert.ok(content.includes(guardPattern), `Expected the ${funcName}( call to be gated with "if (webhookRepoInfo)"`);
    assert.ok(content.includes('full_name'), 'Expected full_name to appear in the file');
    assert.ok(content.includes('webhookRepoInfo'), 'Expected webhookRepoInfo to appear in the file');
  },
);

Then(
  '{string} is called after the webhook signature validation check returns valid',
  function (funcName: string) {
    const content = sharedCtx.fileContent;
    const sigCheckIdx = content.indexOf('invalid signature');
    assert.ok(sigCheckIdx !== -1, 'Expected to find signature validation check');
    const callIdx = content.indexOf(`${funcName}(`);
    assert.ok(callIdx !== -1, `Expected ${funcName} to be called in the file`);
    assert.ok(callIdx > sigCheckIdx, `Expected ${funcName}( at offset ${callIdx} to appear after signature check at offset ${sigCheckIdx}`);
  },
);

Then(
  '{string} is called after the JSON.parse step in the request handler',
  function (funcName: string) {
    const content = sharedCtx.fileContent;
    const jsonParseIdx = content.indexOf('JSON.parse(');
    assert.ok(jsonParseIdx !== -1, 'Expected to find JSON.parse step');
    const callIdx = content.indexOf(`${funcName}(`);
    assert.ok(callIdx !== -1, `Expected ${funcName} to be called in the file`);
    assert.ok(callIdx > jsonParseIdx, `Expected ${funcName}( at offset ${callIdx} to appear after JSON.parse( at offset ${jsonParseIdx}`);
  },
);

Then(
  '{string} is not called inside the \\/health request handler block',
  function (funcName: string) {
    const content = sharedCtx.fileContent;
    const handler = extractHandlerBody(content, "if (req.url === '/health'");
    assert.ok(!handler.includes(`${funcName}(`), `Expected ${funcName} NOT to be called inside the /health handler block`);
  },
);

Then(
  '{string} is called after the {string} path check passes',
  function (funcName: string, pathStr: string) {
    const content = sharedCtx.fileContent;
    const guardPattern = `req.url !== '${pathStr}'`;
    const guardIdx = content.indexOf(guardPattern);
    assert.ok(guardIdx !== -1, `Expected to find path check guard "${guardPattern}"`);
    const callIdx = content.indexOf(`${funcName}(`);
    assert.ok(callIdx !== -1, `Expected ${funcName} to be called in the file`);
    assert.ok(callIdx > guardIdx, `Expected ${funcName}( at offset ${callIdx} to appear after path guard at offset ${guardIdx}`);
  },
);

Then(
  '{string} is called after the POST method check passes',
  function (funcName: string) {
    const content = sharedCtx.fileContent;
    const guardIdx = content.indexOf("req.method !== 'POST'");
    assert.ok(guardIdx !== -1, 'Expected to find POST method check');
    const callIdx = content.indexOf(`${funcName}(`);
    assert.ok(callIdx !== -1, `Expected ${funcName} to be called in the file`);
    assert.ok(callIdx > guardIdx, `Expected ${funcName}( at offset ${callIdx} to appear after POST method check at offset ${guardIdx}`);
  },
);

Then(
  'the pull_request_review handler is reached after the top-level {string} call',
  function (funcName: string) {
    const content = sharedCtx.fileContent;
    const callIdx = content.indexOf(`${funcName}(`);
    assert.ok(callIdx !== -1, `Expected ${funcName} to be called in the file`);
    const handlerIdx = content.indexOf("if (event === 'pull_request_review')");
    assert.ok(handlerIdx !== -1, 'Expected to find pull_request_review handler');
    assert.ok(callIdx < handlerIdx, `Expected ${funcName}( at offset ${callIdx} to appear before pull_request_review handler at offset ${handlerIdx}`);
  },
);

Then(
  'the approved-review branch returns {string} without calling {string} itself',
  function (_returnStatus: string, funcName: string) {
    const content = sharedCtx.fileContent;
    const handler = extractHandlerBody(content, "if (event === 'pull_request_review')");
    assert.ok(handler.includes("reviewState === 'approved'"), 'Expected approved-review short-circuit in pull_request_review handler');
    assert.ok(!handler.includes(`${funcName}(`), `Expected ${funcName} NOT to be called inside the pull_request_review handler`);
  },
);

Then(
  'the pull_request_review_comment handler is reached after the top-level {string} call',
  function (funcName: string) {
    const content = sharedCtx.fileContent;
    const callIdx = content.indexOf(`${funcName}(`);
    assert.ok(callIdx !== -1, `Expected ${funcName} to be called in the file`);
    const handlerIdx = content.indexOf("if (event === 'pull_request_review_comment')");
    assert.ok(handlerIdx !== -1, 'Expected to find pull_request_review_comment handler');
    assert.ok(callIdx < handlerIdx, `Expected ${funcName}( at offset ${callIdx} to appear before pull_request_review_comment handler at offset ${handlerIdx}`);
  },
);

Then(
  'the pull_request handler is reached after the top-level {string} call',
  function (funcName: string) {
    const content = sharedCtx.fileContent;
    const callIdx = content.indexOf(`${funcName}(`);
    assert.ok(callIdx !== -1, `Expected ${funcName} to be called in the file`);
    const handlerIdx = content.indexOf("if (event === 'pull_request')");
    assert.ok(handlerIdx !== -1, 'Expected to find pull_request handler');
    assert.ok(callIdx < handlerIdx, `Expected ${funcName}( at offset ${callIdx} to appear before pull_request handler at offset ${handlerIdx}`);
  },
);

Then(
  'the issues handler is reached after the top-level {string} call',
  function (funcName: string) {
    const content = sharedCtx.fileContent;
    const callIdx = content.indexOf(`${funcName}(`);
    assert.ok(callIdx !== -1, `Expected ${funcName} to be called in the file`);
    const handlerIdx = content.indexOf("if (event !== 'issues')");
    assert.ok(handlerIdx !== -1, "Expected to find issues handler guard");
    assert.ok(callIdx < handlerIdx, `Expected ${funcName}( at offset ${callIdx} to appear before issues handler at offset ${handlerIdx}`);
  },
);
