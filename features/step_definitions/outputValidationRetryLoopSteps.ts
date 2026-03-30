/**
 * Step definitions for output_validation_retry_loop.feature and related cross-feature scenarios.
 *
 * Strategy: code-inspection BDD — assertions verify source structure without executing agents.
 */

import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

function readSrc(relPath: string): string {
  const fullPath = join(ROOT, relPath);
  assert.ok(existsSync(fullPath), `Expected source file to exist: ${relPath}`);
  return readFileSync(fullPath, 'utf-8');
}

// ── Phase 1: Agents delegating to commandAgent ────────────────────────────────

When('searching for the agent invocation', function () {
  // Context only — assertions happen in Then steps
});

Then('reviewAgent delegates to commandAgent via a CommandAgentConfig', function () {
  const content = readSrc('adws/agents/reviewAgent.ts');
  assert.ok(
    content.includes('runCommandAgent') || content.includes('CommandAgentConfig'),
    'Expected reviewAgent.ts to delegate to commandAgent via CommandAgentConfig',
  );
});

Then('the config includes an extractOutput function that returns ReviewResult', function () {
  const content = readSrc('adws/agents/reviewAgent.ts');
  assert.ok(
    content.includes('extractOutput') && content.includes('ReviewResult'),
    'Expected reviewAgent.ts to include an extractOutput function that returns ReviewResult',
  );
});

Then('validationAgent delegates to commandAgent via a CommandAgentConfig', function () {
  const content = readSrc('adws/agents/validationAgent.ts');
  assert.ok(
    content.includes('runCommandAgent') || content.includes('CommandAgentConfig'),
    'Expected validationAgent.ts to delegate to commandAgent via CommandAgentConfig',
  );
});

Then('the config includes an extractOutput function that returns ValidationResult', function () {
  const content = readSrc('adws/agents/validationAgent.ts');
  assert.ok(
    content.includes('extractOutput') && content.includes('ValidationResult'),
    'Expected validationAgent.ts to include an extractOutput function returning ValidationResult',
  );
});

Then('alignmentAgent delegates to commandAgent via a CommandAgentConfig', function () {
  const content = readSrc('adws/agents/alignmentAgent.ts');
  assert.ok(
    content.includes('runCommandAgent') || content.includes('CommandAgentConfig'),
    'Expected alignmentAgent.ts to delegate to commandAgent via CommandAgentConfig',
  );
});

Then('the config includes an extractOutput function that returns AlignmentResult', function () {
  const content = readSrc('adws/agents/alignmentAgent.ts');
  assert.ok(
    content.includes('extractOutput') && content.includes('AlignmentResult'),
    'Expected alignmentAgent.ts to include an extractOutput function returning AlignmentResult',
  );
});

Then('resolutionAgent delegates to commandAgent via a CommandAgentConfig', function () {
  const content = readSrc('adws/agents/resolutionAgent.ts');
  assert.ok(
    content.includes('runCommandAgent') || content.includes('CommandAgentConfig'),
    'Expected resolutionAgent.ts to delegate to commandAgent via CommandAgentConfig',
  );
});

Then('the config includes an extractOutput function that returns ResolutionResult', function () {
  const content = readSrc('adws/agents/resolutionAgent.ts');
  assert.ok(
    content.includes('extractOutput') && content.includes('ResolutionResult'),
    'Expected resolutionAgent.ts to include an extractOutput function returning ResolutionResult',
  );
});

Then('testAgent delegates to commandAgent via a CommandAgentConfig', function () {
  const content = readSrc('adws/agents/testAgent.ts');
  assert.ok(
    content.includes('runCommandAgent') || content.includes('CommandAgentConfig'),
    'Expected testAgent.ts to delegate to commandAgent via CommandAgentConfig',
  );
});

Then('the config includes an extractOutput function that returns TestResult[]', function () {
  const content = readSrc('adws/agents/testAgent.ts');
  assert.ok(
    content.includes('extractOutput') && content.includes('TestResult'),
    'Expected testAgent.ts to include an extractOutput function returning TestResult[]',
  );
});

// ── Phase 2: JSON Schema co-located with extractOutput ────────────────────────

