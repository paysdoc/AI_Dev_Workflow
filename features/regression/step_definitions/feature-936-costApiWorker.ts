/**
 * Runs the cost-api Worker's real ingest and read handlers against an in-memory SQLite database
 * (the engine behind D1) that carries the Worker's real migrations. The handlers are loaded with
 * dynamic imports so that the root type-check, which has no Cloudflare types, never follows them,
 * and `node:sqlite` is loaded only when a scenario needs it.
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

const WORKER_SRC = path.join(process.cwd(), 'workers/cost-api/src');

interface WorkerEnv {
  readonly DB: unknown;
  readonly COST_API_TOKEN: string;
}

interface IngestHandlers {
  handleIngest(request: Request, env: WorkerEnv): Promise<Response>;
}

interface QueryHandlers {
  handleGetProjects(env: WorkerEnv): Promise<Response>;
  handleGetCostBreakdown(projectId: string, env: WorkerEnv): Promise<Response>;
  handleGetCostIssues(projectId: string, env: WorkerEnv): Promise<Response>;
}

export interface BreakdownEntry {
  readonly model: string;
  readonly provider: string;
  readonly totalCost: number;
}

export interface IssueCosts {
  readonly issueNumber: number;
  readonly totalCost: number;
  readonly phases: readonly { readonly phase: string; readonly cost: number }[];
}

export interface WorkerCostApi {
  ingest(payload: object): Promise<Response>;
  breakdownOf(project: string): Promise<BreakdownEntry[]>;
  issuesOf(project: string): Promise<IssueCosts[]>;
}

/** Only the surface of D1's prepared statements that the Worker's handlers use. */
class D1Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: readonly SQLInputValue[] = [],
  ) {}

  bind(...values: readonly (SQLInputValue | boolean)[]): D1Statement {
    return new D1Statement(this.db, this.sql, values.map(v => (typeof v === 'boolean' ? Number(v) : v)));
  }

  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[] };
  }

  async run(): Promise<{ results: [] }> {
    this.db.prepare(this.sql).run(...this.params);
    return { results: [] };
  }
}

class D1Database {
  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string): D1Statement {
    return new D1Statement(this.db, sql);
  }

  batch<T>(statements: readonly D1Statement[]): Promise<{ results: T[] }[]> {
    return Promise.all(statements.map(statement => statement.all<T>()));
  }
}

async function loadWorkerModule<T>(file: string): Promise<T> {
  return (await import(pathToFileURL(path.join(WORKER_SRC, file)).href)) as T;
}

async function openMigratedDatabase(): Promise<DatabaseSync> {
  const { DatabaseSync: Sqlite } = await import('node:sqlite');
  const db = new Sqlite(':memory:');
  const migrationsDir = path.join(WORKER_SRC, 'migrations');
  for (const file of fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf-8'));
  }
  return db;
}

async function jsonOf<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`Cost API answered ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

export async function createWorkerCostApi(): Promise<WorkerCostApi> {
  const [ingest, queries, db] = await Promise.all([
    loadWorkerModule<IngestHandlers>('ingest.ts'),
    loadWorkerModule<QueryHandlers>('queries.ts'),
    openMigratedDatabase(),
  ]);
  const env: WorkerEnv = { DB: new D1Database(db), COST_API_TOKEN: 'scenario-token' };

  async function projectId(slug: string): Promise<string> {
    const projects = await jsonOf<{ id: number; slug: string }[]>(await queries.handleGetProjects(env));
    const project = projects.find(p => p.slug === slug);
    if (!project) throw new Error(`The cost API stores no project "${slug}". Projects: ${JSON.stringify(projects)}`);
    return String(project.id);
  }

  return {
    ingest: payload => ingest.handleIngest(
      new Request('http://localhost/api/cost', { method: 'POST', body: JSON.stringify(payload) }),
      env,
    ),
    breakdownOf: async slug => jsonOf(await queries.handleGetCostBreakdown(await projectId(slug), env)),
    issuesOf: async slug => jsonOf(await queries.handleGetCostIssues(await projectId(slug), env)),
  };
}
