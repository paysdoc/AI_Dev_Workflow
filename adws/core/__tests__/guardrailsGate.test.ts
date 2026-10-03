import { describe, it, expect, vi } from 'vitest';
import { resolveGuardrailsDecision, type GuardrailsGateDeps } from '../guardrailsGate';
import type { ProbeVerdict } from '../guardrailsProbe';

const BASE_INPUT = { selfHost: false, adwId: 'adw-test-123' };

function makeDeps(overrides: Partial<GuardrailsGateDeps> = {}): { deps: GuardrailsGateDeps; notifyCalls: string[] } {
  const notifyCalls: string[] = [];
  const deps: GuardrailsGateDeps = {
    probeGuardrails: vi.fn(async (): Promise<ProbeVerdict> => ({ ok: true })),
    notifySlack: vi.fn(async (text: string) => { notifyCalls.push(text); }),
    getEnv: vi.fn(() => undefined),
    ...overrides,
  };
  return { deps, notifyCalls };
}

describe('resolveGuardrailsDecision', () => {
  it('withholds injection and never runs the probe when the kill switch is set to off', async () => {
    const probeGuardrails = vi.fn(async (): Promise<ProbeVerdict> => ({ ok: true }));
    const { deps } = makeDeps({
      probeGuardrails,
      getEnv: (name) => (name === 'ADW_TARGET_GUARDRAILS' ? 'off' : undefined),
    });
    const decision = await resolveGuardrailsDecision(BASE_INPUT, deps);
    expect(decision).toEqual({ inject: false });
    expect(probeGuardrails).not.toHaveBeenCalled();
  });

  it('withholds injection and never runs the probe for a self-host run', async () => {
    const probeGuardrails = vi.fn(async (): Promise<ProbeVerdict> => ({ ok: true }));
    const { deps } = makeDeps({ probeGuardrails });
    const decision = await resolveGuardrailsDecision({ ...BASE_INPUT, selfHost: true }, deps);
    expect(decision).toEqual({ inject: false });
    expect(probeGuardrails).not.toHaveBeenCalled();
  });

  it('withholds injection and alerts once when the probe fails', async () => {
    const { deps, notifyCalls } = makeDeps({
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
    const { deps, notifyCalls } = makeDeps({ probeGuardrails: async () => ({ ok: true }) });
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

  it('injects for a target-repo agent with no repository configuration consulted', async () => {
    const deps: GuardrailsGateDeps = {
      probeGuardrails: async () => ({ ok: true }),
      notifySlack: async () => undefined,
      getEnv: () => undefined,
    };
    const decision = await resolveGuardrailsDecision({ selfHost: false, adwId: 'adw-no-config' }, deps);
    expect(decision.inject).toBe(true);
  });
});
