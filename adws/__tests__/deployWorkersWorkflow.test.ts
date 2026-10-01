import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Contract guard: the Worker deploy workflow must decide what to deploy from the push itself.
 * Without `base`, the paths filter compares the pushed branch with the default branch, which is
 * the merge base of every release merge, so nothing is ever found changed. A trigger-level
 * `paths` filter is matched by GitHub against at most 300 changed files of a push, which a
 * release often exceeds, so it would skip the whole workflow without a message.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github/workflows/deploy-workers.yml');
const WORKFLOW_FILE = '.github/workflows/deploy-workers.yml';

const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
const trigger = workflow.slice(0, workflow.indexOf('jobs:'));
const jobs = workflow.slice(workflow.indexOf('jobs:')).split(/^ {2}(?=[\w-]+:\n)/m).slice(1);

const workers = fs
  .readdirSync(path.join(REPO_ROOT, 'workers'), { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name);

describe('deploy-workers.yml change detection', () => {
  it('pins the base of the paths filter to the pushed branch', () => {
    expect(workflow).toContain('uses: dorny/paths-filter@v3');
    expect(workflow).toContain('base: ${{ github.ref }}');
  });

  it('triggers on pushes to main and leaves the change detection to the changes job', () => {
    expect(trigger).toContain('- main');
    expect(trigger).not.toContain('paths:');
  });

  it('has a Worker to deploy', () => {
    expect(workers.length).toBeGreaterThan(0);
  });

  describe.each(workers)('Worker %s', name => {
    it('is exposed as an output of the changes job', () => {
      expect(workflow).toContain(`${name}: \${{ steps.filter.outputs.${name} }}`);
    });

    it('is deployed when its own directory or the deploy workflow changes', () => {
      const filter = new RegExp(`${name}:\\s+- 'workers/${name}/\\*\\*'\\s+- '${WORKFLOW_FILE.replace(/[./]/g, '\\$&')}'`);
      expect(workflow).toMatch(filter);
    });

    it('has a deploy job that runs for its output and deploys from its own directory', () => {
      const deployJob = jobs.find(job => job.includes(`if: needs.changes.outputs.${name} == 'true'`));
      expect(deployJob).toBeDefined();
      expect(deployJob).toContain(`workingDirectory: workers/${name}`);
    });
  });
});
