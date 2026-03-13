import { describe, it, expect } from 'vitest';
import {
  SLASH_COMMAND_MODEL_MAP,
  SLASH_COMMAND_MODEL_MAP_FAST,
  SLASH_COMMAND_EFFORT_MAP,
  SLASH_COMMAND_EFFORT_MAP_FAST,
  isFastMode,
  getModelForCommand,
  getEffortForCommand,
} from '../config';

describe('SLASH_COMMAND_MODEL_MAP', () => {
  it('has correct default values for all 18 commands', () => {
    expect(SLASH_COMMAND_MODEL_MAP['/classify_issue']).toBe('sonnet');
    expect(SLASH_COMMAND_MODEL_MAP['/feature']).toBe('opus');
    expect(SLASH_COMMAND_MODEL_MAP['/bug']).toBe('opus');
    expect(SLASH_COMMAND_MODEL_MAP['/chore']).toBe('opus');
    expect(SLASH_COMMAND_MODEL_MAP['/pr_review']).toBe('opus');
    expect(SLASH_COMMAND_MODEL_MAP['/implement']).toBe('sonnet');
    expect(SLASH_COMMAND_MODEL_MAP['/patch']).toBe('opus');
    expect(SLASH_COMMAND_MODEL_MAP['/review']).toBe('opus');
    expect(SLASH_COMMAND_MODEL_MAP['/test']).toBe('haiku');
    expect(SLASH_COMMAND_MODEL_MAP['/resolve_failed_test']).toBe('opus');
    expect(SLASH_COMMAND_MODEL_MAP['/resolve_failed_e2e_test']).toBe('opus');
    expect(SLASH_COMMAND_MODEL_MAP['/generate_branch_name']).toBe('sonnet');
    expect(SLASH_COMMAND_MODEL_MAP['/commit']).toBe('sonnet');
    expect(SLASH_COMMAND_MODEL_MAP['/commit_cost']).toBe('haiku');
    expect(SLASH_COMMAND_MODEL_MAP['/track_agentic_kpis']).toBe('haiku');
    expect(SLASH_COMMAND_MODEL_MAP['/pull_request']).toBe('sonnet');
    expect(SLASH_COMMAND_MODEL_MAP['/document']).toBe('sonnet');
    expect(SLASH_COMMAND_MODEL_MAP['/find_plan_file']).toBe('sonnet');
    expect(SLASH_COMMAND_MODEL_MAP['/adw_init']).toBe('sonnet');
  });

  it('has exactly 22 entries', () => {
    expect(Object.keys(SLASH_COMMAND_MODEL_MAP)).toHaveLength(22);
  });
});

describe('SLASH_COMMAND_MODEL_MAP_FAST', () => {
  it('has correct fast/cheap values for all 18 commands', () => {
    expect(SLASH_COMMAND_MODEL_MAP_FAST['/classify_issue']).toBe('haiku');
    expect(SLASH_COMMAND_MODEL_MAP_FAST['/feature']).toBe('opus');
    expect(SLASH_COMMAND_MODEL_MAP_FAST['/bug']).toBe('opus');
    expect(SLASH_COMMAND_MODEL_MAP_FAST['/chore']).toBe('opus');
    expect(SLASH_COMMAND_MODEL_MAP_FAST['/pr_review']).toBe('opus');
    expect(SLASH_COMMAND_MODEL_MAP_FAST['/implement']).toBe('sonnet');
    expect(SLASH_COMMAND_MODEL_MAP_FAST['/patch']).toBe('opus');
    expect(SLASH_COMMAND_MODEL_MAP_FAST['/review']).toBe('sonnet');
    expect(SLASH_COMMAND_MODEL_MAP_FAST['/test']).toBe('haiku');
    expect(SLASH_COMMAND_MODEL_MAP_FAST['/resolve_failed_test']).toBe('opus');
    expect(SLASH_COMMAND_MODEL_MAP_FAST['/resolve_failed_e2e_test']).toBe('opus');
    expect(SLASH_COMMAND_MODEL_MAP_FAST['/generate_branch_name']).toBe('haiku');
    expect(SLASH_COMMAND_MODEL_MAP_FAST['/commit']).toBe('haiku');
    expect(SLASH_COMMAND_MODEL_MAP_FAST['/commit_cost']).toBe('haiku');
    expect(SLASH_COMMAND_MODEL_MAP_FAST['/track_agentic_kpis']).toBe('haiku');
    expect(SLASH_COMMAND_MODEL_MAP_FAST['/pull_request']).toBe('haiku');
    expect(SLASH_COMMAND_MODEL_MAP_FAST['/document']).toBe('sonnet');
    expect(SLASH_COMMAND_MODEL_MAP_FAST['/find_plan_file']).toBe('haiku');
    expect(SLASH_COMMAND_MODEL_MAP_FAST['/adw_init']).toBe('haiku');
  });

  it('has exactly 22 entries', () => {
    expect(Object.keys(SLASH_COMMAND_MODEL_MAP_FAST)).toHaveLength(22);
  });
});