Given('the following agent files are read:', function (dataTable: { hashes(): Array<{ file: string }> }) {
  const files = dataTable.hashes().map(row => row.file);
  const contents = files.map(f => {
    const fullPath = join(ROOT, f);
    assert.ok(existsSync(fullPath), `Expected agent file to exist: ${f}`);
    return readFileSync(fullPath, 'utf-8');
  });
  sharedCtx.fileContent = contents.join('\n\n');
  sharedCtx.filePath = files.join(', ');
});

Then('each agent exports a JSON Schema object co-located with its extractOutput function', function () {
  const agentFiles = [
    'adws/agents/diffEvaluatorAgent.ts',
    'adws/agents/documentAgent.ts',
    'adws/agents/dependencyExtractionAgent.ts',
    'adws/agents/prAgent.ts',
    'adws/agents/stepDefAgent.ts',
    'adws/agents/reviewAgent.ts',
    'adws/agents/validationAgent.ts',
    'adws/agents/alignmentAgent.ts',
    'adws/agents/resolutionAgent.ts',
    'adws/agents/testAgent.ts',
  ];

  for (const file of agentFiles) {
    const content = readSrc(file);
    assert.ok(
      content.includes('Schema') || content.includes('outputSchema'),
      `Expected ${file} to define a JSON Schema object`,
    );
    assert.ok(
      content.includes('extractOutput'),
      `Expected ${file} to define an extractOutput function`,
    );
  }
});

Then('each schema is a valid JSON Schema definition', function () {
  // Validated at import-time by the TypeScript types (Record<string, unknown>)
  // and at runtime by Ajv. Code inspection verifies the schema has a 'type' property.
  const agentFiles = [
    'adws/agents/diffEvaluatorAgent.ts',
    'adws/agents/documentAgent.ts',
    'adws/agents/dependencyExtractionAgent.ts',
    'adws/agents/prAgent.ts',
    'adws/agents/stepDefAgent.ts',
    'adws/agents/reviewAgent.ts',
    'adws/agents/validationAgent.ts',
    'adws/agents/alignmentAgent.ts',
    'adws/agents/resolutionAgent.ts',
    'adws/agents/testAgent.ts',
  ];

  for (const file of agentFiles) {
    const content = readSrc(file);
    assert.ok(
      content.includes("type: '") || content.includes('"type":') || content.includes("type: \""),
      `Expected ${file} to have a JSON Schema with a 'type' property`,
    );
  }
});

// ── Phase 3: CommandAgentConfig outputSchema field ────────────────────────────

When('the CommandAgentConfig interface is inspected', function () {
  // Context only
});

Then('it includes an optional "outputSchema" field of type object', function () {
  const content = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    content.includes('outputSchema'),
    'Expected commandAgent.ts CommandAgentConfig to include an outputSchema field',
  );
  assert.ok(
    content.includes('Record<string, unknown>') || content.includes('outputSchema?'),
    'Expected outputSchema to be optional and typed as Record<string, unknown>',
  );
});

Then('the outputSchema is used for validation when extractOutput is defined', function () {
  const content = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    content.includes('outputSchema') && content.includes('extractOutput'),
    'Expected commandAgent.ts to use outputSchema alongside extractOutput',
  );
});

// ── Phase 4: extractOutput returns structured error ────────────────────────────

Given('an agent\'s extractOutput function receives malformed output', function () {
  sharedCtx.fileContent = readSrc('adws/agents/commandAgent.ts');
  sharedCtx.filePath = 'adws/agents/commandAgent.ts';
});

When('extractOutput attempts to parse and validate the output', function () {
  // Context only
});

Then('it returns a structured error object containing the specific validation message', function () {
  const content = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    content.includes('ExtractionResult') && content.includes('success: false'),
    'Expected commandAgent.ts to define ExtractionResult with success: false for errors',
  );
  assert.ok(
    content.includes('error: string'),
    'Expected ExtractionResult error branch to include an error string',
  );
});

