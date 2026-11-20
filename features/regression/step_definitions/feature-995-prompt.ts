/**
 * The "/review" command line ADW started the review agent with, as the review phase saved it in the agent's state directory,
 * read back into the positional arguments the prompt documents. The next scenario run deletes the images of the run before it,
 * so a step that stands for a review records what it needs while the review runs. No hooks and no steps: any step file may
 * import it.
 */

import * as fs from 'fs';
import * as path from 'path';

import { AgentStateManager } from '../../../adws/core/agentState.ts';
import type { WorkflowConfig } from '../../../adws/phases/workflowInit.ts';

/** `$4`: the title of the guidance section the reviewer applies. */
const GUIDANCE_SECTION_ARGUMENT = 4;
/** `$6`: a JSON array of the absolute paths of the images the reviewer must open. */
const IMAGE_PATHS_ARGUMENT = 6;

const QUOTED_ARGUMENT = /'((?:[^']|'\\'')*)'/g;

/** What a review agent was started with, and which of the images it was told to open existed when its review had run. */
export interface PromptReceived {
  /** The command line, as saved. */
  readonly prompt: string;
  readonly args: readonly string[];
  readonly imagePaths: readonly string[];
  readonly missingImagePaths: readonly string[];
}

/** ADW single-quotes every argument, and writes a single quote inside one as `'\''`. */
export function argumentsOf(commandLine: string): string[] {
  return [...commandLine.matchAll(QUOTED_ARGUMENT)].map(match => match[1].replace(/'\\''/g, "'"));
}

export function guidanceSectionOf(received: PromptReceived): string {
  return received.args[GUIDANCE_SECTION_ARGUMENT] ?? '';
}

function imagePathsOf(args: readonly string[]): string[] {
  const parsed: unknown = JSON.parse(args[IMAGE_PATHS_ARGUMENT] ?? 'null');
  if (!Array.isArray(parsed) || !parsed.every(entry => typeof entry === 'string')) {
    throw new Error(`Expected argument $${IMAGE_PATHS_ARGUMENT} of the review prompt to be a JSON array of paths, but it is ${args[IMAGE_PATHS_ARGUMENT]}`);
  }
  return parsed;
}

/** Reads the prompt the review phase of the workflow saved for the review agent's last start. */
export function readReviewPrompt(config: Pick<WorkflowConfig, 'adwId' | 'orchestratorStatePath'>): PromptReceived {
  const agentStatePath = AgentStateManager.initializeState(config.adwId, 'review-agent', config.orchestratorStatePath);
  const prompt = fs.readFileSync(path.join(agentStatePath, 'prompts', 'review.txt'), 'utf-8');
  const args = argumentsOf(prompt);
  const imagePaths = imagePathsOf(args);
  return { prompt, args, imagePaths, missingImagePaths: imagePaths.filter(imagePath => !fs.existsSync(imagePath)) };
}
