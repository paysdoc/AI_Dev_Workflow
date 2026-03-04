import { createHmac, timingSafeEqual } from 'node:crypto';

interface SignatureValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates a GitHub webhook HMAC-SHA256 signature against the raw request body.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function validateWebhookSignature(
  rawBody: Buffer,
  secret: string,
  signatureHeader: string | undefined,
): SignatureValidationResult {
  if (!signatureHeader) {
    return { valid: false, error: 'Missing signature header' };
  }

  if (!signatureHeader.startsWith('sha256=')) {
    return { valid: false, error: 'Malformed signature: missing sha256= prefix' };
  }

  const expectedHmac = createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedSignature = `sha256=${expectedHmac}`;

  const sigBuffer = Buffer.from(signatureHeader);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expectedBuffer.length) {
    return { valid: false, error: 'Signature length mismatch' };
  }

  const match = timingSafeEqual(sigBuffer, expectedBuffer);
  return match ? { valid: true } : { valid: false, error: 'Signature mismatch' };
}