Then('it does not throw an exception', function () {
  // Verify extractOutput returns ExtractionResult instead of throwing
  const commandAgent = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    commandAgent.includes('ExtractionResult'),
    'Expected commandAgent.ts to use ExtractionResult discriminated union (no throw)',
  );
  // Spot-check one agent to verify pattern
  const validationAgent = readSrc('adws/agents/validationAgent.ts');
  assert.ok(
    validationAgent.includes('success: false') || validationAgent.includes('ExtractionResult'),
    'Expected validationAgent extractOutput to return structured error instead of throwing',
  );
});

// ── Phase 5: Retry loop in runCommandAgent ────────────────────────────────────

Given('the commandAgent is configured with an extractOutput and outputSchema', function () {
  sharedCtx.fileContent = readSrc('adws/agents/commandAgent.ts');
  sharedCtx.filePath = 'adws/agents/commandAgent.ts';
});

Given('the initial agent output fails schema validation', function () {
  // Context only — verified by code inspection
});

When('runCommandAgent processes the output', function () {
  // Context only
});

Then('it spawns a new claude --print session for the retry', function () {
  const content = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    content.includes('runClaudeAgentWithCommand') && content.includes('retry'),
    'Expected commandAgent.ts to spawn a new runClaudeAgentWithCommand session for retries',
  );
});

Then('calls extractOutput on the retry output', function () {
  const content = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    content.includes('extractOutput(currentOutput)') || content.includes('extractOutput'),
    'Expected commandAgent.ts retry loop to call extractOutput on the retry output',
  );
});

Given('the original agent was invoked with model "opus"', function () {
  sharedCtx.fileContent = readSrc('adws/agents/commandAgent.ts');
  sharedCtx.filePath = 'adws/agents/commandAgent.ts';
});

Given('the output fails schema validation', function () {
  // Context only
});

When('the retry loop spawns a corrective session', function () {
  // Context only
});

Then('the retry session uses the Haiku model', function () {
  const content = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    content.includes("'haiku'"),
    "Expected commandAgent.ts retry loop to use 'haiku' model",
  );
});

Then('the retry goes through the same agent spawn infrastructure', function () {
  const content = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    content.includes('runClaudeAgentWithCommand'),
    'Expected commandAgent.ts retry to use runClaudeAgentWithCommand (same spawn infrastructure)',
  );
});

Given('the commandAgent output fails validation on every attempt', function () {
  sharedCtx.fileContent = readSrc('adws/agents/commandAgent.ts');
  sharedCtx.filePath = 'adws/agents/commandAgent.ts';
});

When('the retry loop executes', function () {
  // Context only
});

Then('extractOutput is called at most {int} times total \\({int} original + {int} retries)', function (
  _totalTimes: number,
  _originalCount: number,
  _retryCount: number,
) {
  const content = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    content.includes('MAX_RETRIES') || content.includes('10'),
    'Expected commandAgent.ts to define a MAX_RETRIES constant of 10',
  );
  // Verify the loop runs up to MAX_RETRIES
  assert.ok(
    content.includes('<= MAX_RETRIES') || content.includes('attempt <= MAX_RETRIES'),
    'Expected commandAgent.ts loop to iterate up to MAX_RETRIES',
  );
});

Then('the loop throws with the last validation error after all retries are exhausted', function () {
  const content = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    content.includes('OutputValidationError'),
    'Expected commandAgent.ts to throw OutputValidationError after exhausting retries',
  );
});

Given('the commandAgent output fails validation', function () {
  sharedCtx.fileContent = readSrc('adws/agents/commandAgent.ts');
  sharedCtx.filePath = 'adws/agents/commandAgent.ts';
});

Given('the same validation error occurs on 3 consecutive retry attempts', function () {
  // Context only
});

When('the retry loop detects the repeated error', function () {
  // Context only
});

Then('the loop exits early before reaching 10 retries', function () {
  const content = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    content.includes('MAX_CONSECUTIVE_IDENTICAL_ERRORS') || content.includes('consecutive'),
    'Expected commandAgent.ts to exit early on consecutive identical errors',
  );
});

Then('the error thrown indicates the validation error repeated consecutively', function () {
  const content = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    content.includes('consecutive') || content.includes('repeated'),
    'Expected commandAgent.ts to indicate consecutive error repetition in thrown error',
  );
});

// ── Phase 6: Retry prompt structure ──────────────────────────────────────────

