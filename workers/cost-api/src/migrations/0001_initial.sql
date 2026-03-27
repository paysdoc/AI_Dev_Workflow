CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  repo_url TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cost_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  workflow_id TEXT,
  issue_number INTEGER NOT NULL,
  issue_description TEXT,
  phase TEXT NOT NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'anthropic',
  computed_cost_usd REAL NOT NULL,
  reported_cost_usd REAL,
  status TEXT,
  retry_count INTEGER DEFAULT 0,
  continuation_count INTEGER DEFAULT 0,
  duration_ms INTEGER,
  timestamp TEXT,
  migrated BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS token_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cost_record_id INTEGER NOT NULL REFERENCES cost_records(id),
  token_type TEXT NOT NULL,
  count INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cost_records_project_id ON cost_records(project_id);
CREATE INDEX IF NOT EXISTS idx_cost_records_workflow_id ON cost_records(workflow_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_cost_record_id ON token_usage(cost_record_id);
