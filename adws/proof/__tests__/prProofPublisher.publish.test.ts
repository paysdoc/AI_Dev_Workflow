import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Platform } from '@paysdoc/devplatform';

const configuredEnvironment = vi.hoisted(() => ({
  CLOUDFLARE_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
}));

vi.mock('../../core/environment', () => configuredEnvironment);
vi.mock('../../core/logger', () => ({ log: vi.fn() }));
vi.mock('../../r2/uploadService', () => ({ uploadToR2: vi.fn() }));

import { publishPrProof } from '../prProofPublisher';
import { setProofUploaderForTesting } from '../proofUploader';
import { ADW_SIGNATURE } from '../../core/workflowCommentParsing';
import type { PerIssueImage, ScenarioProofResult, UploaderFn } from '../types';

const repoInfo = { owner: 'acme', repo: 'widgets', platform: Platform.GitHub } as const;
const adwId = 'adw-994';

let artifactsDir: string;

function writeImage(relPath: string, scenario: string): PerIssueImage {
  const absPath = path.join(artifactsDir, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `bytes of ${relPath}`);
  return { absPath, relPath, scenario };
}

function proofWith(perIssueImages: readonly PerIssueImage[]): ScenarioProofResult {
  return {
    tagResults: [
      { tag: '@regression', resolvedTag: '@regression', severity: 'blocker', optional: false, passed: true, output: '', exitCode: 0, skipped: false, counts: { total: 3, passed: 3, failed: 0 } },
      { tag: '@adw-{issueNumber}', resolvedTag: '@adw-994', severity: 'blocker', optional: true, passed: true, output: '', exitCode: 0, skipped: false, counts: { total: 2, passed: 2, failed: 0 } },
    ],
    hasBlockerFailures: false,
    perIssueImages,
    resultsFilePath: path.join(artifactsDir, '..', 'scenario_proof.md'),
    artifactsDir,
  };
}

function recordingUploader(): { uploader: UploaderFn; calls: Parameters<UploaderFn>[0][] } {
  const calls: Parameters<UploaderFn>[0][] = [];
  const uploader: UploaderFn = async (options) => {
    calls.push(options);
    return { url: `https://fake/${options.key}`, bucket: `${options.owner}-${options.repo}`, key: options.key };
  };
  return { uploader, calls };
}

function recordingCommenter(): { commenter: (prNumber: number, body: string) => void; comments: { prNumber: number; body: string }[] } {
  const comments: { prNumber: number; body: string }[] = [];
  return { commenter: (prNumber, body) => { comments.push({ prNumber, body }); }, comments };
}

function embeddedUrls(body: string): string[] {
  return [...body.matchAll(/!\[[^\]]*\]\(([^)]*)\)/g)].map(match => match[1]);
}

let selected: PerIssueImage[];

beforeEach(() => {
  artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-proof-publisher-'));
  selected = [
    writeImage('adw-994/cart-total/test-finished-1.png', 'Cart › The cart shows the total'),
    writeImage('adw-994/checkout/test-finished-1.png', 'Checkout › The checkout asks for an address'),
  ];
  // The artifacts directory holds more than the proof selected: a regression image and a stray file.
  writeImage('regression/cart-page/test-finished-1.png', 'Cart page › The cart page loads');
  writeImage('adw-994/stray.png', 'stray');
});

afterEach(() => {
  setProofUploaderForTesting(null);
  fs.rmSync(artifactsDir, { recursive: true, force: true });
});

