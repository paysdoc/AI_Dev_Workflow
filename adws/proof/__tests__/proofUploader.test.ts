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
vi.mock('../proofArtifactHarvester', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../proofArtifactHarvester')>();
  return { harvestProofArtifacts: vi.fn(actual.harvestProofArtifacts) };
});

import { uploadProofArtifacts, setProofUploaderForTesting } from '../proofUploader';
import { harvestProofArtifacts } from '../proofArtifactHarvester';
import { uploadToR2 } from '../../r2/uploadService';
import { log } from '../../core/logger';
import type { UploaderFn } from '../types';

const mockUploadToR2 = vi.mocked(uploadToR2);
const mockHarvest = vi.mocked(harvestProofArtifacts);
const mockLog = vi.mocked(log);

const repoInfo = { owner: 'acme', repo: 'widgets', platform: Platform.GitHub } as const;
const adwId = 'adw-937';

let artifactsDir: string;

function writeArtifact(relPath: string): void {
  const fullPath = path.join(artifactsDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `bytes of ${relPath}`);
}

function recordingUploader(): { uploader: UploaderFn; calls: Parameters<UploaderFn>[0][] } {
  const calls: Parameters<UploaderFn>[0][] = [];
  const uploader: UploaderFn = async (options) => {
    calls.push(options);
    return { url: `https://fake/${options.key}`, bucket: `${options.owner}-${options.repo}`, key: options.key };
  };
  return { uploader, calls };
}

beforeEach(() => {
  artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-uploader-'));
  ['login/step-1.png', 'checkout/step-2.jpg', 'flat.webp', 'notes.txt'].forEach(writeArtifact);
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
  it('uploads each image once, never the non-image file, under proof/{adwId}/{relPath} in sorted order', async () => {
    const { uploader, calls } = recordingUploader();

    await uploadProofArtifacts({ artifactsDir, repoInfo, adwId, uploader });

    expect(calls.map(c => c.key)).toEqual([
      `proof/${adwId}/checkout/step-2.jpg`,
      `proof/${adwId}/flat.webp`,
      `proof/${adwId}/login/step-1.png`,
    ]);
    expect(calls.map(c => c.contentType)).toEqual(['image/jpeg', 'image/webp', 'image/png']);
  });

  it('uploads the bytes of the file under the repository named by repoInfo', async () => {
    const { uploader, calls } = recordingUploader();

    await uploadProofArtifacts({ artifactsDir, repoInfo, adwId, uploader });

    expect(calls.every(c => c.owner === 'acme' && c.repo === 'widgets')).toBe(true);
    expect(Buffer.from(calls[2].body as Uint8Array).toString()).toBe('bytes of login/step-1.png');
  });

  it('returns scenario, fileName and the uploader\'s url for each upload, in harvest order', async () => {
    const { uploader } = recordingUploader();

    const uploaded = await uploadProofArtifacts({ artifactsDir, repoInfo, adwId, uploader });

    expect(uploaded).toEqual([
      { scenario: 'checkout', fileName: 'step-2.jpg', url: `https://fake/proof/${adwId}/checkout/step-2.jpg` },
      { scenario: 'Screenshots', fileName: 'flat.webp', url: `https://fake/proof/${adwId}/flat.webp` },
      { scenario: 'login', fileName: 'step-1.png', url: `https://fake/proof/${adwId}/login/step-1.png` },
    ]);
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

    await uploadProofArtifacts({ artifactsDir, repoInfo, adwId, uploader });

    expect(maxInFlight).toBe(1);
  });
});

describe('uploadProofArtifacts — an upload never throws', () => {
  it('leaves out an artifact whose upload throws, uploads the rest, and resolves', async () => {
    const { uploader, calls } = recordingUploader();
    const refusingFirst: UploaderFn = async (options) => {
      if (options.key.endsWith('step-2.jpg')) throw new Error('bucket refused');
      return uploader(options);
    };

    const uploaded = await uploadProofArtifacts({ artifactsDir, repoInfo, adwId, uploader: refusingFirst });

    expect(uploaded.map(a => a.fileName)).toEqual(['flat.webp', 'step-1.png']);
    expect(calls).toHaveLength(2);
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('checkout/step-2.jpg'), 'warn');
  });

  it('resolves to [] when the artifacts directory does not exist, without uploading', async () => {
    const { uploader, calls } = recordingUploader();

    const uploaded = await uploadProofArtifacts({
      artifactsDir: path.join(artifactsDir, 'missing'),
      repoInfo,
      adwId,
      uploader,
    });

    expect(uploaded).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('resolves to [] and warns when harvesting the directory fails unexpectedly', async () => {
    mockHarvest.mockImplementationOnce(() => { throw new Error('disk gone'); });
    const { uploader, calls } = recordingUploader();

    const uploaded = await uploadProofArtifacts({ artifactsDir, repoInfo, adwId, uploader });

    expect(uploaded).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('disk gone'), 'warn');
  });
});

describe('uploadProofArtifacts — the uploader seam', () => {
  it('uploads to R2 when no uploader is injected or installed', async () => {
    const uploaded = await uploadProofArtifacts({ artifactsDir, repoInfo, adwId });

    expect(mockUploadToR2).toHaveBeenCalledTimes(3);
    expect(uploaded.map(a => a.url)).toEqual([
      `https://r2/proof/${adwId}/checkout/step-2.jpg`,
      `https://r2/proof/${adwId}/flat.webp`,
      `https://r2/proof/${adwId}/login/step-1.png`,
    ]);
  });

  it('sends the uploads of a call that injects none to the installed uploader, not to R2', async () => {
    const installed = recordingUploader();
    setProofUploaderForTesting(installed.uploader);

    await uploadProofArtifacts({ artifactsDir, repoInfo, adwId });

    expect(installed.calls).toHaveLength(3);
    expect(mockUploadToR2).not.toHaveBeenCalled();
  });

  it('prefers an injected uploader over the installed one', async () => {
    const installed = recordingUploader();
    const injected = recordingUploader();
    setProofUploaderForTesting(installed.uploader);

    await uploadProofArtifacts({ artifactsDir, repoInfo, adwId, uploader: injected.uploader });

    expect(injected.calls).toHaveLength(3);
    expect(installed.calls).toHaveLength(0);
  });

  it('returns to R2 once the installed uploader is removed with null', async () => {
    const installed = recordingUploader();
    setProofUploaderForTesting(installed.uploader);
    setProofUploaderForTesting(null);

    await uploadProofArtifacts({ artifactsDir, repoInfo, adwId });

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

    const uploaded = await upload({ artifactsDir, repoInfo, adwId });

    expect(uploaded).toEqual([]);
    expect(r2Upload).not.toHaveBeenCalled();
  });

  it('still uses an injected uploader, which counts as configured', async () => {
    const { uploadProofArtifacts: upload } = await loadWithoutR2Credentials();
    const injected = recordingUploader();

    const uploaded = await upload({ artifactsDir, repoInfo, adwId, uploader: injected.uploader });

    expect(injected.calls).toHaveLength(3);
    expect(uploaded).toHaveLength(3);
  });

  it('still uses an installed uploader, which counts as configured', async () => {
    const { uploadProofArtifacts: upload, setProofUploaderForTesting: install, uploadToR2: r2Upload } =
      await loadWithoutR2Credentials();
    const installed = recordingUploader();
    install(installed.uploader);

    const uploaded = await upload({ artifactsDir, repoInfo, adwId });

    expect(installed.calls).toHaveLength(3);
    expect(uploaded).toHaveLength(3);
    expect(r2Upload).not.toHaveBeenCalled();
  });
});
