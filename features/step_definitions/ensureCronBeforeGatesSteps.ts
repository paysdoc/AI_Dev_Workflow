import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

/**
 * Extracts the body of the issue_comment handler from trigger_webhook.ts.
 * Finds `if (event === 'issue_comment')` and returns everything up to its closing brace.
 */
function getIssueCommentHandlerBody(content: string): string {
  const handlerStart = content.indexOf("if (event === 'issue_comment')");
  assert.ok(handlerStart !== -1, "Expected to find issue_comment handler in trigger_webhook.ts");

  const bodyStart = content.indexOf('{', handlerStart);
  assert.ok(bodyStart !== -1, 'Expected to find opening brace of issue_comment handler');

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
  assert.ok(bodyEnd !== -1, 'Expected to find closing brace of issue_comment handler');

  return content.slice(handlerStart, bodyEnd);
}

/**
 * Extracts the body of the issues.opened handler from trigger_webhook.ts.
 * Finds `if (action === 'opened')` and returns everything up to its closing brace.
 */
function getIssuesOpenedHandlerBody(content: string): string {
  const handlerStart = content.indexOf("if (action === 'opened')");
  assert.ok(handlerStart !== -1, "Expected to find issues.opened handler in trigger_webhook.ts");

  const bodyStart = content.indexOf('{', handlerStart);
  assert.ok(bodyStart !== -1, 'Expected to find opening brace of issues.opened handler');

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
  assert.ok(bodyEnd !== -1, 'Expected to find closing brace of issues.opened handler');

  return content.slice(handlerStart, bodyEnd);
}

Then(
  'in the issue_comment handler {string} is called before {string}',
  function (firstFunc: string, secondFunc: string) {
    const handler = getIssueCommentHandlerBody(sharedCtx.fileContent);

    const firstIdx = handler.indexOf(`${firstFunc}(`);
    const secondIdx = handler.indexOf(`${secondFunc}(`);

    assert.ok(firstIdx !== -1, `Expected ${firstFunc} to be called in the issue_comment handler`);
    assert.ok(secondIdx !== -1, `Expected ${secondFunc} to be called in the issue_comment handler`);
    assert.ok(
      firstIdx < secondIdx,
      `Expected ${firstFunc} (at offset ${firstIdx}) to appear before ${secondFunc} (at offset ${secondIdx}) in the issue_comment handler`,
    );
  },
);

Then(
  '{string} is not called inside the isAdwRunningForIssue then-callback in the issue_comment handler',
  function (funcName: string) {
    const handler = getIssueCommentHandlerBody(sharedCtx.fileContent);

    // Find the .then( callback block
    const thenIdx = handler.indexOf('.then(');
    if (thenIdx === -1) {
      // No .then() at all — funcName cannot be inside it
      return;
    }

    // Extract the .then() callback body
    const thenBodyStart = handler.indexOf('(', thenIdx + 1);
    assert.ok(thenBodyStart !== -1, 'Expected to find opening paren of .then()');

    let depth = 0;
    let thenBodyEnd = -1;
    for (let i = thenBodyStart; i < handler.length; i++) {
      if (handler[i] === '(') depth++;
      if (handler[i] === ')') depth--;
      if (depth === 0) {
        thenBodyEnd = i + 1;
        break;
      }
    }
    assert.ok(thenBodyEnd !== -1, 'Expected to find closing paren of .then()');

    const thenBody = handler.slice(thenBodyStart, thenBodyEnd);
    assert.ok(
      !thenBody.includes(`${funcName}(`),
      `Expected ${funcName} NOT to be inside the .then() callback of isAdwRunningForIssue in the issue_comment handler`,
    );
  },
);

Then(
  'in the issues opened handler {string} is called before {string}',
  function (firstFunc: string, secondFunc: string) {
    const handler = getIssuesOpenedHandlerBody(sharedCtx.fileContent);

    const firstIdx = handler.indexOf(`${firstFunc}(`);
    const secondIdx = handler.indexOf(`${secondFunc}(`);

    assert.ok(firstIdx !== -1, `Expected ${firstFunc} to be called in the issues.opened handler`);
    assert.ok(secondIdx !== -1, `Expected ${secondFunc} to be called in the issues.opened handler`);
    assert.ok(
      firstIdx < secondIdx,
      `Expected ${firstFunc} (at offset ${firstIdx}) to appear before ${secondFunc} (at offset ${secondIdx}) in the issues.opened handler`,
    );
  },
);

Then(
  '{string} is not called inside the eligibility block in the issues opened handler',
  function (funcName: string) {
    const handler = getIssuesOpenedHandlerBody(sharedCtx.fileContent);

    // The eligibility block is the async IIFE: (async () => { ... })()
    const asyncIifeIdx = handler.indexOf('(async ()');
    if (asyncIifeIdx === -1) {
      // No async IIFE — funcName cannot be inside it
      return;
    }

    const iifeBodyStart = handler.indexOf('{', asyncIifeIdx);
    assert.ok(iifeBodyStart !== -1, 'Expected to find opening brace of async IIFE');

    let depth = 0;
    let iifeBodyEnd = -1;
    for (let i = iifeBodyStart; i < handler.length; i++) {
      if (handler[i] === '{') depth++;
      if (handler[i] === '}') depth--;
      if (depth === 0) {
        iifeBodyEnd = i + 1;
        break;
      }
    }
    assert.ok(iifeBodyEnd !== -1, 'Expected to find closing brace of async IIFE');

    const iifeBody = handler.slice(iifeBodyStart, iifeBodyEnd);
    assert.ok(
      !iifeBody.includes(`${funcName}(`),
      `Expected ${funcName} NOT to be inside the async IIFE (eligibility block) in the issues.opened handler`,
    );
  },
);