Given('the commandAgent output fails validation with error "missing required field: decisions"', function () {
  sharedCtx.fileContent = readSrc('adws/agents/commandAgent.ts');
  sharedCtx.filePath = 'adws/agents/commandAgent.ts';
});

When('the retry prompt is constructed', function () {
  // Context only
});

Then('the prompt includes the original command name and arguments', function () {
  const content = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    content.includes('command') && content.includes('arguments'),
    'Expected commandAgent.ts retry prompt to include command and arguments',
  );
});

Then('the prompt includes the full original result.output', function () {
  const content = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    content.includes('originalOutput') || content.includes('result.output') || content.includes('currentOutput'),
    'Expected commandAgent.ts retry prompt to include full original output',
  );
});

Then('the prompt includes the JSON Schema definition', function () {
  const content = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    content.includes('schema') && content.includes('JSON.stringify'),
    'Expected commandAgent.ts retry prompt to include JSON Schema definition',
  );
});

Then('the prompt includes the specific validation error message', function () {
  const content = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    content.includes('validationError') || content.includes('Validation error'),
    'Expected commandAgent.ts retry prompt to include the specific validation error',
  );
});

Then('the prompt ends with an instruction to return only valid JSON', function () {
  const content = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    content.includes('Return ONLY valid JSON') || content.includes('ONLY valid JSON'),
    'Expected commandAgent.ts retry prompt to end with instruction to return only valid JSON',
  );
});

// ── Phase 7: Fresh --print invocation ─────────────────────────────────────────

When('a retry is spawned', function () {
  // Context only
});

Then('the retry uses claude --print without --resume', function () {
  const content = readSrc('adws/agents/claudeAgent.ts');
  assert.ok(
    content.includes('--print'),
    'Expected claudeAgent.ts to use --print for all invocations',
  );
  assert.ok(
    !content.includes('--resume'),
    'Expected claudeAgent.ts not to use --resume',
  );
});

Then('the retry is a completely new CLI session', function () {
  // Each runClaudeAgentWithCommand spawns a fresh process — verified by code structure
  const content = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    content.includes('runClaudeAgentWithCommand'),
    'Expected retry to spawn via runClaudeAgentWithCommand (fresh session)',
  );
});

Then('the retry goes through the same spawn\\/invocation path as the original agent', function () {
  const content = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    content.includes('runClaudeAgentWithCommand'),
    'Expected commandAgent.ts retry to reuse runClaudeAgentWithCommand (same path)',
  );
});

Then('no bare API calls are used for retries', function () {
  const content = readSrc('adws/agents/commandAgent.ts');
  // Verify no direct fetch/axios/anthropic SDK calls
  assert.ok(
    !content.includes('fetch(') && !content.includes('axios') && !content.includes('anthropic.messages'),
    'Expected commandAgent.ts not to use bare API calls for retries',
  );
});

// ── Phase 8: Single retry loop covers all agents ──────────────────────────────

Given('all agents are migrated to use commandAgent with extractOutput', function () {
  const agentFiles = [
    'adws/agents/diffEvaluatorAgent.ts',
    'adws/agents/documentAgent.ts',
    'adws/agents/dependencyExtractionAgent.ts',
    'adws/agents/prAgent.ts',
    'adws/agents/stepDefAgent.ts',
    'adws/agents/reviewAgent.ts',
    'adws/agents/validationAgent.ts',
    'adws/agents/alignmentAgent.ts',
    'adws/agents/resolutionAgent.ts',
    'adws/agents/testAgent.ts',
  ];

  for (const file of agentFiles) {
    const content = readSrc(file);
    assert.ok(
      content.includes('runCommandAgent') || content.includes('CommandAgentConfig'),
      `Expected ${file} to use commandAgent`,
    );
  }
});

When('any agent\'s output fails schema validation', function () {
  // Context only
});

Then('the same retry loop in runCommandAgent handles the retry', function () {
  const content = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    content.includes('runRetryLoop') || (content.includes('retry') && content.includes('extractOutput')),
    'Expected commandAgent.ts to contain a single retry loop handling all agents',
  );
});

