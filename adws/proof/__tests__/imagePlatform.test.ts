import { describe, it, expect } from 'vitest';
import { Platform } from '../../core/applicationType';
import { platformOfImage, scenarioPlatformCoverage } from '../imagePlatform';
import type { PerIssueImage } from '../types';

const BOTH = [Platform.Android, Platform.Ios];

describe('platformOfImage', () => {
  it.each([
    ['android/login.png', Platform.Android],
    ['ios/a/b.png', Platform.Ios],
    ['android/sign-in/deep/x.png', Platform.Android],
  ])('reads %s as %s, given both platforms', (relPath, platform) => {
    expect(platformOfImage(relPath, BOTH)).toBe(platform);
  });

  it.each([
    'login.png',
    'linux/x.png',
    'Android/login.png',
    'IOS/login.png',
    'androidx/login.png',
    'android.png',
    'screens/android/login.png',
  ])('reads %s as unattributed, given both platforms', relPath => {
    expect(platformOfImage(relPath, BOTH)).toBeNull();
  });

  it('knows only the platforms it is given', () => {
    expect(platformOfImage('ios/login.png', [Platform.Android])).toBeNull();
    expect(platformOfImage('android/login.png', [])).toBeNull();
  });
});

describe('scenarioPlatformCoverage', () => {
  function image(scenario: string, relPath: string, platform: Platform): PerIssueImage {
    return { absPath: `/work/proof/artifacts/${relPath}`, relPath, scenario, platform };
  }

  it('names both platforms present and none missing for a scenario with an image on each', () => {
    const images = [image('Sign in', 'android/a.png', Platform.Android), image('Sign in', 'ios/a.png', Platform.Ios)];

    expect(scenarioPlatformCoverage(images, BOTH)).toEqual([{ scenario: 'Sign in', present: BOTH, missing: [] }]);
  });

  it('names android present and ios missing for a scenario with android images only, however many it has', () => {
    const images = [image('Sign in', 'android/a.png', Platform.Android), image('Sign in', 'android/b.png', Platform.Android)];

    expect(scenarioPlatformCoverage(images, BOTH)).toEqual([{ scenario: 'Sign in', present: [Platform.Android], missing: [Platform.Ios] }]);
  });

  it('names the only platform of a one-platform profile present, so that no scenario misses one', () => {
    const images = [image('Sign in', 'android/a.png', Platform.Android)];

    expect(scenarioPlatformCoverage(images, [Platform.Android])).toEqual([{ scenario: 'Sign in', present: [Platform.Android], missing: [] }]);
  });

  it('lists the platforms in the order of the profile, not of the images', () => {
    const images = [image('Sign in', 'ios/a.png', Platform.Ios), image('Sign in', 'android/a.png', Platform.Android)];

    expect(scenarioPlatformCoverage(images, BOTH)[0].present).toEqual([Platform.Android, Platform.Ios]);
    expect(scenarioPlatformCoverage(images, [Platform.Ios, Platform.Android])[0].present).toEqual([Platform.Ios, Platform.Android]);
  });

  it('gives one entry per scenario, in the order of its first image', () => {
    const images = [
      image('Sign out', 'ios/out.png', Platform.Ios),
      image('Sign in', 'android/in.png', Platform.Android),
      image('Sign out', 'android/out.png', Platform.Android),
      image('Sign in', 'ios/in.png', Platform.Ios),
    ];

    expect(scenarioPlatformCoverage(images, BOTH).map(entry => entry.scenario)).toEqual(['Sign out', 'Sign in']);
  });

  it('gives no entry when there is no image', () => {
    expect(scenarioPlatformCoverage([], BOTH)).toEqual([]);
  });
});
