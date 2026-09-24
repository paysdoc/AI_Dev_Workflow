export interface MockConfig {
  /** Port for the GitHub API mock server (0 = random). */
  port?: number;
  fixtureDir?: string;
  streamDelayMs?: number;
  stubPath?: string;
  gitMockDir?: string;
}

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  timestamp: string;
}

export interface FixtureAssemblyOptions {
  /** Path to the JSONL envelope template (JSON with empty content array). */
  envelopePath: string;
  /** Path to the payload file (JSON array of ContentBlock objects). */
  payloadPath: string;
  delayMs: number;
}

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

export interface FixtureRepoContext {
  /** Absolute path to the temporary fixture repo working directory. */
  repoDir: string;
  cleanup: () => void;
}

export interface MockContext {
  /** Base URL of the GitHub API mock server, e.g. http://localhost:3456. */
  serverUrl: string;
  port: number;
  /** Returns all requests recorded since last reset. */
  getRecordedRequests: () => RecordedRequest[];
  setState: (state: Partial<MockServerState>) => Promise<void>;
  teardown: () => Promise<void>;
}
