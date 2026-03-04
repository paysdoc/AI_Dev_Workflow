import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { validateWebhookSignature } from '../triggers/webhookSignature';

function sign(body: Buffer, secret: string): string {
  const hmac = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${hmac}`;
}

describe('validateWebhookSignature', () => {
  const secret = 'test-secret-key';
  const body = Buffer.from('{"action":"opened","issue":{"number":1}}');

  it('accepts a valid signature', () => {
    const signature = sign(body, secret);
    const result = validateWebhookSignature(body, secret, signature);
    expect(result).toEqual({ valid: true });
  });

  it('rejects when header is undefined', () => {
    const result = validateWebhookSignature(body, secret, undefined);
    expect(result).toEqual({ valid: false, error: 'Missing signature header' });
  });

  it('rejects when header is empty string', () => {
    const result = validateWebhookSignature(body, secret, '');
    expect(result).toEqual({ valid: false, error: 'Missing signature header' });
  });

  it('rejects when secret is wrong', () => {
    const signature = sign(body, 'wrong-secret');
    const result = validateWebhookSignature(body, secret, signature);
    expect(result.valid).toBe(false);
  });

  it('rejects when payload is tampered', () => {
    const signature = sign(body, secret);
    const tampered = Buffer.from('{"action":"opened","issue":{"number":2}}');
    const result = validateWebhookSignature(tampered, secret, signature);
    expect(result.valid).toBe(false);
  });

  it('rejects when signature has wrong length', () => {
    const result = validateWebhookSignature(body, secret, 'sha256=abcdef');
    expect(result.valid).toBe(false);
  });

  it('rejects when signature is missing sha256= prefix', () => {
    const hmac = createHmac('sha256', secret).update(body).digest('hex');
    const result = validateWebhookSignature(body, secret, hmac);
    expect(result).toEqual({ valid: false, error: 'Malformed signature: missing sha256= prefix' });
  });
});
