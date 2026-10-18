/**
 * Registry scenarios of feature-1043: what the Gherkin runtime registry answers for a BDD framework. The consultation
 * records both answers, and the assertions that follow read them.
 */

import { Then, When } from '@cucumber/cucumber';
import assert from 'assert';

import { isGherkinFramework, stepDefExtensionsFor } from '../../../adws/core/stepDefDetection.ts';

import { requireRegistry, s, type RegistryAnswer } from './feature-1043-world.ts';

/** The answer for the framework the scenario's own step consulted the registry for, not for a framework a later step names. */
function answerFor(framework: string): RegistryAnswer {
  const answer = requireRegistry();
  assert.strictEqual(answer.framework, framework, `Expected the registry to have been consulted for the BDD framework "${framework}", not "${answer.framework}"`);
  return answer;
}

When('the Gherkin runtime registry is consulted for the BDD framework {string}', function (framework: string) {
  s.registry = { framework, gherkin: isGherkinFramework(framework), extensions: stepDefExtensionsFor(framework) };
});

Then('the registry counts {string} as a Gherkin runtime', function (framework: string) {
  assert.ok(answerFor(framework).gherkin, `Expected the registry to count "${framework}" as a Gherkin runtime`);
});

Then(
  'the registry looks for the step definitions of {string} in files ending in {string} and {string}, and in no others',
  function (framework: string, first: string, second: string) {
    const { extensions } = answerFor(framework);
    assert.deepStrictEqual(
      [...extensions],
      [first, second],
      `Expected the registry to look for the step definitions of "${framework}" in "${first}" and "${second}" files only, but it looks in: ${extensions.join(', ')}`,
    );
  },
);
