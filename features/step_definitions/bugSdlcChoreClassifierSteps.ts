import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

/**
 * Extracts the issueTypeToOrchestratorMap block from the shared file content.
 * Returns null if the map is not found.
 */
function extractIssueTypeToOrchestratorMapBlock(content: string): string | null {
  const match = content.match(/issueTypeToOrchestratorMap[^=]*=\s*\{([^}]+)\}/);
  return match ? match[1] : null;
}

Then(
  'the issueTypeToOrchestratorMap maps {string} to {string}',
  function (issueType: string, orchestrator: string) {
    const mapBlock = extractIssueTypeToOrchestratorMapBlock(sharedCtx.fileContent);
    assert.ok(
      mapBlock !== null,
      `Expected issueTypeToOrchestratorMap to be defined in ${sharedCtx.filePath}`,
    );
    const expectedEntry = `'${issueType}': '${orchestrator}'`;
    assert.ok(
      mapBlock.includes(expectedEntry),
      `Expected issueTypeToOrchestratorMap to map '${issueType}' to '${orchestrator}'.\nMap block:\n${mapBlock}`,
    );
  },
);

Then(
  'the issueTypeToOrchestratorMap does not map {string} to {string}',
  function (issueType: string, orchestrator: string) {
    const mapBlock = extractIssueTypeToOrchestratorMapBlock(sharedCtx.fileContent);
    assert.ok(
      mapBlock !== null,
      `Expected issueTypeToOrchestratorMap to be defined in ${sharedCtx.filePath}`,
    );
    const disallowedEntry = `'${issueType}': '${orchestrator}'`;
    assert.ok(
      !mapBlock.includes(disallowedEntry),
      `Expected issueTypeToOrchestratorMap NOT to map '${issueType}' to '${orchestrator}'.\nMap block:\n${mapBlock}`,
    );
  },
);

Then(
  'the classifier restricts chore to explicit requests or config\\/docs-only changes',
  function () {
    const content = sharedCtx.fileContent.toLowerCase();
    const hasRestriction =
      content.includes('explicit') ||
      content.includes('config') ||
      content.includes('docs-only') ||
      content.includes('documentation-only') ||
      content.includes('dependency bump') ||
      content.includes('ci/cd');
    assert.ok(
      hasRestriction,
      `Expected classify_issue.md to restrict /chore to explicit requests or config/docs-only changes.\nContent:\n${sharedCtx.fileContent}`,
    );
  },
);

Then(
  'the classifier defaults ambiguous issues to bug or feature not chore',
  function () {
    const content = sharedCtx.fileContent.toLowerCase();
    const hasAmbiguityGuidance =
      content.includes('doubt') ||
      content.includes('ambiguous') ||
      content.includes('prefer /bug') ||
      content.includes("prefer `/bug`");
    assert.ok(
      hasAmbiguityGuidance,
      `Expected classify_issue.md to guide defaulting ambiguous issues to /bug or /feature (e.g. "if in doubt").\nContent:\n${sharedCtx.fileContent}`,
    );
  },
);