describe('isFastMode', () => {
  it('returns false for undefined input', () => {
    expect(isFastMode(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isFastMode('')).toBe(false);
  });

  it('returns false for body without keywords', () => {
    expect(isFastMode('This is a normal issue body')).toBe(false);
  });

  it('returns true for body containing /fast', () => {
    expect(isFastMode('/fast')).toBe(true);
  });

  it('returns true for body containing /cheap', () => {
    expect(isFastMode('/cheap')).toBe(true);
  });

  it('returns true for body containing both /fast and /cheap', () => {
    expect(isFastMode('Use /fast and /cheap modes')).toBe(true);
  });

  it('returns true when keywords appear mid-sentence', () => {
    expect(isFastMode('Please use /fast mode')).toBe(true);
    expect(isFastMode('Please use /cheap mode')).toBe(true);
  });

  it('returns false for partial matches like /faster', () => {
    expect(isFastMode('/faster')).toBe(false);
  });

  it('returns false for partial matches like /cheapest', () => {
    expect(isFastMode('/cheapest')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isFastMode('/FAST')).toBe(true);
    expect(isFastMode('/Cheap')).toBe(true);
  });
});

describe('getModelForCommand', () => {
  it('returns default map value when no issue body provided', () => {
    expect(getModelForCommand('/implement')).toBe('sonnet');
    expect(getModelForCommand('/classify_issue')).toBe('sonnet');
    expect(getModelForCommand('/test')).toBe('haiku');
  });

  it('returns default map value when body has no keywords', () => {
    expect(getModelForCommand('/implement', 'A regular issue body')).toBe('sonnet');
    expect(getModelForCommand('/commit', 'No special keywords here')).toBe('sonnet');
  });

  it('returns fast map value when body contains /fast', () => {
    const body = 'Please implement this /fast';
    expect(getModelForCommand('/implement', body)).toBe('sonnet');
    expect(getModelForCommand('/review', body)).toBe('sonnet');
    expect(getModelForCommand('/commit', body)).toBe('haiku');
  });

  it('returns fast map value when body contains /cheap', () => {
    const body = 'Use /cheap mode for this issue';
    expect(getModelForCommand('/implement', body)).toBe('sonnet');
    expect(getModelForCommand('/pull_request', body)).toBe('haiku');
    expect(getModelForCommand('/generate_branch_name', body)).toBe('haiku');
  });

  describe('commands that differ between default and fast maps', () => {
    const fastBody = '/fast';

    it('/classify_issue: sonnet -> haiku', () => {
      expect(getModelForCommand('/classify_issue')).toBe('sonnet');
      expect(getModelForCommand('/classify_issue', fastBody)).toBe('haiku');
    });

    it('/review: opus -> sonnet', () => {
      expect(getModelForCommand('/review')).toBe('opus');
      expect(getModelForCommand('/review', fastBody)).toBe('sonnet');
    });

    it('/generate_branch_name: sonnet -> haiku', () => {
      expect(getModelForCommand('/generate_branch_name')).toBe('sonnet');
      expect(getModelForCommand('/generate_branch_name', fastBody)).toBe('haiku');
    });

    it('/commit: sonnet -> haiku', () => {
      expect(getModelForCommand('/commit')).toBe('sonnet');
      expect(getModelForCommand('/commit', fastBody)).toBe('haiku');
    });

    it('/pull_request: sonnet -> haiku', () => {
      expect(getModelForCommand('/pull_request')).toBe('sonnet');
      expect(getModelForCommand('/pull_request', fastBody)).toBe('haiku');
    });

    it('/find_plan_file: sonnet -> haiku', () => {
      expect(getModelForCommand('/find_plan_file')).toBe('sonnet');
      expect(getModelForCommand('/find_plan_file', fastBody)).toBe('haiku');
    });

    it('/adw_init: sonnet -> haiku', () => {
      expect(getModelForCommand('/adw_init')).toBe('sonnet');
      expect(getModelForCommand('/adw_init', fastBody)).toBe('haiku');
    });
  });

  describe('commands that stay the same in both maps', () => {
    const fastBody = '/fast';

    it('/feature stays opus', () => {
      expect(getModelForCommand('/feature')).toBe('opus');
      expect(getModelForCommand('/feature', fastBody)).toBe('opus');
    });

    it('/patch stays opus', () => {
      expect(getModelForCommand('/patch')).toBe('opus');
      expect(getModelForCommand('/patch', fastBody)).toBe('opus');
    });

    it('/test stays haiku', () => {
      expect(getModelForCommand('/test')).toBe('haiku');
      expect(getModelForCommand('/test', fastBody)).toBe('haiku');
    });

    it('/implement stays sonnet', () => {
      expect(getModelForCommand('/implement')).toBe('sonnet');
      expect(getModelForCommand('/implement', fastBody)).toBe('sonnet');
    });

    it('/document stays sonnet', () => {
      expect(getModelForCommand('/document')).toBe('sonnet');
      expect(getModelForCommand('/document', fastBody)).toBe('sonnet');
    });
  });
});

describe('SLASH_COMMAND_EFFORT_MAP', () => {
  it('has correct default effort values for all 18 commands', () => {
    expect(SLASH_COMMAND_EFFORT_MAP['/classify_issue']).toBe('low');
    expect(SLASH_COMMAND_EFFORT_MAP['/feature']).toBe('high');
    expect(SLASH_COMMAND_EFFORT_MAP['/bug']).toBe('high');
    expect(SLASH_COMMAND_EFFORT_MAP['/chore']).toBe('high');
    expect(SLASH_COMMAND_EFFORT_MAP['/pr_review']).toBe('high');
    expect(SLASH_COMMAND_EFFORT_MAP['/implement']).toBe('high');
    expect(SLASH_COMMAND_EFFORT_MAP['/patch']).toBe('high');
    expect(SLASH_COMMAND_EFFORT_MAP['/review']).toBe('high');
    expect(SLASH_COMMAND_EFFORT_MAP['/test']).toBeUndefined();
    expect(SLASH_COMMAND_EFFORT_MAP['/resolve_failed_test']).toBe('high');
    expect(SLASH_COMMAND_EFFORT_MAP['/resolve_failed_e2e_test']).toBe('high');
    expect(SLASH_COMMAND_EFFORT_MAP['/generate_branch_name']).toBe('low');
    expect(SLASH_COMMAND_EFFORT_MAP['/commit']).toBe('medium');
    expect(SLASH_COMMAND_EFFORT_MAP['/pull_request']).toBe('medium');
    expect(SLASH_COMMAND_EFFORT_MAP['/document']).toBe('medium');
    expect(SLASH_COMMAND_EFFORT_MAP['/commit_cost']).toBeUndefined();
    expect(SLASH_COMMAND_EFFORT_MAP['/track_agentic_kpis']).toBe('medium');
    expect(SLASH_COMMAND_EFFORT_MAP['/find_plan_file']).toBe('low');
    expect(SLASH_COMMAND_EFFORT_MAP['/adw_init']).toBe('medium');
  });

  it('has exactly 22 entries', () => {
    expect(Object.keys(SLASH_COMMAND_EFFORT_MAP)).toHaveLength(22);
  });
});

describe('SLASH_COMMAND_EFFORT_MAP_FAST', () => {
  it('has correct fast effort values for all 18 commands', () => {
    expect(SLASH_COMMAND_EFFORT_MAP_FAST['/classify_issue']).toBe('low');
    expect(SLASH_COMMAND_EFFORT_MAP_FAST['/feature']).toBe('high');
    expect(SLASH_COMMAND_EFFORT_MAP_FAST['/bug']).toBe('high');
    expect(SLASH_COMMAND_EFFORT_MAP_FAST['/chore']).toBe('high');
    expect(SLASH_COMMAND_EFFORT_MAP_FAST['/pr_review']).toBe('high');
    expect(SLASH_COMMAND_EFFORT_MAP_FAST['/implement']).toBe('high');
    expect(SLASH_COMMAND_EFFORT_MAP_FAST['/patch']).toBe('high');
    expect(SLASH_COMMAND_EFFORT_MAP_FAST['/review']).toBe('high');
    expect(SLASH_COMMAND_EFFORT_MAP_FAST['/test']).toBeUndefined();
    expect(SLASH_COMMAND_EFFORT_MAP_FAST['/resolve_failed_test']).toBe('medium');
    expect(SLASH_COMMAND_EFFORT_MAP_FAST['/resolve_failed_e2e_test']).toBe('medium');
    expect(SLASH_COMMAND_EFFORT_MAP_FAST['/generate_branch_name']).toBe('low');
    expect(SLASH_COMMAND_EFFORT_MAP_FAST['/commit']).toBe('low');
    expect(SLASH_COMMAND_EFFORT_MAP_FAST['/pull_request']).toBe('medium');
    expect(SLASH_COMMAND_EFFORT_MAP_FAST['/document']).toBe('medium');
    expect(SLASH_COMMAND_EFFORT_MAP_FAST['/commit_cost']).toBeUndefined();
    expect(SLASH_COMMAND_EFFORT_MAP_FAST['/track_agentic_kpis']).toBe('low');
    expect(SLASH_COMMAND_EFFORT_MAP_FAST['/find_plan_file']).toBe('low');
    expect(SLASH_COMMAND_EFFORT_MAP_FAST['/adw_init']).toBe('medium');
  });

  it('has exactly 22 entries', () => {
    expect(Object.keys(SLASH_COMMAND_EFFORT_MAP_FAST)).toHaveLength(22);
  });
});

describe('getEffortForCommand', () => {
  it('returns default effort when no issue body provided', () => {
    expect(getEffortForCommand('/implement')).toBe('high');
    expect(getEffortForCommand('/classify_issue')).toBe('low');
    expect(getEffortForCommand('/test')).toBeUndefined();
  });

  it('returns default effort when body has no keywords', () => {
    expect(getEffortForCommand('/implement', 'A regular issue body')).toBe('high');
    expect(getEffortForCommand('/commit', 'No special keywords here')).toBe('medium');
  });

  it('returns fast effort when body contains /fast', () => {
    const body = 'Please implement this /fast';
    expect(getEffortForCommand('/implement', body)).toBe('high');
    expect(getEffortForCommand('/commit', body)).toBe('low');
    expect(getEffortForCommand('/feature', body)).toBe('high');
  });

  it('returns fast effort when body contains /cheap', () => {
    const body = 'Use /cheap mode for this issue';
    expect(getEffortForCommand('/implement', body)).toBe('high');
    expect(getEffortForCommand('/pull_request', body)).toBe('medium');
    expect(getEffortForCommand('/document', body)).toBe('medium');
  });

  it('returns undefined for haiku commands (/test, /commit_cost)', () => {
    expect(getEffortForCommand('/test')).toBeUndefined();
    expect(getEffortForCommand('/commit_cost')).toBeUndefined();
    expect(getEffortForCommand('/test', '/fast')).toBeUndefined();
    expect(getEffortForCommand('/commit_cost', '/fast')).toBeUndefined();
  });
});
