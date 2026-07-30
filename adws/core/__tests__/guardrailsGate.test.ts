import { describe, it, expect, vi } from 'vitest';
import { resolveGuardrailsDecision, type GuardrailsGateDeps } from '../guardrailsGate';
import type { AdwYmlConfig } from '../adwYmlConfig';
import type { ProbeVerdict } from '../guardrailsProbe';

const BASE_INPUT = { selfHost: false, worktreePath: '/worktrees/target-repo', adwId: 'adw-test-123' };

function makeAdwYmlConfig(overrides: Partial<AdwYmlConfig> = {}): AdwYmlConfig {
  return { hitl: false, unitTests: true, guardrails: false, ...overrides };
}

function makeDeps(overrides: Partial<GuardrailsGateDeps> = {}): { deps: GuardrailsGateDeps; notifyCalls: string[] } {
  const notifyCalls: string[] = [];
  const deps: GuardrailsGateDeps = {
    probeGuardrails: vi.fn(async (): Promise<ProbeVerdict> => ({ ok: true })),
    notifySlack: vi.fn(async (text: string) => { notifyCalls.push(text); }),
    readAdwYml: vi.fn(() => makeAdwYmlConfig({ guardrails: true })),
    getEnv: vi.fn(() => undefined),
    ...overrides,
  };
  return { deps, notifyCalls };
}

describe('resolveGuardrailsDecision', () => {
  it('withholds injection when the kill switch is set to off', async () => {
    const { deps } = makeDeps({ getEnv: () => 'off' });
    const decision = await resolveGuardrailsDecision(BASE_INPUT, deps);
    expect(decision).toEqual({ inject: false });
  });

  it('kill switch beats an enabled adw.yml gate (both set → no injection)', async () => {
    const { deps } = makeDeps({
      getEnv: (name) => (name === 'ADW_TARGET_GUARDRAILS' ? 'off' : undefined),
      readAdwYml: () => makeAdwYmlConfig({ guardrails: true }),
    });
    const decision = await resolveGuardrailsDecision(BASE_INPUT, deps);
    expect(decision).toEqual({ inject: false });
  });

  it('withholds injection for a self-host run even when adw.yml enables guardrails', async () => {
    const { deps } = makeDeps({ readAdwYml: () => makeAdwYmlConfig({ guardrails: true }) });
    const decision = await resolveGuardrailsDecision({ ...BASE_INPUT, selfHost: true }, deps);
    expect(decision).toEqual({ inject: false });
  });

  it('withholds injection when adw.yml guardrails is false', async () => {
    const { deps } = makeDeps({ readAdwYml: () => makeAdwYmlConfig({ guardrails: false }) });
    const decision = await resolveGuardrailsDecision(BASE_INPUT, deps);
    expect(decision).toEqual({ inject: false });
  });

  it('withholds injection when adw.yml omits the guardrails key (default config)', async () => {
    const { deps } = makeDeps({ readAdwYml: () => makeAdwYmlConfig() });
    const decision = await resolveGuardrailsDecision(BASE_INPUT, deps);
    expect(decision).toEqual({ inject: false });
  });

  it('withholds injection and alerts once when the probe fails', async () => {
    const { deps, notifyCalls } = makeDeps({
      readAdwYml: () => makeAdwYmlConfig({ guardrails: true }),
      probeGuardrails: async () => ({ ok: false, detail: 'deny matrix mismatch' }),
    });
    const decision = await resolveGuardrailsDecision(BASE_INPUT, deps);
    expect(decision).toEqual({ inject: false });
    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0]).toContain('deny matrix mismatch');
  });

  it('AWAITS the Slack alert before resolving (async ordering)', async () => {
    let alertResolved = false;
    const { deps } = makeDeps({
      readAdwYml: () => makeAdwYmlConfig({ guardrails: true }),
      probeGuardrails: async () => ({ ok: false }),
      notifySlack: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        alertResolved = true;
      },
    });
    await resolveGuardrailsDecision(BASE_INPUT, deps);
    expect(alertResolved).toBe(true);
  });

  it('injects with a built payload and raises no alert when the probe passes', async () => {
    const { deps, notifyCalls } = makeDeps({
      readAdwYml: () => makeAdwYmlConfig({ guardrails: true }),
      probeGuardrails: async () => ({ ok: true }),
    });
    const decision = await resolveGuardrailsDecision(BASE_INPUT, deps);
    expect(decision.inject).toBe(true);
    if (!decision.inject) throw new Error('expected inject: true');
    expect(() => JSON.parse(decision.settingsJson)).not.toThrow();
    const parsed = JSON.parse(decision.settingsJson);
    expect(Array.isArray(parsed.permissions.deny)).toBe(true);
    expect(parsed.permissions.deny.length).toBeGreaterThan(0);
    expect(decision.hookLogDir).toContain(BASE_INPUT.adwId);
    expect(notifyCalls).toHaveLength(0);
  });

  it('never calls the probe for a self-host run (short-circuits before the probe check)', async () => {
    const probeGuardrails = vi.fn(async (): Promise<ProbeVerdict> => ({ ok: true }));
    const { deps } = makeDeps({ probeGuardrails, readAdwYml: () => makeAdwYmlConfig({ guardrails: true }) });
    await resolveGuardrailsDecision({ ...BASE_INPUT, selfHost: true }, deps);
    expect(probeGuardrails).not.toHaveBeenCalled();
  });
});
