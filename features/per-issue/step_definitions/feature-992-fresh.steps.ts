/**
 * The fresh-repository scenario of feature-992, which checks the whole of ADW's Playwright project end to end. Here
 * `npm` and `npx` are the real ones: the upgrade installs the project from the registry and downloads the browser, a
 * worktree checked out from the regen commit installs from the committed lockfile, and `bddgen` and `playwright test`
 * run the scenarios against a dev server written as a small Node program. An end-state image for the scenario that takes
 * `page`, and none for the one that does not, is Playwright's own behaviour, which a stand-in could only imitate.
 * It needs network access.
 */

import { Given, Then, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { commitAll, configureAdwInitAgent, createTargetRepo, git, runFrameworkUpgrade, upgradeWorld } from './feature-931.steps.ts';
import { createWorkflow } from './feature-929-workflow.ts';
import { s as workflowWorld } from './feature-988-world.ts';
import { assertProjectMdFile, projectMd } from './feature-991-project-md.ts';
import { COMMANDS_MD, freshAdwFiles, renderAdwFiles, setStartDevServer } from './feature-992-adw-files.ts';
import { scenarioSources, stepFileSource, type ScenarioRow } from './feature-992-bdd-source.ts';
import { caseForScenario, imagesOf, isInside, readJunitCases, reportPathFor, type JunitCase } from './feature-992-junit.ts';
import { devServerLog, standIns, toolchain } from './feature-992-standins.ts';
import { registerDirectory, requireProof, requireWorkflow, s } from './feature-992-world.ts';
import { writeFeature, writeStepFile } from './feature-992-worktree.ts';
import { devServerSource } from './feature-992-standin-source.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

const TARGET_REPOSITORY = 'adw-fixture/void-992-fresh';
const DEV_SERVER_SCRIPT = 'dev-server.cjs';
const UPGRADE_TIMEOUT_MS = 600_000;
const APPLICATION_MANIFEST = `${JSON.stringify({ name: 'widgets', private: true, version: '0.0.0', scripts: { dev: `node ${DEV_SERVER_SCRIPT}` } }, null, 2)}\n`;

function repositoryDirectory(): string {
  const { repoDir } = upgradeWorld();
  assert.ok(repoDir, 'Expected the web application repository to have been prepared first');
  return repoDir;
}

Given(
  'a web application repository never initialised by ADW, whose dev server serves a page titled {string} at {string} and answers {string} with status {int}',
  function (title: string, pagePath: string, healthPath: string, healthStatus: number) {
    assert.strictEqual(pagePath, '/', 'The dev server serves its page at "/"');
    toolchain.real = true;
    toolchain.behaviour = { ...toolchain.behaviour, devServer: { title, healthPath, healthStatus } };
    createTargetRepo(false, { file: 'package.json', content: APPLICATION_MANIFEST });
    fs.writeFileSync(path.join(repositoryDirectory(), DEV_SERVER_SCRIPT), devServerSource(toolchain.behaviour.devServer));
    commitAll(repositoryDirectory(), 'chore: add the dev server');
    s.devServerLog = standIns().serverLog;
  },
);

Given(
  'the {string} agent writes a complete ADW configuration whose {string} declares the application type {string} and whose {string} starts that dev server',
  function (command: string, projectFile: string, applicationType: string, commandsFile: string) {
    assertProjectMdFile(projectFile);
    assert.strictEqual(commandsFile, COMMANDS_MD, `The scenarios start the dev server from "${COMMANDS_MD}"`);
    assert.ok(s.devServerLog, "Expected the repository's dev server to have been described first");
    const files = freshAdwFiles(applicationType);
    setStartDevServer(files, `"${process.execPath}" ${DEV_SERVER_SCRIPT} {PORT} "${s.devServerLog}"`, toolchain.behaviour.devServer.healthPath);
    configureAdwInitAgent(command, projectMd(applicationType), renderAdwFiles(files));
  },
);

Given("the framework upgrade has regenerated the repository's ADW configuration", { timeout: UPGRADE_TIMEOUT_MS }, async function () {
  await runFrameworkUpgrade();
  const { result, issueComments } = upgradeWorld();
  assert.strictEqual(result?.outcome, 'completed', `Expected the upgrade to complete, got ${result?.outcome}/${result?.reason}. Comments posted: ${JSON.stringify(issueComments)}`);
});

Given('a workflow for issue {int} has a worktree checked out fresh from the regen commit', function (issueNumber: number) {
  const workflow = createWorkflow(issueNumber, TARGET_REPOSITORY);
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-992-checkout-'));
  registerDirectory(checkout);
  git(checkout, 'clone', '-q', repositoryDirectory(), '.');
  assert.ok(fs.existsSync(path.join(checkout, 'features', 'package-lock.json')), 'Expected the regen commit to carry the lockfile of ADW\'s Playwright project');
  assert.ok(!fs.existsSync(path.join(checkout, 'features', 'node_modules')), 'Expected a fresh worktree to hold no installed packages');
  const { repoContext } = workflow.config;
  workflow.worktreePath = checkout;
  workflow.config = { ...workflow.config, worktreePath: checkout, repoContext: repoContext && { ...repoContext, cwd: checkout } };
  workflowWorld.workflow = workflow;
});

Given(
  'the worktree holds a feature tagged {string} in {string} with these scenarios, and steps for them in {string} written with {string} from {string}:',
  function (tag: string, featureDirectory: string, stepDirectory: string, registration: string, library: string, table: DataTable) {
    const rows: ScenarioRow[] = table.hashes().map(({ scenario, steps }) => ({ scenario, steps }));
    const { worktreePath } = requireWorkflow();
    writeFeature(worktreePath, featureDirectory, tag, scenarioSources(rows));
    writeStepFile(worktreePath, stepDirectory, tag, stepFileSource(rows, registration, library));
  },
);

function caseOf(world: RegressionWorld, scenario: string): JunitCase {
  const cases = readJunitCases(reportPathFor(requireProof(world), `@adw-${requireWorkflow().issueNumber}`));
  const found = caseForScenario(cases, scenario);
  assert.ok(found, `Expected the JUnit report to record the scenario "${scenario}", but it records: ${cases.map(({ name }) => name).join(' | ')}`);
  return found;
}

Then(
  'the JUnit report of the run for the tag {string} is at the path ADW gave it, and records these scenarios as passed:',
  function (this: RegressionWorld, tag: string, table: DataTable) {
    const reportPath = reportPathFor(requireProof(this), tag);
    assert.ok(fs.existsSync(reportPath), `Expected the run for "${tag}" to have written its JUnit report at "${reportPath}"`);
    const cases = readJunitCases(reportPath);
    const statuses = table.hashes().map(({ scenario }) => `${scenario}: ${caseForScenario(cases, scenario)?.status ?? 'not recorded'}`);
    assert.deepStrictEqual(
      statuses,
      table.hashes().map(({ scenario }) => `${scenario}: passed`),
      `Expected the JUnit report at "${reportPath}" to record every scenario as passed`,
    );
  },
);

Then("the JUnit report attaches exactly one image to {string}, and that image is in the scenario proof's artifacts directory", function (this: RegressionWorld, scenario: string) {
  const images = imagesOf(caseOf(this, scenario));
  assert.strictEqual(images.length, 1, `Expected exactly one image attached to "${scenario}", got ${JSON.stringify(images)}`);
  const [image] = images;
  assert.ok(fs.existsSync(image), `Expected the image "${image}" to exist`);
  const { artifactsDir } = requireProof(this);
  assert.ok(isInside(image, artifactsDir), `Expected the image "${image}" to be inside "${artifactsDir}"`);
});

Then('the JUnit report attaches no image to {string}', function (this: RegressionWorld, scenario: string) {
  assert.deepStrictEqual(imagesOf(caseOf(this, scenario)), [], `Expected no image attached to "${scenario}"`);
});

Then('the dev server ADW started served {string} during the run', function (servedPath: string) {
  assert.ok(s.devServerLog, "Expected the repository's dev server to have been described first");
  const served = devServerLog(s.devServerLog).filter(line => line.startsWith('GET ')).map(line => line.slice('GET '.length));
  assert.ok(served.includes(servedPath), `Expected the dev server to have served "${servedPath}", but it served: ${JSON.stringify(served)}`);
});
