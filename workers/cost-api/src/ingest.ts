import type { Env, IngestPayload, IngestRecord } from './types.ts';

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTokenUsageMap(value: unknown): value is Record<string, number> {
  return isObject(value) && Object.values(value).every(v => typeof v === 'number');
}

function validateRecord(record: unknown, index: number): string | null {
  if (!isObject(record)) return `records[${index}] must be an object`;
  if (typeof record['issue_number'] !== 'number') {
    return `records[${index}].issue_number must be a number`;
  }
  if (typeof record['phase'] !== 'string' || !record['phase']) {
    return `records[${index}].phase must be a non-empty string`;
  }
  if (typeof record['model'] !== 'string' || !record['model']) {
    return `records[${index}].model must be a non-empty string`;
  }
  if (typeof record['computed_cost_usd'] !== 'number') {
    return `records[${index}].computed_cost_usd must be a number`;
  }
  if (!isTokenUsageMap(record['token_usage'])) {
    return `records[${index}].token_usage must be a map of string to number`;
  }
  return null;
}

type ValidationResult = { readonly payload: IngestPayload } | { readonly error: string };

function validatePayload(body: unknown): ValidationResult {
  if (!isObject(body)) return { error: 'Request body must be a JSON object' };

  if (typeof body['project'] !== 'string' || !body['project']) {
    return { error: 'Missing required field: project' };
  }

  if (!Array.isArray(body['records'])) {
    return { error: 'Missing required field: records (must be an array)' };
  }

  if (body['records'].length === 0) {
    return { error: 'records array must contain at least one record' };
  }

  for (let i = 0; i < body['records'].length; i++) {
    const err = validateRecord(body['records'][i], i);
    if (err !== null) return { error: err };
  }

  return { payload: body as unknown as IngestPayload };
}

// ---------------------------------------------------------------------------
// Project resolution
// ---------------------------------------------------------------------------

interface ProjectRow {
  readonly id: number;
}

/**
 * Resolves a project by slug, auto-creating it if not found.
 * Uses INSERT OR IGNORE + SELECT to handle concurrent requests safely.
 */
async function resolveProject(
  db: D1Database,
  slug: string,
  name?: string,
  repoUrl?: string,
): Promise<number> {
  const displayName = name ?? slug;
  const now = new Date().toISOString();

  await db
    .prepare('INSERT OR IGNORE INTO projects (slug, name, repo_url, created_at) VALUES (?, ?, ?, ?)')
    .bind(slug, displayName, repoUrl ?? null, now)
    .run();

  const row = await db
    .prepare('SELECT id FROM projects WHERE slug = ?')
    .bind(slug)
    .first<ProjectRow>();

  if (!row) throw new Error(`Failed to resolve project slug: ${slug}`);
  return row.id;
}

// ---------------------------------------------------------------------------
// D1 inserts
// ---------------------------------------------------------------------------

interface CostRecordIdRow {
  readonly id: number;
}

async function insertCostRecords(
  db: D1Database,
  records: readonly IngestRecord[],
  projectId: number,
): Promise<number[]> {
  const stmts = records.map(record =>
    db.prepare(`
      INSERT INTO cost_records
        (project_id, workflow_id, issue_number, issue_description, phase, model, provider,
         computed_cost_usd, reported_cost_usd, status, retry_count, continuation_count,
         duration_ms, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `).bind(
      projectId,
      record.workflow_id ?? null,
      record.issue_number,
      record.issue_description ?? null,
      record.phase,
      record.model,
      record.provider ?? 'anthropic',
      record.computed_cost_usd,
      record.reported_cost_usd ?? null,
      record.status ?? null,
      record.retry_count ?? 0,
      record.continuation_count ?? 0,
      record.duration_ms ?? null,
      record.timestamp ?? null,
    )
  );

  const results = await db.batch<CostRecordIdRow>(stmts);
  return results.map((r, i) => {
    const row = r.results[0];
    if (!row) throw new Error(`INSERT INTO cost_records did not return an id at index ${i}`);
    return row.id;
  });
}

async function insertTokenUsage(
  db: D1Database,
  records: readonly IngestRecord[],
  costRecordIds: number[],
): Promise<void> {
  const stmts = records.flatMap((record, i) => {
    const costRecordId = costRecordIds[i];
    if (costRecordId === undefined) {
      throw new Error(`Unexpected: missing cost_record_id at index ${i}`);
    }
    return Object.entries(record.token_usage).map(([tokenType, count]) =>
      db.prepare(
        'INSERT INTO token_usage (cost_record_id, token_type, count) VALUES (?, ?, ?)',
      ).bind(costRecordId, tokenType, count)
    );
  });

  if (stmts.length > 0) {
    await db.batch(stmts);
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handles `POST /api/cost` — validates the ingest payload, resolves the
 * project, and batch-inserts cost records + token usage rows into D1.
 */
export async function handleIngest(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const validation = validatePayload(body);
  if ('error' in validation) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  const { payload } = validation;

  let projectId: number;
  try {
    projectId = await resolveProject(env.DB, payload.project, payload.name, payload.repo_url);
  } catch (err) {
    return Response.json(
      { error: `D1 error resolving project: ${String(err)}` },
      { status: 500 },
    );
  }

  let costRecordIds: number[];
  try {
    costRecordIds = await insertCostRecords(env.DB, payload.records, projectId);
  } catch (err) {
    return Response.json(
      { error: `D1 error inserting cost records: ${String(err)}` },
      { status: 500 },
    );
  }

  try {
    await insertTokenUsage(env.DB, payload.records, costRecordIds);
  } catch (err) {
    return Response.json(
      { error: `D1 error inserting token usage: ${String(err)}` },
      { status: 500 },
    );
  }

  return Response.json({ inserted: payload.records.length }, { status: 201 });
}
