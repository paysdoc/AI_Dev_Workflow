import { describe, it, expect } from 'vitest';
import {
  SLASH_COMMAND_MODEL_MAP,
  SLASH_COMMAND_MODEL_MAP_FAST,
  SLASH_COMMAND_EFFORT_MAP,
  SLASH_COMMAND_EFFORT_MAP_FAST,
  getModelForCommand,
  getEffortForCommand,
} from '../modelRouting';
import type { SlashCommand } from '../../types/issueTypes';

type ModelTable = Record<SlashCommand, string>;
type EffortTable = Record<SlashCommand, string | undefined>;

function haikuCommandsWithEffort(models: ModelTable, efforts: EffortTable): string[] {
  return (Object.keys(models) as SlashCommand[])
    .filter((command) => models[command] === 'haiku' && efforts[command] !== undefined)
    .map((command) => `${command} -> ${efforts[command]}`);
}

describe('routing tables', () => {
  it('give no Haiku entry an effort, in the default pair or the fast pair', () => {
    expect({
      default: haikuCommandsWithEffort(SLASH_COMMAND_MODEL_MAP, SLASH_COMMAND_EFFORT_MAP),
      fast: haikuCommandsWithEffort(SLASH_COMMAND_MODEL_MAP_FAST, SLASH_COMMAND_EFFORT_MAP_FAST),
    }).toEqual({ default: [], fast: [] });
  });

  it('route /promote_regression_vocabulary to Haiku with no effort when the issue asks for /fast', () => {
    const body = 'Tighten the rot advisory. /fast';

    expect(getModelForCommand('/promote_regression_vocabulary', body)).toBe('haiku');
    expect(getEffortForCommand('/promote_regression_vocabulary', body)).toBeUndefined();
  });

  it.each([
    ['default', undefined],
    ['fast', 'Merge sooner. /cheap'],
  ])('route /resolve_conflict and /correct_output to a model in %s mode', (_mode, body) => {
    expect(getModelForCommand('/resolve_conflict', body)).toBeDefined();
    expect(getModelForCommand('/correct_output', body)).toBeDefined();
  });

  it.each([
    ['default', undefined],
    ['fast', 'Merge sooner. /cheap'],
  ])('give /correct_output no effort in %s mode', (_mode, body) => {
    expect(getEffortForCommand('/correct_output', body)).toBeUndefined();
  });
});
