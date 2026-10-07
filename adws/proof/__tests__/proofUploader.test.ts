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

import { uploadProofArtifacts, isProofUploadConfigured, setProofUploaderForTesting } from '../proofUploader';
import { uploadToR2 } from '../../r2/uploadService';
import { log } from '../../core/logger';
import type { PerIssueImage, UploaderFn } from '../types';

const mockUploadToR2 = vi.mocked(uploadToR2);
const mockLog = vi.mocked(log);

const repoInfo = { owner: 'acme', repo: 'widgets', platform: Platform.GitHub } as const;
const adwId = 'adw-994';

let artifactsDir: string;

/** An image the artifacts directory holds, which a scenario of the given name took. */
function writeImage(relPath: string, scenario: string): PerIssueImage {
  const absPath = path.join(artifactsDir, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `bytes of ${relPath}`);
  return { absPath, relPath, scenario };
}

function recordingUploader(): { uploader: UploaderFn; calls: Parameters<UploaderFn>[0][] } {
  const calls: Parameters<UploaderFn>[0][] = [];
  const uploader: UploaderFn = async (options) => {
    calls.push(options);
    return { url: `https://fake/${options.key}`, bucket: `${options.owner}-${options.repo}`, key: options.key };
  };
  return { uploader, calls };
}

let images: PerIssueImage[];

beforeEach(() => {
  artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-uploader-'));
  images = [
    writeImage('adw-994/login/step-1.png', 'Login › The shopper signs in'),
    writeImage('adw-994/checkout/step-2.jpg', 'Checkout › The shopper pays'),
    writeImage('adw-994/flat.webp', 'Flat › Not in a folder'),
  ];
  mockUploadToR2.mockReset();
  mockUploadToR2.mockImplementation(async (options) => ({
    url: `https://r2/${options.key}`,
    bucket: `${options.owner}-${options.repo}`,
    key: options.key,
  }));
  mockLog.mockReset();
});

afterEach(() => {
  setProofUploaderForTesting(null);
  fs.rmSync(artifactsDir, { recursive: true, force: true });
});

describe('uploadProofArtifacts — what is uploaded', () => {
  it('uploads exactly the images it is given, in the order given, under proof/{adwId}/{relPath}', async () => {
    const { uploader, calls } = recordingUploader();

    await uploadProofArtifacts({ images, repoInfo, adwId, uploader });

    expect(calls.map(c => c.key)).toEqual([
      `proof/${adwId}/adw-994/login/step-1.png`,
      `proof/${adwId}/adw-994/checkout/step-2.jpg`,
      `proof/${adwId}/adw-994/flat.webp`,
    ]);
    expect(calls.map(c => c.contentType)).toEqual(['image/png', 'image/jpeg', 'image/webp']);
  });

  it('does not upload a file of the artifacts directory that it is not given', async () => {
    writeImage('regression/cart-page/test-finished-1.png', 'Cart page');
    const { uploader, calls } = recordingUploader();

    await uploadProofArtifacts({ images, repoInfo, adwId, uploader });

    expect(calls.map(c => c.key).some(key => key.includes('regression'))).toBe(false);
    expect(calls).toHaveLength(3);
  });

  it('uploads the bytes of the file under the repository named by repoInfo', async () => {
    const { uploader, calls } = recordingUploader();

    await uploadProofArtifacts({ images, repoInfo, adwId, uploader });

    expect(calls.every(c => c.owner === 'acme' && c.repo === 'widgets')).toBe(true);
    expect(Buffer.from(calls[0].body as Uint8Array).toString()).toBe('bytes of adw-994/login/step-1.png');
  });

  it('returns the scenario of each image, its file name and the uploader\'s url, in the order given', async () => {
    const { uploader } = recordingUploader();

    const uploaded = await uploadProofArtifacts({ images, repoInfo, adwId, uploader });

    expect(uploaded).toEqual([
      { scenario: 'Login › The shopper signs in', fileName: 'step-1.png', url: `https://fake/proof/${adwId}/adw-994/login/step-1.png` },
      { scenario: 'Checkout › The shopper pays', fileName: 'step-2.jpg', url: `https://fake/proof/${adwId}/adw-994/checkout/step-2.jpg` },
      { scenario: 'Flat › Not in a folder', fileName: 'flat.webp', url: `https://fake/proof/${adwId}/adw-994/flat.webp` },
    ]);
  });

  it('uploads nothing, and resolves to [], for an empty list', async () => {
    const { uploader, calls } = recordingUploader();

    const uploaded = await uploadProofArtifacts({ images: [], repoInfo, adwId, uploader });

    expect(uploaded).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('uploads one at a time, because the bucket is created lazily by the first upload', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const uploader: UploaderFn = async (options) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 1));
      inFlight -= 1;
      return { url: `https://fake/${options.key}`, bucket: 'b', key: options.key };
    };

    await uploadProofArtifacts({ images, repoInfo, adwId, uploader });

    expect(maxInFlight).toBe(1);
  });
});