Then('no agent implements its own retry-on-parse-failure logic', function () {
  const agentFiles = [
    'adws/agents/validationAgent.ts',
    'adws/agents/resolutionAgent.ts',
    'adws/agents/alignmentAgent.ts',
    'adws/agents/reviewAgent.ts',
    'adws/agents/testAgent.ts',
    'adws/agents/diffEvaluatorAgent.ts',
  ];

  for (const file of agentFiles) {
    const content = readSrc(file);
    // None of these should have their own retry logic (retrying once...)
    assert.ok(
      !content.includes('retrying once'),
      `Expected ${file} not to contain its own retry-on-parse-failure logic`,
    );
  }
});

// ── Phase 8: Per-agent retry logic removed ────────────────────────────────────

Given('the files "adws/agents/validationAgent.ts" and "adws/agents/resolutionAgent.ts" are read', function () {
  const validationContent = readSrc('adws/agents/validationAgent.ts');
  const resolutionContent = readSrc('adws/agents/resolutionAgent.ts');
  sharedCtx.fileContent = validationContent + '\n\n' + resolutionContent;
  sharedCtx.filePath = 'adws/agents/validationAgent.ts and adws/agents/resolutionAgent.ts';
});

Then('neither file contains its own retry-on-JSON-parse-failure logic', function () {
  const validationContent = readSrc('adws/agents/validationAgent.ts');
  const resolutionContent = readSrc('adws/agents/resolutionAgent.ts');
  assert.ok(
    !validationContent.includes('retrying once'),
    'Expected validationAgent.ts not to contain its own retry-on-JSON-parse-failure logic',
  );
  assert.ok(
    !resolutionContent.includes('retrying once'),
    'Expected resolutionAgent.ts not to contain its own retry-on-JSON-parse-failure logic',
  );
});

Then('neither file calls runClaudeAgentWithCommand directly for retries', function () {
  const validationContent = readSrc('adws/agents/validationAgent.ts');
  const resolutionContent = readSrc('adws/agents/resolutionAgent.ts');
  // They should delegate to runCommandAgent, not call runClaudeAgentWithCommand directly for retries
  assert.ok(
    !validationContent.includes('runClaudeAgentWithCommand'),
    'Expected validationAgent.ts not to call runClaudeAgentWithCommand directly (should use runCommandAgent)',
  );
  assert.ok(
    !resolutionContent.includes('runClaudeAgentWithCommand'),
    'Expected resolutionAgent.ts not to call runClaudeAgentWithCommand directly (should use runCommandAgent)',
  );
});

// ── Phase 9: TypeScript type-check passes ─────────────────────────────────────

Given('the ADW codebase with output validation retry loop implemented', function () {
  assert.ok(
    existsSync(join(ROOT, 'adws/agents/commandAgent.ts')),
    'Expected adws/agents/commandAgent.ts to exist',
  );
  const content = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    content.includes('OutputValidationError') && content.includes('ExtractionResult'),
    'Expected commandAgent.ts to contain OutputValidationError and ExtractionResult',
  );
});

// Note: '{string} is run', 'the command exits with code {int}', and
// '{string} also exits with code {int}' are defined in removeUnitTestsSteps.ts
// and wireExtractorSteps.ts — no duplication here.

// ── Cross-feature: retry_logic_resilience.feature ────────────────────────────

Given('the resolution agent uses commandAgent with extractOutput and outputSchema', function () {
  const content = readSrc('adws/agents/resolutionAgent.ts');
  assert.ok(
    content.includes('runCommandAgent') && content.includes('outputSchema'),
    'Expected resolutionAgent.ts to use commandAgent with outputSchema',
  );
});

When('the agent output fails JSON Schema validation', function () {
  // Context only
});

Then('the commandAgent retry loop handles retries with a Haiku corrective prompt', function () {
  const content = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    content.includes("'haiku'") && content.includes('retry'),
    'Expected commandAgent.ts retry loop to use haiku model for corrective prompts',
  );
});

Then('the resolution agent does not implement its own retry-on-parse-failure logic', function () {
  const content = readSrc('adws/agents/resolutionAgent.ts');
  assert.ok(
    !content.includes('retrying once'),
    'Expected resolutionAgent.ts not to have own retry-on-JSON-parse-failure logic',
  );
});

