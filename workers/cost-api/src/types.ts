/** Worker environment bindings. */
export interface Env {
  readonly DB: D1Database;
  readonly COST_API_TOKEN: string;
}

/** A single cost record within an ingest payload. */
export interface IngestRecord {
  readonly workflow_id?: string;
  readonly issue_number: number;
  readonly issue_description?: string;
  readonly phase: string;
  readonly model: string;
  readonly provider?: string;
  readonly computed_cost_usd: number;
  readonly reported_cost_usd?: number;
  readonly status?: string;
  readonly retry_count?: number;
  readonly continuation_count?: number;
  readonly duration_ms?: number;
  readonly timestamp?: string;
  /** Map of token type → count (e.g. `{ input: 100, output: 200, cache_read: 1500 }`). */
  readonly token_usage: Readonly<Record<string, number>>;
}

/** Top-level ingest request body. */
export interface IngestPayload {
  /** Project slug — used to resolve or auto-create the project row. */
  readonly project: string;
  /** Display name for the project; used only during auto-creation, defaults to slug. */
  readonly name?: string;
  /** GitHub/GitLab repo URL; used only during auto-creation. */
  readonly repo_url?: string;
  readonly records: readonly IngestRecord[];
}

/** 201 success response body. */
export interface SuccessResponse {
  readonly inserted: number;
}

/** 400 / 401 / 500 error response body. */
export interface ErrorResponse {
  readonly error: string;
}
