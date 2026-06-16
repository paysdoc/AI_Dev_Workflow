import { describe, it, expect } from 'vitest';
import { formatPrProofComment } from '../prProofPublisher';
import type { TagProofResultLike, UploadedArtifact } from '../types';

function makeTag(overrides: Partial<TagProofResultLike> = {}): TagProofResultLike {
  return {
    resolvedTag: '@adw-test',
    severity: 'blocker',
    passed: true,
    skipped: false,
    counts: { total: 5, passed: 4, failed: 1 },
    ...overrides,
  };
}

function makeUpload(overrides: Partial<UploadedArtifact> = {}): UploadedArtifact {
  return {
    scenario: 'Login flow',
    url: 'https://screenshots.paysdoc.nl/acme/proof/adw-id/login/step-1.png',
    fileName: 'step-1.png',
    ...overrides,
  };
}

describe('formatPrProofComment', () => {
  describe('header and tally', () => {
    it('includes the BDD Proof heading', () => {
      const result = formatPrProofComment({ tagResults: [makeTag()], uploaded: [], r2Configured: true });
      expect(result).toContain('## :camera: BDD Proof');
    });

    it('shows N passed, M failed tally explicitly', () => {
      const result = formatPrProofComment({
        tagResults: [makeTag({ counts: { total: 5, passed: 4, failed: 1 } })],
        uploaded: [],
        r2Configured: true,
      });
      expect(result).toContain('4 passed, 1 failed');
    });

    it('marks overall status as passed when no blocker failures', () => {
      const result = formatPrProofComment({
        tagResults: [makeTag({ passed: true })],
        uploaded: [],
        r2Configured: true,
      });
      expect(result).toContain('✅');
    });

    it('marks overall status as failed when blocker fails', () => {
      const result = formatPrProofComment({
        tagResults: [makeTag({ passed: false })],
        uploaded: [],
        r2Configured: true,
      });
      expect(result).toContain('❌');
    });

    it('renders minimal body for empty tagResults', () => {
      const result = formatPrProofComment({ tagResults: [], uploaded: [], r2Configured: true });
      expect(result).toContain('No scenario proof available');
    });
  });

  describe('summary table', () => {
    it('renders passed/total ratio from counts', () => {
      const result = formatPrProofComment({
        tagResults: [makeTag({ counts: { total: 10, passed: 8, failed: 2 } })],
        uploaded: [],
        r2Configured: true,
      });
      expect(result).toContain('8/10');
    });

    it('renders - for scenarios when skipped', () => {
      const result = formatPrProofComment({
        tagResults: [makeTag({ skipped: true, passed: true, counts: undefined })],
        uploaded: [],
        r2Configured: true,
      });
      expect(result).toContain('⏭️ skipped');
    });

    it('renders ✅ for a passing suite', () => {
      const result = formatPrProofComment({
        tagResults: [makeTag({ passed: true })],
        uploaded: [],
        r2Configured: true,
      });
      expect(result).toContain('✅ passed');
    });

    it('renders ❌ for a failing suite', () => {
      const result = formatPrProofComment({
        tagResults: [makeTag({ passed: false })],
        uploaded: [],
        r2Configured: true,
      });
      expect(result).toContain('❌ failed');
    });
  });

  describe('inline embeds', () => {
    it('inlines image as [![name](url)](url) pattern', () => {
      const url = 'https://screenshots.paysdoc.nl/acme/login/step-1.png';
      const result = formatPrProofComment({
        tagResults: [makeTag()],
        uploaded: [makeUpload({ url, fileName: 'step-1.png' })],
        r2Configured: true,
      });
      expect(result).toContain(`[![step-1.png](${url})](${url})`);
    });

    it('includes raw URL as a fallback line beneath the embed', () => {
      const url = 'https://screenshots.paysdoc.nl/acme/login/step-1.png';
      const result = formatPrProofComment({
        tagResults: [makeTag()],
        uploaded: [makeUpload({ url })],
        r2Configured: true,
      });
      // The raw URL should appear as a standalone line (not just embedded inside markdown)
      expect(result).toMatch(new RegExp(`\\)\\n${url.replace(/\./g, '\\.')}`));
    });
  });

  describe('collapsible per-scenario grouping', () => {
    it('groups screenshots under a <details> section per scenario', () => {
      const result = formatPrProofComment({
        tagResults: [makeTag()],
        uploaded: [
          makeUpload({ scenario: 'Login flow', url: 'https://screenshots.paysdoc.nl/a/1.png' }),
        ],
        r2Configured: true,
      });
      expect(result).toContain('<details>');
      expect(result).toContain('<summary>Login flow (1)</summary>');
    });

    it('creates separate <details> for each distinct scenario', () => {
      const result = formatPrProofComment({
        tagResults: [makeTag()],
        uploaded: [
          makeUpload({ scenario: 'Login flow', url: 'https://screenshots.paysdoc.nl/a/1.png' }),
          makeUpload({ scenario: 'Checkout flow', url: 'https://screenshots.paysdoc.nl/a/2.png' }),
        ],
        r2Configured: true,
      });
      expect(result).toContain('<summary>Login flow (1)</summary>');
      expect(result).toContain('<summary>Checkout flow (1)</summary>');
    });
  });

  describe('zero screenshots fallback', () => {
    it('omits <details> block when uploaded is empty and R2 is configured', () => {
      const result = formatPrProofComment({
        tagResults: [makeTag()],
        uploaded: [],
        r2Configured: true,
      });
      expect(result).not.toContain('<details>');
    });

    it('includes R2 not configured note when r2Configured is false and no uploads', () => {
      const result = formatPrProofComment({
        tagResults: [makeTag()],
        uploaded: [],
        r2Configured: false,
      });
      expect(result).toContain('R2 is not configured');
    });

    it('still includes pass/fail summary even with no screenshots', () => {
      const result = formatPrProofComment({
        tagResults: [makeTag({ counts: { total: 3, passed: 3, failed: 0 } })],
        uploaded: [],
        r2Configured: true,
      });
      expect(result).toContain('3 passed, 0 failed');
    });
  });

  describe('mixed pass/fail suites', () => {
    it('marks overall as failed when any blocker suite fails', () => {
      const result = formatPrProofComment({
        tagResults: [
          makeTag({ resolvedTag: '@suite-a', passed: true }),
          makeTag({ resolvedTag: '@suite-b', passed: false, severity: 'blocker' }),
        ],
        uploaded: [],
        r2Configured: true,
      });
      expect(result).toContain('❌');
    });

    it('marks overall as passed when only tech-debt suite fails', () => {
      const result = formatPrProofComment({
        tagResults: [
          makeTag({ resolvedTag: '@suite-a', passed: true, severity: 'blocker' }),
          makeTag({ resolvedTag: '@suite-b', passed: false, severity: 'tech-debt' }),
        ],
        uploaded: [],
        r2Configured: true,
      });
      expect(result).toContain('✅');
    });

    it('sums counts across non-skipped suites in the tally', () => {
      const result = formatPrProofComment({
        tagResults: [
          makeTag({ counts: { total: 3, passed: 2, failed: 1 } }),
          makeTag({ counts: { total: 4, passed: 4, failed: 0 } }),
        ],
        uploaded: [],
        r2Configured: true,
      });
      expect(result).toContain('6 passed, 1 failed');
    });
  });
});
