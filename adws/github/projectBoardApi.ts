/**
 * GitHub Projects V2 API functions for moving issues across project board statuses.
 * Uses the gh CLI with GraphQL queries to interact with GitHub Projects V2.
 */

import { execSync } from 'child_process';
import { log } from '../core';
import { type RepoInfo } from './githubApi';
import { getTargetRepo } from '../core/targetRepoRegistry';

interface ProjectItem {
  readonly itemId: string;
  readonly currentStatus: string | null;
}

interface StatusOption {
  readonly id: string;
  readonly name: string;
}

interface StatusFieldInfo {
  readonly fieldId: string;
  readonly options: readonly StatusOption[];
}

/**
 * Finds the first GitHub Project V2 linked to the repository.
 * @returns The project ID, or null if no project is linked.
 */
export function findRepoProjectId(owner: string, repo: string): string | null {
  try {
    const query = `
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          projectsV2(first: 1) {
            nodes { id }
          }
        }
      }
    `;
    const result = execSync(
      `gh api graphql -f query='${query}' -f owner='${owner}' -f repo='${repo}'`,
      { encoding: 'utf-8' }
    );
    const parsed = JSON.parse(result) as {
      data: { repository: { projectsV2: { nodes: Array<{ id: string }> } } };
    };
    const nodes = parsed.data.repository.projectsV2.nodes;
    return nodes.length > 0 ? nodes[0].id : null;
  } catch (error) {
    log(`Failed to find project for ${owner}/${repo}: ${error}`, 'warn');
    return null;
  }
}

/**
 * Finds an issue's item within a GitHub Project V2.
 * @returns The item ID and current status, or null if the issue isn't in the project.
 */
export function findIssueProjectItem(
  owner: string,
  repo: string,
  issueNumber: number,
  projectId: string,
): ProjectItem | null {
  try {
    const query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $number) {
            projectItems(first: 50) {
              nodes {
                id
                project { id }
                fieldValueByName(name: "Status") {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                  }
                }
              }
            }
          }
        }
      }
    `;
    const result = execSync(
      `gh api graphql -f query='${query}' -f owner='${owner}' -f repo='${repo}' -F number=${issueNumber}`,
      { encoding: 'utf-8' }
    );
    const parsed = JSON.parse(result) as {
      data: {
        repository: {
          issue: {
            projectItems: {
              nodes: Array<{
                id: string;
                project: { id: string };
                fieldValueByName: { name: string } | null;
              }>;
            };
          };
        };
      };
    };
    const items = parsed.data.repository.issue.projectItems.nodes;
    const match = items.find((item) => item.project.id === projectId);
    if (!match) return null;

    return {
      itemId: match.id,
      currentStatus: match.fieldValueByName?.name ?? null,
    };
  } catch (error) {
    log(`Failed to find issue #${issueNumber} in project: ${error}`, 'warn');
    return null;
  }
}

/**
 * Gets the Status field metadata and available options for a project.
 * @returns The field ID and options, or null if no Status field exists.
 */
export function getStatusFieldOptions(projectId: string): StatusFieldInfo | null {
  try {
    const query = `
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            field(name: "Status") {
              ... on ProjectV2SingleSelectField {
                id
                options { id name }
              }
            }
          }
        }
      }
    `;
    const result = execSync(
      `gh api graphql -f query='${query}' -f projectId='${projectId}'`,
      { encoding: 'utf-8' }
    );
    const parsed = JSON.parse(result) as {
      data: {
        node: {
          field: { id: string; options: Array<{ id: string; name: string }> } | null;
        };
      };
    };
    const field = parsed.data.node.field;
    if (!field || !field.id) return null;

    return {
      fieldId: field.id,
      options: field.options,
    };
  } catch (error) {
    log(`Failed to get status field options for project: ${error}`, 'warn');
    return null;
  }
}

/**
 * Updates the status of a project item.
 */
export function updateProjectItemStatus(
  projectId: string,
  itemId: string,
  fieldId: string,
  optionId: string,
): void {
  const mutation = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { singleSelectOptionId: $optionId }
      }) {
        projectV2Item { id }
      }
    }
  `;
  execSync(
    `gh api graphql -f query='${mutation}' -f projectId='${projectId}' -f itemId='${itemId}' -f fieldId='${fieldId}' -f optionId='${optionId}'`,
    { encoding: 'utf-8' }
  );
}

/**
 * Matches a target status name against available options using fuzzy logic.
 * "Review" matches "In Review", "In Progress" matches "In Progress", etc.
 */
function matchStatusOption(
  targetStatus: string,
  options: readonly StatusOption[],
): StatusOption | null {
  const target = targetStatus.toLowerCase();

  // Exact match first
  const exact = options.find((opt) => opt.name.toLowerCase() === target);
  if (exact) return exact;

  // Fuzzy match: "Review" matches "In Review"
  const fuzzy = options.find((opt) => opt.name.toLowerCase().includes(target));
  return fuzzy ?? null;
}

/**
 * Moves a GitHub issue to a target status on its project board.
 * This is a high-level orchestrator that silently handles all error cases:
 * - No project linked to the repository
 * - Issue not in the project
 * - Target status not available
 * - Issue already in the target status
 * - Any API or network errors
 *
 * @param issueNumber - The issue number to move
 * @param targetStatus - The target status name (e.g., "In Progress", "Review")
 * @param repoInfo - Optional repository info override
 */
export async function moveIssueToStatus(
  issueNumber: number,
  targetStatus: string,
  repoInfo?: RepoInfo,
): Promise<void> {
  try {
    const { owner, repo } = repoInfo ?? getTargetRepo();

    const projectId = findRepoProjectId(owner, repo);
    if (!projectId) {
      log(`No project linked to ${owner}/${repo}, skipping status update`, 'info');
      return;
    }

    const projectItem = findIssueProjectItem(owner, repo, issueNumber, projectId);
    if (!projectItem) {
      log(`Issue #${issueNumber} not found in project, skipping status update`, 'info');
      return;
    }

    // Check if already in the target status
    if (projectItem.currentStatus?.toLowerCase() === targetStatus.toLowerCase()) {
      log(`Issue #${issueNumber} already in "${targetStatus}", skipping`, 'info');
      return;
    }

    const statusField = getStatusFieldOptions(projectId);
    if (!statusField) {
      log(`No Status field found in project, skipping status update`, 'info');
      return;
    }

    const matchedOption = matchStatusOption(targetStatus, statusField.options);
    if (!matchedOption) {
      log(`Status "${targetStatus}" not found in project options, skipping`, 'info');
      return;
    }

    // Also check fuzzy-matched current status
    if (projectItem.currentStatus?.toLowerCase() === matchedOption.name.toLowerCase()) {
      log(`Issue #${issueNumber} already in "${matchedOption.name}", skipping`, 'info');
      return;
    }

    updateProjectItemStatus(projectId, projectItem.itemId, statusField.fieldId, matchedOption.id);
    log(`Moved issue #${issueNumber} to "${matchedOption.name}" on project board`, 'success');
  } catch (error) {
    log(`Failed to move issue #${issueNumber} to "${targetStatus}": ${error}`, 'warn');
  }
}
