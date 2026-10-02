/**
 * The events the regression workflow runs on, and how a run of each reads the workflow's `on:`. A
 * scheduled run needs a `schedule` entry. A manual run needs `workflow_dispatch` and passes the
 * inputs that trigger declares: an input it does not declare, or a value outside the options of a
 * choice, is refused, and an input the run leaves out takes its declared default. Anything else
 * throws, which is a scenario error and never a failed run.
 */

import type { EventResolver, RunEvent } from './feature-939-workflow.ts';
import type { YamlMap, YamlNode } from './feature-939-yaml.ts';

export type RegressionEvent =
  | { readonly name: 'schedule' }
  | { readonly name: 'workflow_dispatch'; readonly inputs: Readonly<Record<string, string>> };

const isMap = (node: YamlNode | undefined): node is YamlMap => node instanceof Map;
const isSequence = (node: YamlNode | undefined): node is readonly YamlNode[] => Array.isArray(node);

/** The inputs `workflow_dispatch` declares, by name; a trigger with no `inputs:` declares none. */
function declaredInputs(trigger: YamlNode | undefined): YamlMap {
  const inputs = isMap(trigger) ? trigger.get('inputs') : undefined;
  return isMap(inputs) ? inputs : new Map();
}

function optionsOf(input: YamlNode): readonly string[] | undefined {
  const options = isMap(input) ? input.get('options') : undefined;
  return isSequence(options) ? options.filter((option): option is string => typeof option === 'string') : undefined;
}

function defaultOf(input: YamlNode): string {
  const value = isMap(input) ? input.get('default') : undefined;
  return typeof value === 'string' ? value : '';
}

function valueOf(name: string, input: YamlNode, passed: string | undefined): string {
  const value = passed ?? defaultOf(input);
  const options = optionsOf(input);
  if (options !== undefined && !options.includes(value)) {
    throw new Error(`The manual run is refused: the input "${name}" cannot be "${value}", its options are ${options.join(', ')}`);
  }
  return value;
}

function manualInputs(trigger: YamlNode | undefined, passed: Readonly<Record<string, string>>): ReadonlyMap<string, string> {
  const declared = declaredInputs(trigger);
  const undeclared = Object.keys(passed).find(name => !declared.has(name));
  if (undeclared !== undefined) throw new Error(`The manual run passes the input "${undeclared}", which the workflow does not declare`);
  return new Map([...declared].map(([name, input]): [string, string] => [name, valueOf(name, input, passed[name])]));
}

/** Reads the `on:` of a workflow for `event`. */
export function resolverFor(event: RegressionEvent): EventResolver {
  return (on): RunEvent => {
    if (!isMap(on)) throw new Error('Unsupported workflow syntax: no block-style "on:" trigger');
    if (!on.has(event.name)) throw new Error(`The workflow does not run on ${event.name}: its "on:" lists no ${event.name}`);
    const inputs = event.name === 'workflow_dispatch' ? manualInputs(on.get(event.name), event.inputs) : new Map<string, string>();
    return { name: event.name, inputs };
  };
}
