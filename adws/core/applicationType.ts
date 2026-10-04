import { ParkReason, type ParkEvidence } from '../forge/parkComment';

export enum RunnerMode {
  /** The runner `.adw/scenarios.md` names. */
  Descriptor = 'descriptor',
  /** The Playwright project ADW owns in `features/`. */
  AdwPlaywright = 'adw_playwright',
}

export enum EvidenceKind {
  PerIssueImages = 'per_issue_images',
}

export interface ApplicationProfile {
  readonly runnerMode: RunnerMode;
  readonly evidenceKinds: readonly EvidenceKind[];
  /** The title of the review prompt's guidance section for this type. */
  readonly reviewGuidanceSection: string;
}

export type ApplicationProfiles = Readonly<Record<string, ApplicationProfile>>;

export type MissingApplicationTypeEvidence = Extract<ParkEvidence, { readonly reason: ParkReason.MissingApplicationType }>;

export type ApplicationTypeResolution =
  | { readonly kind: 'known'; readonly profile: ApplicationProfile }
  | { readonly kind: 'park'; readonly evidence: MissingApplicationTypeEvidence };

// The only place a type name means anything: a new type is one entry here plus detection in `adw_init`,
// and no phase changes, because consumers receive the profile and never the type.
export const APPLICATION_TYPE_PROFILES = {
  cli: { runnerMode: RunnerMode.Descriptor, evidenceKinds: [], reviewGuidanceSection: 'CLI applications' },
  web: { runnerMode: RunnerMode.AdwPlaywright, evidenceKinds: [EvidenceKind.PerIssueImages], reviewGuidanceSection: 'Web applications' },
} as const satisfies ApplicationProfiles;

export type ApplicationType = keyof typeof APPLICATION_TYPE_PROFILES;

const RUNNER_DESCRIPTIONS: Readonly<Record<RunnerMode, string>> = {
  [RunnerMode.Descriptor]: 'the scenario runner that `.adw/scenarios.md` describes',
  [RunnerMode.AdwPlaywright]: "ADW's Playwright project in `features/`",
};

const EVIDENCE_DESCRIPTIONS: Readonly<Record<EvidenceKind, string>> = {
  [EvidenceKind.PerIssueImages]: 'per-issue scenario images',
};

function parkFor(found: string | null): ApplicationTypeResolution {
  return { kind: 'park', evidence: { reason: ParkReason.MissingApplicationType, found } };
}

/** Only the table's own keys count, so an inherited name such as `constructor` is an unknown type. */
export function resolveApplicationType(
  declared: string | null,
  profiles: ApplicationProfiles = APPLICATION_TYPE_PROFILES,
): ApplicationTypeResolution {
  const key = declared?.trim().toLowerCase() ?? '';
  if (key === '') return parkFor(null);
  if (!Object.prototype.hasOwnProperty.call(profiles, key)) return parkFor(declared);
  return { kind: 'known', profile: profiles[key] };
}

export function describeApplicationProfile(profile: ApplicationProfile): string {
  const runner = RUNNER_DESCRIPTIONS[profile.runnerMode];
  const evidence = profile.evidenceKinds.length === 0 ? 'no images' : profile.evidenceKinds.map(kind => EVIDENCE_DESCRIPTIONS[kind]).join(', ');
  return `scenarios run with ${runner}; evidence: ${evidence}`;
}