describe('publishPrProof — the images of the comment', () => {
  it('uploads exactly the images the proof selected and embeds exactly their URLs, grouped by scenario', async () => {
    const { uploader, calls } = recordingUploader();
    const { commenter, comments } = recordingCommenter();

    await publishPrProof({ scenarioProof: proofWith(selected), prNumber: 4944, repoInfo, adwId, uploader, commenter });

    expect(calls.map(call => call.key)).toEqual([
      `proof/${adwId}/adw-994/cart-total/test-finished-1.png`,
      `proof/${adwId}/adw-994/checkout/test-finished-1.png`,
    ]);
    expect(comments).toHaveLength(1);
    const [{ prNumber, body }] = comments;
    expect(prNumber).toBe(4944);
    expect(embeddedUrls(body)).toEqual([
      `https://fake/proof/${adwId}/adw-994/cart-total/test-finished-1.png`,
      `https://fake/proof/${adwId}/adw-994/checkout/test-finished-1.png`,
    ]);
    expect(body).toContain('<summary>Cart › The cart shows the total (1)</summary>');
    expect(body).toContain('<summary>Checkout › The checkout asks for an address (1)</summary>');
    expect(body.endsWith(ADW_SIGNATURE)).toBe(true);
  });

  it('puts the images of one scenario under one summary', async () => {
    const twoOfOne = [
      selected[0],
      writeImage('adw-994/cart-total/second.png', 'Cart › The cart shows the total'),
    ];
    const { uploader } = recordingUploader();
    const { commenter, comments } = recordingCommenter();

    await publishPrProof({ scenarioProof: proofWith(twoOfOne), prNumber: 4944, repoInfo, adwId, uploader, commenter });

    expect(comments[0].body).toContain('<summary>Cart › The cart shows the total (2)</summary>');
    expect(embeddedUrls(comments[0].body)).toHaveLength(2);
  });

  it('uploads nothing and posts the tally when the proof selected no image', async () => {
    const { uploader, calls } = recordingUploader();
    const { commenter, comments } = recordingCommenter();

    await publishPrProof({ scenarioProof: proofWith([]), prNumber: 4944, repoInfo, adwId, uploader, commenter });

    expect(calls).toHaveLength(0);
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toContain('**5 passed, 0 failed**');
    expect(embeddedUrls(comments[0].body)).toEqual([]);
    expect(comments[0].body).not.toContain('R2 is not configured');
  });

  it('posts nothing without a scenario proof', async () => {
    const { uploader, calls } = recordingUploader();
    const { commenter, comments } = recordingCommenter();

    await publishPrProof({ scenarioProof: undefined, prNumber: 4944, repoInfo, adwId, uploader, commenter });

    expect(calls).toHaveLength(0);
    expect(comments).toEqual([]);
  });

  it('posts nothing for a pull request number that is not positive', async () => {
    const { uploader, calls } = recordingUploader();
    const { commenter, comments } = recordingCommenter();

    await publishPrProof({ scenarioProof: proofWith(selected), prNumber: 0, repoInfo, adwId, uploader, commenter });

    expect(calls).toHaveLength(0);
    expect(comments).toEqual([]);
  });

  it('leaves out an image whose upload fails and still posts the comment with the others', async () => {
    const { uploader } = recordingUploader();
    const refusing: UploaderFn = async (options) => {
      if (options.key.includes('checkout')) throw new Error('bucket refused');
      return uploader(options);
    };
    const { commenter, comments } = recordingCommenter();

    await publishPrProof({ scenarioProof: proofWith(selected), prNumber: 4944, repoInfo, adwId, uploader: refusing, commenter });

    expect(embeddedUrls(comments[0].body)).toEqual([`https://fake/proof/${adwId}/adw-994/cart-total/test-finished-1.png`]);
  });
});

describe('publishPrProof — R2 is not configured', () => {
  // Deliberately never restored: vitest registers queued doMocks of one module in no fixed order, so a
  // restoring doMock could override this one. The statically imported modules keep their credentials.
  async function loadWithoutR2Credentials() {
    vi.resetModules();
    vi.doMock('../../core/environment', () => ({
      CLOUDFLARE_ACCOUNT_ID: '',
      R2_ACCESS_KEY_ID: '',
      R2_SECRET_ACCESS_KEY: '',
    }));
    const publisher = await import('../prProofPublisher');
    const uploader = await import('../proofUploader');
    return { publishPrProof: publisher.publishPrProof, setProofUploaderForTesting: uploader.setProofUploaderForTesting };
  }

  it('hands exactly the selected images to an installed uploader, and the comment embeds them', async () => {
    const { publishPrProof: publish, setProofUploaderForTesting: install } = await loadWithoutR2Credentials();
    const installed = recordingUploader();
    install(installed.uploader);
    const { commenter, comments } = recordingCommenter();

    await publish({ scenarioProof: proofWith(selected), prNumber: 4944, repoInfo, adwId, commenter });

    expect(installed.calls.map(call => call.key)).toEqual([
      `proof/${adwId}/adw-994/cart-total/test-finished-1.png`,
      `proof/${adwId}/adw-994/checkout/test-finished-1.png`,
    ]);
    expect(embeddedUrls(comments[0].body)).toHaveLength(2);
    expect(comments[0].body).not.toContain('R2 is not configured');
  });

  it('uploads nothing and says so in the comment when no uploader is installed', async () => {
    const { publishPrProof: publish } = await loadWithoutR2Credentials();
    const { commenter, comments } = recordingCommenter();

    await publish({ scenarioProof: proofWith(selected), prNumber: 4944, repoInfo, adwId, commenter });

    expect(embeddedUrls(comments[0].body)).toEqual([]);
    expect(comments[0].body).toContain('R2 is not configured');
  });

  it('still skips an uploader that is only injected, as the credentials gate the upload', async () => {
    const { publishPrProof: publish } = await loadWithoutR2Credentials();
    const injected = recordingUploader();
    const { commenter, comments } = recordingCommenter();

    await publish({ scenarioProof: proofWith(selected), prNumber: 4944, repoInfo, adwId, uploader: injected.uploader, commenter });

    expect(injected.calls).toHaveLength(0);
    expect(comments[0].body).toContain('R2 is not configured');
  });
});
