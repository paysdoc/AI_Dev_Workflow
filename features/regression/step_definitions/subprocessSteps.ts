/**
 * Steps of the "Smoke processes" section of the vocabulary registry: the Givens that seed a workflow
 * a real orchestrator process finds, and the Thens that read what such a process left. Every Then
 * reads a runtime artefact: the requests the mock GitHub API recorded after the replay, the output
 * of the process, or the launches the recorder caught. No step reads a source file.
 */

import { Given, Then } from '@cucumber/cucumber';
import assert from 'assert';

import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { getMockServerState } from '../../../test/mocks/github-api-server.ts';
import type { RecordedRequest } from '../../../test/mocks/types.ts';
import { createRemoteBranch } from '../support/fixtureTargetRepo.ts';
import { harnessOrchestrator, isLaunchOf, isOrchestratorLaunch } from '../support/harnessOrchestrators.ts';
import { describeLaunches, recordedLaunches } from '../support/launchRecorder.ts';
import { SURFACE_REPO } from '../support/mockForgeProviders.ts';
import { claimAdwId, ensureTargetWorkspace, requireHarness } from '../support/subprocessHarness.ts';
import type { RegressionWorld } from './world.ts';

const OUTPUT_TAIL_LINES = 40;

/** The issue a seeded workflow belongs to, when the scenario seeded exactly one. */
function seededIssueFields(world: RegressionWorld): { issueNumber?: number } {
  const issues = [...world.seededIssues];
  return issues.length === 1 ? { issueNumber: issues[0] } : {};
}

function lastLines(output: string): string {
  return output.trim().split('\n').slice(-OUTPUT_TAIL_LINES).join('\n');
}

Given(
  'a workflow for adwId {string} is awaiting merge of PR {int} from branch {string}',
  async function (this: RegressionWorld, adwId: string, prNumber: number, branch: string) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');
    claimAdwId(this, adwId);
    createRemoteBranch(ensureTargetWorkspace(this), branch, `src/${branch}.ts`, `export const branch = '${branch}';\n`);

    const issue = seededIssueFields(this).issueNumber ?? prNumber;
    const { prs } = getMockServerState();
    await this.mockContext.setState({
      prs: {
        ...prs,
        [String(prNumber)]: {
          number: prNumber,
          title: `Surface PR ${prNumber}`,
          body: `Implements #${issue}`,
          state: 'OPEN',
          headRefName: branch,
          baseRefName: 'main',
          url: `https://github.com/${SURFACE_REPO.owner}/${SURFACE_REPO.repo}/pull/${prNumber}`,
        },
      },
    });
    AgentStateManager.writeTopLevelState(adwId, {
      adwId,
      ...seededIssueFields(this),
      workflowStage: 'awaiting_merge',
      branchName: branch,
      orchestratorScript: 'adws/adwSdlc.tsx',
      repoIdentity: { owner: SURFACE_REPO.owner, repo: SURFACE_REPO.repo },
    });
  },
);

Given(
  'a prior run for adwId {string} recorded workflowStage {string} for the repository {string}',
  function (this: RegressionWorld, adwId: string, workflowStage: string, repoFullName: string) {
    const [owner, repo] = repoFullName.split('/');
    claimAdwId(this, adwId);
    AgentStateManager.writeTopLevelState(adwId, { adwId, ...seededIssueFields(this), workflowStage, repoIdentity: { owner, repo } });
  },
);

Then('the mock GitHub API recorded a merge of PR {int}', function (this: RegressionWorld, prNumber: number) {
  const requests = this.getRecordedRequests();
  const merge = requests.find((request: RecordedRequest) => request.method === 'PUT' && request.url.endsWith(`/pulls/${prNumber}/merge`));
  assert.ok(merge, `Expected a PUT to /pulls/${prNumber}/merge but none was recorded. Recorded: ${requests.map((request) => `${request.method} ${request.url}`).join(', ') || 'nothing'}`);
});

Then("the orchestrator subprocess's output contains {string}", function (this: RegressionWorld, text: string) {
  assert.ok(this.lastOutput.includes(text), `Expected the process's output to contain "${text}". Last output:\n${lastLines(this.lastOutput)}`);
});

Then('the cron launched no orchestrator', function (this: RegressionWorld) {
  const { recorder } = requireHarness(this);
  const orchestrators = recordedLaunches(recorder).filter(isOrchestratorLaunch);
  assert.deepStrictEqual(orchestrators, [], `Expected the cron to launch no orchestrator. Launches: ${describeLaunches(recorder)}`);
});

Then('the {string} orchestrator was launched for issue {int}', function (this: RegressionWorld, name: string, issueNumber: number) {
  harnessOrchestrator(name);
  const { recorder } = requireHarness(this);
  const launches = recordedLaunches(recorder).filter((argv) => isLaunchOf(argv, name, issueNumber));
  assert.strictEqual(launches.length, 1, `Expected exactly one launch of the "${name}" orchestrator for issue ${issueNumber}. Launches: ${describeLaunches(recorder)}`);
  this.matchedLaunch = launches[0];
});

Then('that launch named the target repository {string}', function (this: RegressionWorld, repoFullName: string) {
  assert.ok(this.matchedLaunch, 'Expected an orchestrator launch to have been matched first');
  const flag = this.matchedLaunch.indexOf('--target-repo');
  assert.strictEqual(this.matchedLaunch[flag + 1], repoFullName, `Expected the launch to name --target-repo ${repoFullName}, but it ran: ${this.matchedLaunch.join(' ')}`);
});
