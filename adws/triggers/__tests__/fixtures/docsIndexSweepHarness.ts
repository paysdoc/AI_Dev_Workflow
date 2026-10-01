import { serializeConditionalDocs, type ConditionalDocsRegistry, type ConditionalDocEntry } from '../../../core/conditionalDocsRegistry';
import { DOCS_INDEX_REPORT_MARKER } from '../../../core/docsIndexReportBody';
import type { LaunchBoundary } from '../../../core';
import type { RepoIdentifier } from '@paysdoc/devplatform';
import { Platform } from '@paysdoc/devplatform';

export function entry(overrides: Partial<ConditionalDocEntry> & { docPath: string }): ConditionalDocEntry {
  return { ownedGlobs: [], conditions: ['When X'], decisions: [], ...overrides };
}

export function registryContent(entries: ConditionalDocEntry[]): string {
  const registry: ConditionalDocsRegistry = { preamble: '# Conditional Documentation\n', entries };
  return serializeConditionalDocs(registry);
}

/** Fully-injected boundary — no SweepBase is ever prepared since every base-dependent dep is overridden in these tests. */
export function makeFakeBoundary(selfHost = true): LaunchBoundary {
  const repoId: RepoIdentifier = { owner: 'test-owner', repo: 'test-repo', platform: Platform.GitHub };
  return {
    gitContext: { owner: 'test-owner', repo: 'test-repo', selfHost } as unknown as LaunchBoundary['gitContext'],
    repoId,
    providers: { issueTracker: {} as never, codeHost: {} as never },
  } as LaunchBoundary;
}

export function reportRef(number: number, fingerprint: string, state = 'OPEN') {
  return { number, body: `${DOCS_INDEX_REPORT_MARKER}\nFingerprint: ${fingerprint}\n`, state };
}
