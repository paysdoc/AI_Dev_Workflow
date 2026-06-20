import { describe, it, expect } from 'vitest';
import { nextResumeAction, MAX_RESUME_ATTEMPTS } from '../resumePolicy';

describe('nextResumeAction — boundary cases', () => {
  describe('below the bound → resume', () => {
    it('returns resume for attempts=0, max=3', () => {
      expect(nextResumeAction(0, 3)).toBe('resume');
    });

    it('returns resume for attempts=1, max=3', () => {
      expect(nextResumeAction(1, 3)).toBe('resume');
    });

    it('returns resume for attempts=2, max=3', () => {
      expect(nextResumeAction(2, 3)).toBe('resume');
    });

    it('returns resume for attempts=0, max=1', () => {
      expect(nextResumeAction(0, 1)).toBe('resume');
    });
  });

  describe('at the bound → escalate', () => {
    it('returns escalate for attempts=3, max=3', () => {
      expect(nextResumeAction(3, 3)).toBe('escalate');
    });

    it('returns escalate for attempts=1, max=1', () => {
      expect(nextResumeAction(1, 1)).toBe('escalate');
    });
  });

  describe('above the bound → escalate (defensive)', () => {
    it('returns escalate for attempts=4, max=3', () => {
      expect(nextResumeAction(4, 3)).toBe('escalate');
    });

    it('returns escalate for attempts=5, max=0', () => {
      expect(nextResumeAction(5, 0)).toBe('escalate');
    });
  });

  describe('degenerate caps', () => {
    it('returns escalate for max=0 (no resume ever permitted)', () => {
      expect(nextResumeAction(0, 0)).toBe('escalate');
    });
  });

  describe('default-param wiring', () => {
    it('returns resume for MAX_RESUME_ATTEMPTS - 1 (one below cap)', () => {
      expect(nextResumeAction(MAX_RESUME_ATTEMPTS - 1)).toBe('resume');
    });

    it('returns escalate for MAX_RESUME_ATTEMPTS (exactly at cap)', () => {
      expect(nextResumeAction(MAX_RESUME_ATTEMPTS)).toBe('escalate');
    });
  });
});
