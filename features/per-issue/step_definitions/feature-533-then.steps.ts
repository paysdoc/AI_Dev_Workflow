import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { readInvocations } from './feature-533.steps.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

// ---------------------------------------------------------------------------
// Then — claude-cli-stub invocation recording assertions
// ---------------------------------------------------------------------------

Then(
  'the claude-cli-stub recorded a {string} agent invocation for adwId {string}',
  function (this: RegressionWorld, command: string, adwId: string) {
    const invocations = readInvocations(adwId);
    const found = invocations.some(line => line.includes(command));
    assert.ok(
      found,
      `Expected a "${command}" agent invocation for adwId "${adwId}" but got: [${invocations.join(', ')}]`,
    );
  },
);

Then(
  'the claude-cli-stub recorded no {string} agent invocation for adwId {string}',
  function (this: RegressionWorld, command: string, adwId: string) {
    const invocations = readInvocations(adwId);
    const found = invocations.some(line => line.includes(command));
    assert.ok(
      !found,
      `Expected no "${command}" agent invocation for adwId "${adwId}" but found one in: [${invocations.join(', ')}]`,
    );
  },
);

Then(
  'the claude-cli-stub recorded two {string} agent invocations for adwId {string}',
  function (this: RegressionWorld, command: string, adwId: string) {
    const invocations = readInvocations(adwId);
    const count = invocations.filter(line => line.includes(command)).length;
    assert.strictEqual(
      count,
      2,
      `Expected 2 "${command}" invocations for adwId "${adwId}" but got ${count}. Invocations: [${invocations.join(', ')}]`,
    );
  },
);

Then(
  'the claude-cli-stub recorded exactly one {string} agent invocation for adwId {string}',
  function (this: RegressionWorld, command: string, adwId: string) {
    const invocations = readInvocations(adwId);
    const count = invocations.filter(line => line.includes(command)).length;
    assert.strictEqual(
      count,
      1,
      `Expected exactly 1 "${command}" invocation for adwId "${adwId}" but got ${count}. Invocations: [${invocations.join(', ')}]`,
    );
  },
);

Then(
  'the claude-cli-stub recorded one {string} agent invocation for adwId {string}',
  function (this: RegressionWorld, command: string, adwId: string) {
    const invocations = readInvocations(adwId);
    const count = invocations.filter(line => line.includes(command)).length;
    assert.strictEqual(
      count,
      1,
      `Expected 1 "${command}" invocation for adwId "${adwId}" but got ${count}. Invocations: [${invocations.join(', ')}]`,
    );
  },
);

Then(
  'the claude-cli-stub recorded both {string} agent invocations before the {string} agent invocation for adwId {string}',
  function (this: RegressionWorld, firstCommand: string, secondCommand: string, adwId: string) {
    const invocations = readInvocations(adwId);
    const firstIndices = invocations
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => line.includes(firstCommand))
      .map(({ i }) => i);
    const secondIdx = invocations.findIndex(line => line.includes(secondCommand));

    assert.ok(firstIndices.length >= 2, `Expected at least 2 "${firstCommand}" invocations`);
    assert.ok(secondIdx !== -1, `Expected a "${secondCommand}" invocation`);
    const lastFirstIdx = firstIndices[firstIndices.length - 1]!;
    assert.ok(
      lastFirstIdx < secondIdx,
      `Expected both "${firstCommand}" invocations before "${secondCommand}" but got order: [${invocations.join(', ')}]`,
    );
  },
);

Then(
  'the claude-cli-stub recorded a build-agent invocation after each {string} agent invocation for adwId {string}',
  function (this: RegressionWorld, command: string, adwId: string) {
    const invocations = readInvocations(adwId);
    const commandIndices = invocations
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => line.includes(command))
      .map(({ i }) => i);

    for (const cmdIdx of commandIndices) {
      const buildAfter = invocations.slice(cmdIdx + 1).some(line => line.includes('/build') || line.includes('/implement'));
      assert.ok(
        buildAfter,
        `Expected a build-agent invocation after "${command}" at position ${cmdIdx}. Invocations: [${invocations.join(', ')}]`,
      );
    }
  },
);

Then(
  'the claude-cli-stub recorded a build-agent invocation after the {string} agent invocation for adwId {string}',
  function (this: RegressionWorld, command: string, adwId: string) {
    const invocations = readInvocations(adwId);
    const cmdIdx = invocations.findIndex(line => line.includes(command));
    assert.ok(cmdIdx !== -1, `Expected a "${command}" invocation`);
    const buildAfter = invocations.slice(cmdIdx + 1).some(line => line.includes('/build') || line.includes('/implement'));
    assert.ok(
      buildAfter,
      `Expected a build-agent invocation after "${command}". Invocations: [${invocations.join(', ')}]`,
    );
  },
);

Then(
  'the git-mock recorded a commit on branch {string} only after every agent invocation for adwId {string}',
  function (this: RegressionWorld, branch: string, adwId: string) {
    assert.strictEqual(
      this.targetBranch,
      branch,
      `Expected branch "${branch}" but World.targetBranch is "${this.targetBranch}"`,
    );
    const invocations = readInvocations(adwId);
    if (invocations.length > 0) {
      const lastInvocation = invocations[invocations.length - 1] ?? '';
      assert.ok(
        lastInvocation.includes('/commit') || invocations.some(l => l.includes('/commit')),
        `Expected a /commit invocation at the end. Invocations: [${invocations.join(', ')}]`,
      );
    }
    void adwId;
  },
);

Then(
  'the claude-cli-stub recorded the {string} agent invocation before the {string} agent invocation for adwId {string}',
  function (this: RegressionWorld, firstCommand: string, secondCommand: string, adwId: string) {
    const invocations = readInvocations(adwId);
    const firstIdx = invocations.findIndex(line => line.includes(firstCommand));
    const secondIdx = invocations.findIndex(line => line.includes(secondCommand));
    assert.ok(firstIdx !== -1, `Expected a "${firstCommand}" invocation`);
    assert.ok(secondIdx !== -1, `Expected a "${secondCommand}" invocation`);
    assert.ok(
      firstIdx < secondIdx,
      `Expected "${firstCommand}" before "${secondCommand}" but got order: [${invocations.join(', ')}]`,
    );
  },
);
