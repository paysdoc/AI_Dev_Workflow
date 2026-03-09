/**
 * Jira REST API v3 response types.
 * Internal to the Jira provider module.
 */

export interface JiraUser {
  readonly displayName: string;
  readonly emailAddress?: string;
  readonly accountId?: string;
}

export interface JiraStatusCategory {
  readonly id: number;
  readonly key: string;
  readonly name: string;
}

export interface JiraStatus {
  readonly name: string;
  readonly statusCategory: JiraStatusCategory;
}

export interface JiraCommentResponse {
  readonly id: string;
  readonly author: JiraUser;
  readonly body: unknown;
  readonly created: string;
}

export interface JiraCommentPage {
  readonly comments: readonly JiraCommentResponse[];
  readonly startAt: number;
  readonly maxResults: number;
  readonly total: number;
}

export interface JiraIssueFields {
  readonly summary: string;
  readonly description: unknown;
  readonly status: JiraStatus;
  readonly creator: JiraUser;
  readonly labels: readonly string[];
  readonly comment?: JiraCommentPage;
}

export interface JiraIssueResponse {
  readonly id: string;
  readonly key: string;
  readonly fields: JiraIssueFields;
}

export interface JiraTransitionTarget {
  readonly name: string;
  readonly statusCategory: JiraStatusCategory;
}

export interface JiraTransition {
  readonly id: string;
  readonly name: string;
  readonly to: JiraTransitionTarget;
}

export interface JiraTransitionsResponse {
  readonly transitions: readonly JiraTransition[];
}

export interface JiraApiError {
  readonly statusCode: number;
  readonly message: string;
  readonly errors?: Record<string, string>;
}
