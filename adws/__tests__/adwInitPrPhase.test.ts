import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const adwInitSource = fs.readFileSync(
  path.resolve(__dirname, '../adwInit.tsx'),
  'utf-8',
);

describe('adwInit PR phase integration', () => {
  it('imports executePRPhase from workflowPhases', () => {
    expect(adwInitSource).toMatch(/import\s*\{[^}]*executePRPhase[^}]*\}\s*from\s*['"]\.\/workflowPhases['"]/s);
  });

  it('calls executePRPhase(config) after commitChanges', () => {
    const commitIdx = adwInitSource.indexOf('commitChanges(');
    const prCallIdx = adwInitSource.indexOf('executePRPhase(config)');
    expect(commitIdx).toBeGreaterThan(-1);
    expect(prCallIdx).toBeGreaterThan(-1);
    expect(prCallIdx).toBeGreaterThan(commitIdx);
  });

  it('calls executePRPhase(config) before completeWorkflow', () => {
    const prCallIdx = adwInitSource.indexOf('executePRPhase(config)');
    const completeIdx = adwInitSource.indexOf('completeWorkflow(');
    expect(prCallIdx).toBeGreaterThan(-1);
    expect(completeIdx).toBeGreaterThan(-1);
    expect(prCallIdx).toBeLessThan(completeIdx);
  });

  it('accumulates PR phase cost into totalCostUsd', () => {
    expect(adwInitSource).toContain('totalCostUsd += prResult.costUsd');
  });

  it('merges PR phase model usage into totalModelUsage', () => {
    expect(adwInitSource).toMatch(/mergeModelUsageMaps\(totalModelUsage,\s*prResult\.modelUsage\)/);
  });
});
