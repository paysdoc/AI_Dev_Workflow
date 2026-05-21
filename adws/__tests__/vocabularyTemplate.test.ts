import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.resolve(__dirname, '../../templates/vocabulary.md.template');

describe('templates/vocabulary.md.template', () => {
  let content: string;

  it('exists at the framework repo root', () => {
    expect(fs.existsSync(TEMPLATE_PATH)).toBe(true);
    content = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  });

  it('contains the ## Rot-Detection Rubric section heading', () => {
    content = content ?? fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    expect(content).toContain('## Rot-Detection Rubric');
  });

  it('contains the ## Observability Surfaces (Examples) section heading', () => {
    content = content ?? fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    expect(content).toContain('## Observability Surfaces (Examples)');
  });

  it('contains the ## Three Permitted Execution Patterns section heading', () => {
    content = content ?? fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    expect(content).toContain('## Three Permitted Execution Patterns');
  });

  it('rubric section contains the File shape forbidden-pattern bullet', () => {
    content = content ?? fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    expect(content).toContain('File shape');
  });

  it('rubric section contains the File content via substring match forbidden-pattern bullet', () => {
    content = content ?? fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    expect(content).toContain('File content via substring match');
  });

  it('rubric section contains the Structural source-file assertions forbidden-pattern bullet', () => {
    content = content ?? fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    expect(content).toContain('Structural source-file assertions');
  });
});