describe('uploadProofArtifacts — an upload never throws', () => {
  it('leaves out an image whose upload throws, uploads the rest, and resolves', async () => {
    const { uploader, calls } = recordingUploader();
    const refusingFirst: UploaderFn = async (options) => {
      if (options.key.endsWith('step-2.jpg')) throw new Error('bucket refused');
      return uploader(options);
    };

    const uploaded = await uploadProofArtifacts({ images, repoInfo, adwId, uploader: refusingFirst });

    expect(uploaded.map(a => a.fileName)).toEqual(['step-1.png', 'flat.webp']);
    expect(calls).toHaveLength(2);
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('adw-994/checkout/step-2.jpg'), 'warn');
  });

  it('leaves out an image whose file cannot be read, uploads the rest, and resolves', async () => {
    const { uploader, calls } = recordingUploader();
    fs.rmSync(images[0].absPath);

    const uploaded = await uploadProofArtifacts({ images, repoInfo, adwId, uploader });

    expect(uploaded.map(a => a.fileName)).toEqual(['step-2.jpg', 'flat.webp']);
    expect(calls).toHaveLength(2);
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('adw-994/login/step-1.png'), 'warn');
  });
});

describe('uploadProofArtifacts — the uploader seam', () => {
  it('uploads to R2 when no uploader is injected or installed', async () => {
    const uploaded = await uploadProofArtifacts({ images, repoInfo, adwId });

    expect(mockUploadToR2).toHaveBeenCalledTimes(3);
    expect(uploaded.map(a => a.url)).toEqual([
      `https://r2/proof/${adwId}/adw-994/login/step-1.png`,
      `https://r2/proof/${adwId}/adw-994/checkout/step-2.jpg`,
      `https://r2/proof/${adwId}/adw-994/flat.webp`,
    ]);
  });

  it('sends the uploads of a call that injects none to the installed uploader, not to R2', async () => {
    const installed = recordingUploader();
    setProofUploaderForTesting(installed.uploader);

    await uploadProofArtifacts({ images, repoInfo, adwId });

    expect(installed.calls).toHaveLength(3);
    expect(mockUploadToR2).not.toHaveBeenCalled();
  });

  it('prefers an injected uploader over the installed one', async () => {
    const installed = recordingUploader();
    const injected = recordingUploader();
    setProofUploaderForTesting(installed.uploader);

    await uploadProofArtifacts({ images, repoInfo, adwId, uploader: injected.uploader });

    expect(injected.calls).toHaveLength(3);
    expect(installed.calls).toHaveLength(0);
  });

  it('returns to R2 once the installed uploader is removed with null', async () => {
    const installed = recordingUploader();
    setProofUploaderForTesting(installed.uploader);
    setProofUploaderForTesting(null);

    await uploadProofArtifacts({ images, repoInfo, adwId });

    expect(installed.calls).toHaveLength(0);
    expect(mockUploadToR2).toHaveBeenCalledTimes(3);
  });
});

describe('uploadProofArtifacts — R2 is not configured', () => {
  // Deliberately never restored: vitest registers queued doMocks of one module in no fixed order, so a
  // restoring doMock could override this one. The statically imported module keeps its credentials.
  async function loadWithoutR2Credentials() {
    vi.resetModules();
    vi.doMock('../../core/environment', () => ({
      CLOUDFLARE_ACCOUNT_ID: '',
      R2_ACCESS_KEY_ID: '',
      R2_SECRET_ACCESS_KEY: '',
    }));
    const proofUploader = await import('../proofUploader');
    const r2 = await import('../../r2/uploadService');
    return { ...proofUploader, uploadToR2: vi.mocked(r2.uploadToR2) };
  }

  it('reports itself unconfigured', async () => {
    const { isR2Configured } = await loadWithoutR2Credentials();

    expect(isR2Configured()).toBe(false);
  });

  it('uploads nothing and resolves to [] when neither an injected nor an installed uploader is set', async () => {
    const { uploadProofArtifacts: upload, uploadToR2: r2Upload } = await loadWithoutR2Credentials();

    const uploaded = await upload({ images, repoInfo, adwId });

    expect(uploaded).toEqual([]);
    expect(r2Upload).not.toHaveBeenCalled();
  });

  it('still uses an injected uploader, which counts as configured', async () => {
    const { uploadProofArtifacts: upload } = await loadWithoutR2Credentials();
    const injected = recordingUploader();

    const uploaded = await upload({ images, repoInfo, adwId, uploader: injected.uploader });

    expect(injected.calls).toHaveLength(3);
    expect(uploaded).toHaveLength(3);
  });

  it('still uses an installed uploader, which counts as configured', async () => {
    const { uploadProofArtifacts: upload, setProofUploaderForTesting: install, uploadToR2: r2Upload } =
      await loadWithoutR2Credentials();
    const installed = recordingUploader();
    install(installed.uploader);

    const uploaded = await upload({ images, repoInfo, adwId });

    expect(installed.calls).toHaveLength(3);
    expect(uploaded).toHaveLength(3);
    expect(r2Upload).not.toHaveBeenCalled();
  });
});

describe('isProofUploadConfigured', () => {
  async function loadWithoutR2Credentials() {
    vi.resetModules();
    vi.doMock('../../core/environment', () => ({
      CLOUDFLARE_ACCOUNT_ID: '',
      R2_ACCESS_KEY_ID: '',
      R2_SECRET_ACCESS_KEY: '',
    }));
    return import('../proofUploader');
  }

  it('is true when R2 has credentials', () => {
    expect(isProofUploadConfigured()).toBe(true);
  });

  it('is false without credentials and without an installed uploader', async () => {
    const { isProofUploadConfigured: configured } = await loadWithoutR2Credentials();

    expect(configured()).toBe(false);
  });

  it('is true without credentials once an uploader is installed, and false again when it is removed', async () => {
    const { isProofUploadConfigured: configured, setProofUploaderForTesting: install } = await loadWithoutR2Credentials();

    install(recordingUploader().uploader);
    expect(configured()).toBe(true);

    install(null);
    expect(configured()).toBe(false);
  });
});
