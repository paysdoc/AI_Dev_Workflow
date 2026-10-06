/**
 * Hooks and Given/When steps of the review-screenshots scenarios. They run the real scenario test
 * phase and the real review phase; only R2 and the review agent are stand-ins, and the Then steps
 * (feature-937-then.steps.ts) read what those stand-ins and the recording issue tracker received.
 */

import { Given, When, Before, After, type DataTable } from '@cucumber/cucumber';

import { setProofUploaderForTesting } from '../../../adws/proof/proofUploader.ts';
import { deactivateStandInAgent } from './feature-937-agent.ts';
import { createReviewWorkflow, removeScenarios, runScenarioTestsThenReview, setProofRun } from './feature-937-workflow.ts';
import {
  createScreenshotStore,
  removeScenarioArtefacts,
  requireStore,
  resetWorld,
  screenshotsIn,
  world,
} from './feature-937-world.ts';

const RUN_TIMEOUT_MS = 60_000;

Before({ tags: '@review-comment-screenshots' }, function () {
  resetWorld();
});

After({ tags: '@review-comment-screenshots' }, function () {
  setProofUploaderForTesting(null);
  deactivateStandInAgent();
  removeScenarioArtefacts();
  resetWorld();
});

Given('the screenshot store records every upload and answers each with a public URL of its own', function () {
  world.store = createScreenshotStore();
});

Given(
  'a review workflow for issue {int} under adwId {string} whose issue tracker records every comment',
  function (issueNumber: number, adwId: string) {
    world.workflow = createReviewWorkflow(issueNumber, adwId);
  },
);

Given('the scenario run for that workflow leaves these screenshots in its proof directory:', function (table: DataTable) {
  setProofRun({ ...world.proofRun, screenshots: screenshotsIn(table) });
});

Given('the scenario run for that workflow leaves no screenshots in its proof directory', function () {
  setProofRun({ ...world.proofRun, screenshots: [] });
});

Given('the scenario run for that workflow also leaves the file {string} in its proof directory', function (relPath: string) {
  setProofRun({ ...world.proofRun, otherFiles: [...world.proofRun.otherFiles, relPath] });
});

Given('the repository of that workflow has no scenarios configured', function () {
  removeScenarios();
});

Given('the stand-in review agent passes the review', function () {
  world.verdict = { blocker: null };
});

Given('the stand-in review agent fails the review with the blocker {string}', function (blocker: string) {
  world.verdict = { blocker };
});

Given("the stand-in review agent's verdict lists the scenario proof file as its proof artifact", function () {
  world.listsProofFile = true;
});

Given('the screenshot store refuses the upload of {string}', function (relPath: string) {
  requireStore().refuse(relPath);
});

When('the scenario tests run and the review phase judges their proof', { timeout: RUN_TIMEOUT_MS }, runScenarioTestsThenReview);

When(
  'the next scenario run for that workflow leaves only the screenshot {string} in its proof directory',
  function (relPath: string) {
    setProofRun({ screenshots: [relPath], otherFiles: [] });
  },
);

When(
  'the scenario tests run again and the review phase judges their new proof',
  { timeout: RUN_TIMEOUT_MS },
  runScenarioTestsThenReview,
);
