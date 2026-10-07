/**
 * Then steps of the feature-995 scenarios about the prompt the review agent is started with. Each assertion reads the "/review"
 * command line that the review phase saved for that review attempt, which feature-994's workflow records as the review runs.
 */

import { Then, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import * as path from 'path';

import { AGENT_COMMANDS, type AgentName } from './feature-929-agents.ts';
import { mentionsAnImageFile } from './feature-994-evidence.ts';
import { s } from './feature-994-world.ts';
import { guidanceSectionOf, type PromptReceived } from './feature-995-prompt.ts';

const REVIEW_COMMAND = '/review';

/** The prompt of the review agent on the attempt, counted from 1 in the order the reviews ran. */
function promptOfAttempt(agent: AgentName, attempt: number): PromptReceived {
  assert.strictEqual(AGENT_COMMANDS[agent], REVIEW_COMMAND, `Only the prompts of the review agent are recorded, not the ${agent}'s`);
  const received = s.prompts[attempt - 1];
  assert.ok(received, `Expected the ${agent} to have been started on review attempt ${attempt}, but it was started ${s.prompts.length} time(s)`);
  return received;
}

Then(
  'the {agent} was started on review attempt {int} with the paths of exactly these images in its prompt, each of which existed when it started:',
  function (agent: AgentName, attempt: number, table: DataTable) {
    const received = promptOfAttempt(agent, attempt);
    const listed = table.hashes().map(row => row['image']);
    const names = received.imagePaths.map(imagePath => path.basename(imagePath));

    assert.deepStrictEqual([...names].sort(), [...listed].sort(), `Expected the prompt to give the paths of exactly ${JSON.stringify(listed)}; it gives ${JSON.stringify(received.imagePaths)}.\n${received.prompt}`);
    received.imagePaths.forEach(imagePath => assert.ok(path.isAbsolute(imagePath), `Expected the prompt to give the absolute path of an image, but it gives "${imagePath}"`));
    assert.deepStrictEqual(received.missingImagePaths, [], 'Expected every image path in the prompt to name a file that existed when the review agent started');
  },
);

Then('the {agent} was started on review attempt {int} with no image path in its prompt', function (agent: AgentName, attempt: number) {
  const received = promptOfAttempt(agent, attempt);

  assert.deepStrictEqual(received.imagePaths, [], `Expected the prompt to give no image path.\n${received.prompt}`);
  assert.ok(!mentionsAnImageFile(received.prompt), `Expected the prompt to name no image file.\n${received.prompt}`);
});

Then('the {agent} was started on review attempt {int} with the review guidance section {string} in its prompt', function (agent: AgentName, attempt: number, section: string) {
  const received = promptOfAttempt(agent, attempt);

  assert.strictEqual(guidanceSectionOf(received), section, `Expected the prompt to name the guidance section "${section}".\n${received.prompt}`);
});

Then('the {agent} was started on review attempt {int} without the review guidance section {string} in its prompt', function (agent: AgentName, attempt: number, section: string) {
  const received = promptOfAttempt(agent, attempt);

  assert.ok(!received.prompt.includes(section), `Expected the prompt not to name the guidance section "${section}".\n${received.prompt}`);
});
