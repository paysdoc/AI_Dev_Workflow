import { describe, it, expect } from 'vitest';
import { listOpenIssuesCmd } from '../issueCommands';

describe('listOpenIssuesCmd', () => {
  it('defaults to --state open when no state option is supplied', () => {
    const cmd = listOpenIssuesCmd('o', 'r', { fields: ['number'] });
    expect(cmd).toContain('--state open');
  });

  it('emits --state all when state: "all" is supplied', () => {
    const cmd = listOpenIssuesCmd('o', 'r', { fields: ['number'], state: 'all' });
    expect(cmd).toContain('--state all');
  });

  it('emits --state closed when state: "closed" is supplied', () => {
    const cmd = listOpenIssuesCmd('o', 'r', { fields: ['number'], state: 'closed' });
    expect(cmd).toContain('--state closed');
  });

  it('still renders --search and --limit when supplied alongside state', () => {
    const cmd = listOpenIssuesCmd('o', 'r', { fields: ['number'], state: 'all', search: 'regression-promotion', limit: 200 });
    expect(cmd).toContain('--search "regression-promotion"');
    expect(cmd).toContain('--limit 200');
  });
});