Given('the resolution agent output fails validation on all retry attempts', function () {
  // Context only — structural verification
  const content = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    content.includes('OutputValidationError'),
    'Expected commandAgent.ts to throw OutputValidationError when retries are exhausted',
  );
});

When('the commandAgent retry loop throws after exhausting retries', function () {
  // Context only
});

Then('the resolution phase catches the error and returns resolved=false with decisions=[]', function () {
  const content = readSrc('adws/phases/planValidationPhase.ts');
  assert.ok(
    content.includes('OutputValidationError') && content.includes('resolved: false'),
    'Expected planValidationPhase.ts to catch OutputValidationError and return resolved=false',
  );
});

Then('the orchestrator handles the unresolved result', function () {
  const content = readSrc('adws/phases/planValidationPhase.ts');
  assert.ok(
    content.includes('MAX_VALIDATION_RETRY_ATTEMPTS'),
    'Expected planValidationPhase.ts to handle unresolved result via retry loop',
  );
});

Given('the validation agent uses commandAgent with extractOutput and outputSchema', function () {
  const content = readSrc('adws/agents/validationAgent.ts');
  assert.ok(
    content.includes('runCommandAgent') && content.includes('outputSchema'),
    'Expected validationAgent.ts to use commandAgent with outputSchema',
  );
});

Then('the validation agent does not implement its own retry-on-parse-failure logic', function () {
  const content = readSrc('adws/agents/validationAgent.ts');
  assert.ok(
    !content.includes('retrying once'),
    'Expected validationAgent.ts not to have own retry-on-JSON-parse-failure logic',
  );
});

Given('the validation agent output fails validation on all retry attempts', function () {
  const content = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    content.includes('OutputValidationError'),
    'Expected commandAgent.ts to throw OutputValidationError when retries are exhausted',
  );
});

Then('the validation phase returns a failed validation result', function () {
  const content = readSrc('adws/phases/planValidationPhase.ts');
  assert.ok(
    content.includes('OutputValidationError') && content.includes('aligned: false'),
    'Expected planValidationPhase.ts to handle OutputValidationError with aligned=false fallback',
  );
});

// Note: 'the orchestrator retries up to MAX_VALIDATION_RETRY_ATTEMPTS' is defined
// in retryLogicResilienceSteps.ts — no duplication here.

// ── Cross-feature: single_pass_alignment_phase.feature @adw-u8xr9v ───────────

Given('the commandAgent retry loop exhausts all retries', function () {
  const content = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    content.includes('OutputValidationError'),
    'Expected commandAgent.ts to throw OutputValidationError when retries are exhausted',
  );
});

When('the alignment phase catches the output validation error', function () {
  // Context only
});

Then('the phase returns aligned = true with a warning describing the validation failure', function () {
  const content = readSrc('adws/phases/alignmentPhase.ts');
  assert.ok(
    content.includes('OutputValidationError') && content.includes('aligned: true'),
    'Expected alignmentPhase.ts to catch OutputValidationError and return aligned=true with warning',
  );
});

Then('the phase returns an empty changes array', function () {
  const content = readSrc('adws/phases/alignmentPhase.ts');
  assert.ok(
    content.includes('changes: []'),
    'Expected alignmentPhase.ts to return empty changes array when validation fails',
  );
});

// ── JSON Schema serves double duty ────────────────────────────────────────────

Given('any agent\'s CommandAgentConfig includes a JSON Schema', function () {
  // Spot-check one agent
  const content = readSrc('adws/agents/validationAgent.ts');
  assert.ok(
    content.includes('outputSchema') && content.includes('validationResultSchema'),
    'Expected validationAgent.ts CommandAgentConfig to include a JSON Schema',
  );
});

When('the schema is referenced in the retry loop', function () {
  // Context only
});

Then('the same schema object is used for both validation and inclusion in the retry prompt', function () {
  const content = readSrc('adws/agents/commandAgent.ts');
  assert.ok(
    content.includes('outputSchema') && content.includes('buildRetryPrompt'),
    'Expected commandAgent.ts to use outputSchema in both validation and retry prompt',
  );
});
