import { describe, it, expect } from 'vitest';
import { APPLICATION_TYPE_PROFILES, type ApplicationProfiles } from '../../core/applicationType';
import { readDeclaredApplicationType } from '../applicationTypeGate';
import { FAKE, configDeclaring } from './applicationTypeGate.helpers';

describe('readDeclaredApplicationType', () => {
  it('returns the profile of a type the mapping knows, read as declaredApplicationProfile reads it', () => {
    expect(readDeclaredApplicationType(configDeclaring('  Web '))).toEqual({ kind: 'known', profile: APPLICATION_TYPE_PROFILES.web });
  });

  it.each([
    ['unknown', 'desktop', 'desktop'],
    ['a bare mobile', 'mobile', 'mobile'],
    ['an inherited name', 'constructor', 'constructor'],
    ['missing', null, null],
  ])('returns the value that did not resolve, without parking: %s', (_name, declared, unresolved) => {
    expect(readDeclaredApplicationType(configDeclaring(declared))).toEqual({ kind: 'unknown', declared: unresolved });
  });

  it('answers for a third type that reaches it through the table alone', () => {
    const profiles: ApplicationProfiles = { ...APPLICATION_TYPE_PROFILES, desktop: FAKE };

    expect(readDeclaredApplicationType(configDeclaring('desktop'), profiles)).toEqual({ kind: 'known', profile: FAKE });
  });
});
