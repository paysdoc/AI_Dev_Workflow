import type { StageResolution } from '../cronStageResolver';

export function makeIssue(overrides: {
  number?: number;
  createdAt?: string;
  updatedAt?: string;
  comments?: { body: string }[];
  labels?: { name: string }[];
} = {}) {
  return {
    number: 1,
    body: 'issue body',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    comments: [],
    labels: [],
    ...overrides,
  };
}

export function makeResolution(stage: string | null, adwId = 'test-adw-id', lastActivityMs: number | null = null): StageResolution {
  return { stage, adwId, lastActivityMs };
}

export function freshResolution(): StageResolution {
  return { stage: null, adwId: null, lastActivityMs: null };
}

// Resolution helper with a non-null adwId (simulates dead-orchestrator takeover path)
export function takeoverResolution(): StageResolution {
  return { stage: null, adwId: 'existing-adw-id', lastActivityMs: null };
}

export const GRACE_PERIOD_MS = 60_000;
export const NOW = new Date('2024-06-01T12:00:00Z').getTime();
export const OLD_DATE = new Date('2024-01-01T00:00:00Z').toISOString();
