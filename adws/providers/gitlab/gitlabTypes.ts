/**
 * GitLab REST API v4 response types.
 * Internal to the GitLab provider module.
 */

export interface GitLabUser {
  readonly id: number;
  readonly username: string;
  readonly name: string;
}

export interface GitLabProject {
  readonly id: number;
  readonly default_branch: string;
  readonly path_with_namespace: string;
}

export interface GitLabMergeRequest {
  readonly iid: number;
  readonly title: string;
  readonly description: string;
  readonly source_branch: string;
  readonly target_branch: string;
  readonly web_url: string;
  readonly state: string;
}

export interface GitLabNotePosition {
  readonly new_path?: string;
  readonly new_line?: number | null;
}

export interface GitLabNote {
  readonly id: number;
  readonly body: string;
  readonly author: GitLabUser;
  readonly created_at: string;
  readonly type: string | null;
  readonly position?: GitLabNotePosition;
}

export interface GitLabDiscussion {
  readonly id: string;
  readonly notes: readonly GitLabNote[];
}

export interface GitLabCreateMRPayload {
  readonly source_branch: string;
  readonly target_branch: string;
  readonly title: string;
  readonly description: string;
}
