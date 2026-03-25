/**
 * Shared types for ADW mock infrastructure.
 * Used by claude-cli-stub, github-api-server, git-remote-mock, and test-harness.
 */

/** Configuration for the mock infrastructure. */
export interface MockConfig {
  /** Port for the GitHub API mock server (0 = random). */
  port?: number;
  /** Base directory for fixture files. */
  fixtureDir?: string;
  /** Delay between streamed JSONL lines in milliseconds. */
  streamDelayMs?: number;
  /** Path to the Claude CLI stub script. */
  stubPath?: string;
  /** Directory containing the git mock wrapper script. */
  gitMockDir?: string;
}

/** A request recorded by the GitHub API mock server. */
export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  timestamp: string;
}

/** Options for assembling a JSONL fixture from envelope + payload parts. */
export interface FixtureAssemblyOptions {
  /** Path to the JSONL envelope template (JSON with empty content array). */
  envelopePath: string;
  /** Path to the payload file (JSON array of ContentBlock objects). */
  payloadPath: string;
  /** Delay between output lines in milliseconds. */
  delayMs: number;
}

/** In-memory state for the GitHub API mock server. */
export interface MockServerState {
  /** Map of issue number string → issue response object. */
  issues: Record<string, unknown>;
  /** Map of PR number string → PR response object. */
  prs: Record<string, unknown>;
  /** Map of issue/PR number string → array of comment objects. */
  comments: Record<string, unknown[]>;
  /** Map of issue number string → array of label objects. */
  labels: Record<string, unknown[]>;
}

/** Context returned by setupFixtureRepo. */
export interface FixtureRepoContext {
  /** Absolute path to the temporary fixture repo working directory. */
  repoDir: string;
  /** Removes the temp directory. */
  cleanup: () => void;
}

/** Context returned by setupMockInfrastructure. */
export interface MockContext {
  /** Base URL of the GitHub API mock server, e.g. http://localhost:3456. */
  serverUrl: string;
  /** Port the mock server is listening on. */
  port: number;
  /** Returns all requests recorded since last reset. */
  getRecordedRequests: () => RecordedRequest[];
  /** Configures mock state (issues, PRs, comments) for a scenario. */
  setState: (state: Partial<MockServerState>) => Promise<void>;
  /** Stops all mocks and restores env vars. */
  teardown: () => Promise<void>;
}
