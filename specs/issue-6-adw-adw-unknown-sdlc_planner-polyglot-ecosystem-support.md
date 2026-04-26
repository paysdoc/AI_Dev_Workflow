# Feature: Polyglot ecosystem support (pip, gomod, cargo, maven, gem, composer)

## Metadata
issueNumber: `6`
adwId: `adw-unknown`
issueJson: `{}`

## Feature Description
Extends `ManifestDiscoverer` and `OsvScannerAdapter` in the `paysdoc/depaudit` CLI to support the full polyglot set defined in the PRD: `requirements.txt` / `pyproject.toml` (pip), `go.mod` (gomod), `Cargo.toml` (cargo), `pom.xml` (maven), `Gemfile` (gem), `composer.json` (composer) — in addition to the existing `package.json` (npm) support. Build directories (`node_modules/`, `vendor/`, `target/`, `.venv/`, `__pycache__/`) are excluded. The OSV-Scanner adapter is updated to emit the correct ecosystem per manifest and handle multi-manifest input. All findings from all manifests are merged into a single scan result, each tagged with its originating manifest path.

## User Story
As a maintainer of a polyglot monorepo
I want `depaudit scan` to discover all manifest types automatically across all supported ecosystems
So that I have a single unified dependency audit gate without declaring manifests explicitly

## Problem Statement
The current `ManifestDiscoverer` only discovers `package.json` (npm), and `OsvScannerAdapter` throws an error for any non-npm ecosystem. Monorepos with Go, Python, Rust, Java, Ruby, or PHP dependencies are not scanned — they have zero CVE coverage.

## Solution Statement
Extend the manifest filename map to cover all PRD-listed ecosystems. Walk the repository tree, collect `(ecosystem, manifestPath)` tuples for every supported manifest type, and exclude `.gitignore`-listed paths plus hard-coded build directories. Pass all discovered manifests to `OsvScannerAdapter` (OSV-Scanner supports all these natively). Parse multi-ecosystem OSV output without filtering by ecosystem — emit each finding tagged with its source manifest. Merge all findings into one result array for downstream consumers.

## Relevant Files
All paths are relative to the `paysdoc/depaudit` repository root.

- `src/types/finding.ts` — `Ecosystem` union type is currently `"npm"` only; must be extended to all supported ecosystems.
- `src/types/manifest.ts` — `Manifest` interface; unchanged (already generic).
- `src/modules/manifestDiscoverer.ts` — Core module to extend with the polyglot filename map and additional build-dir exclusions.
- `src/modules/osvScannerAdapter.ts` — Remove npm-only guard; map OSV ecosystem strings to `Ecosystem` union members.
- `src/modules/__tests__/manifestDiscoverer.test.ts` — Existing unit tests; extend with polyglot and excluded-build-dir fixture assertions.
- `src/modules/__tests__/osvScannerAdapter.test.ts` — Existing unit tests; extend with multi-ecosystem normalization assertions.
- `src/modules/__tests__/fixtures/` — Fixture directories; new polyglot and excluded-build-dirs fixture repos needed.
- `features/scan.feature` — BDD integration test; add scenario for multi-manifest fixture repo.
- `features/step_definitions/scan_steps.ts` — Step definitions; extend if new steps are needed.
- `specs/prd/depaudit.md` — Reference for ecosystem names, manifest filenames, and build-dir exclusion list.

### New Files
- `src/modules/__tests__/fixtures/polyglot/package.json`
- `src/modules/__tests__/fixtures/polyglot/go.mod`
- `src/modules/__tests__/fixtures/polyglot/requirements.txt`
- `src/modules/__tests__/fixtures/polyglot/Cargo.toml`
- `src/modules/__tests__/fixtures/polyglot/pom.xml`
- `src/modules/__tests__/fixtures/polyglot/Gemfile`
- `src/modules/__tests__/fixtures/polyglot/composer.json`
- `src/modules/__tests__/fixtures/excluded-build-dirs/package.json` — root manifest that SHOULD be discovered
- `src/modules/__tests__/fixtures/excluded-build-dirs/node_modules/package.json` — must be excluded
- `src/modules/__tests__/fixtures/excluded-build-dirs/vendor/go.mod` — must be excluded
- `src/modules/__tests__/fixtures/excluded-build-dirs/target/pom.xml` — must be excluded
- `src/modules/__tests__/fixtures/excluded-build-dirs/.venv/requirements.txt` — must be excluded
- `src/modules/__tests__/fixtures/excluded-build-dirs/__pycache__/requirements.txt` — must be excluded
- `src/modules/__tests__/fixtures/osv-output/polyglot-findings.json` — fixture OSV JSON with npm + Go + PyPI findings
- `fixtures/polyglot-repo/package.json` — E2E fixture repo (npm)
- `fixtures/polyglot-repo/go.mod` — E2E fixture repo (gomod)
- `fixtures/polyglot-repo/requirements.txt` — E2E fixture repo (pip)

## Implementation Plan

### Phase 1: Foundation — Extend types and discovery
Extend `Ecosystem` in `src/types/finding.ts`. Update `manifestDiscoverer.ts` with a manifest filename map for all seven ecosystems and add hard-coded build-dir exclusions alongside the existing `.gitignore` rules.

### Phase 2: Core Implementation — Multi-ecosystem OSV adapter
Update `osvScannerAdapter.ts` to remove the npm-only guard, map OSV ecosystem strings to `Ecosystem` union members, and handle unknown ecosystem strings gracefully (skip with warning instead of throwing).

### Phase 3: Integration — Tests and fixtures
Add unit test fixtures, extend test suites, add the E2E fixture repo, and wire the BDD integration scenario asserting findings from all three manifest types in one merged scan result.

## Step by Step Tasks

### Step 1: Extend the `Ecosystem` type
- In `src/types/finding.ts`, change `Ecosystem` from `"npm"` to:
  `"npm" | "pip" | "gomod" | "cargo" | "maven" | "gem" | "composer"`
- Check all downstream code that references `Ecosystem` for exhaustiveness (switch statements in `configLoader.ts`, `findingMatcher.ts`, etc.) and update accordingly

### Step 2: Create polyglot unit-test fixture
- Create `src/modules/__tests__/fixtures/polyglot/` with minimal valid content for each manifest:
  - `package.json` — `{"name":"polyglot-test","version":"1.0.0","dependencies":{}}`
  - `go.mod` — `module example.com/polyglot\n\ngo 1.21`
  - `requirements.txt` — `# no deps`
  - `Cargo.toml` — `[package]\nname = "polyglot"\nversion = "0.1.0"\nedition = "2021"`
  - `pom.xml` — minimal Maven POM skeleton
  - `Gemfile` — `# frozen_string_literal: true\nsource "https://rubygems.org"`
  - `composer.json` — `{"name":"test/polyglot","require":{}}`

### Step 3: Create excluded-build-dirs unit-test fixture
- Create `src/modules/__tests__/fixtures/excluded-build-dirs/package.json` (root, must be discovered)
- Place manifests inside `node_modules/`, `vendor/`, `target/`, `.venv/`, `__pycache__/` subdirectories (must NOT be discovered)

### Step 4: Extend `manifestDiscoverer.ts`
- Replace the single `package.json` check with a manifest filename map:
  ```ts
  const MANIFEST_FILES: Record<string, Ecosystem> = {
    "package.json": "npm",
    "go.mod": "gomod",
    "Cargo.toml": "cargo",
    "requirements.txt": "pip",
    "pyproject.toml": "pip",
    "pom.xml": "maven",
    "Gemfile": "gem",
    "composer.json": "composer",
  };
  ```
- Seed the `ignore` instance with additional hard-coded build dirs: `vendor/`, `target/`, `.venv/`, `__pycache__/` (alongside the existing `node_modules/` and `.git/`)
- Update the walk to push a `Manifest` for each filename match in `MANIFEST_FILES` (multiple per directory are valid)
- Remove the `hasPackageJson` flag pattern; collect all hits during the readdir loop

### Step 5: Extend `manifestDiscoverer.test.ts`
- Add test: `discoverManifests` on `polyglot/` fixture returns 7 manifests with correct `(ecosystem, path)` tuples for each file
- Add test: `discoverManifests` on `excluded-build-dirs/` fixture returns exactly 1 manifest (root `package.json`)
- Verify all existing tests still pass

### Step 6: Create `polyglot-findings.json` OSV output fixture
- Create `src/modules/__tests__/fixtures/osv-output/polyglot-findings.json` with a realistic multi-ecosystem OSV JSON output: one npm finding, one Go finding (`"ecosystem": "Go"`), one PyPI finding (`"ecosystem": "PyPI"`)
- Follow the schema used in the existing `with-findings.json` fixture

### Step 7: Extend `osvScannerAdapter.ts`
- Remove the `if (ecosystem !== "npm") { throw ... }` guard
- Add an ecosystem mapping function:
  ```ts
  const OSV_ECOSYSTEM_MAP: Record<string, Ecosystem> = {
    npm: "npm",
    Go: "gomod",
    PyPI: "pip",
    "crates.io": "cargo",
    Maven: "maven",
    RubyGems: "gem",
    Packagist: "composer",
  };
  ```
- Use the mapped value for `Finding.ecosystem`; skip findings with unknown ecosystem strings (log warning, do not throw)
- The existing multi-dir subprocess argument construction is already correct — no changes needed there

### Step 8: Extend `osvScannerAdapter.test.ts`
- Add test: adapter parses `polyglot-findings.json` and returns 3 findings with correct `ecosystem` values (`"npm"`, `"gomod"`, `"pip"`)
- Add test: adapter skips findings with unknown ecosystem strings and returns the other findings without throwing
- Verify all existing tests still pass

### Step 9: Create E2E integration fixture repo
- Create `fixtures/polyglot-repo/` with minimal `package.json`, `go.mod`, and `requirements.txt`

### Step 10: Add BDD scenario to `features/scan.feature`
- Add a new scenario tagged `@adw-6` and `@regression` that:
  - Uses the `polyglot-repo` fixture
  - Runs `depaudit scan`
  - Asserts that the findings file contains entries attributed to `package.json`, `go.mod`, and `requirements.txt`
- Adapt exact step wording to match existing step patterns in `scan.feature`
- Add any missing step definitions to `features/step_definitions/scan_steps.ts`

### Step 11: Run validation commands
- Run all validation commands listed in the Validation Commands section
- Fix any type errors or test failures before marking complete

## Testing Strategy

### Unit Tests
- `manifestDiscoverer.test.ts`: polyglot fixture returns 7 manifests; excluded-build-dirs fixture returns 1; all existing tests pass
- `osvScannerAdapter.test.ts`: `polyglot-findings.json` is parsed and normalized to correct `Ecosystem` values; unknown ecosystem strings are skipped without throwing

### Edge Cases
- Directory with both `requirements.txt` and `pyproject.toml` — both returned as separate `pip` manifests; OSV-Scanner handles the directory once; duplicate findings at the OSV level are deduplicated by `(package, version, findingId)` identity in `FindingMatcher`
- `.gitignore` excludes a subtree containing a `go.mod` — the `go.mod` must not appear in results
- `vendor/` directory contains a `go.mod` (common in Go repos) — excluded by the hard-coded exclusion rule, not by `.gitignore`
- OSV output contains an ecosystem string not in `OSV_ECOSYSTEM_MAP` — finding is silently skipped; scan does not crash; other findings are returned normally

## Acceptance Criteria
- [ ] `ManifestDiscoverer` returns `(ecosystem, manifest_path)` tuples for all 7 manifest types (npm, pip via `requirements.txt`, pip via `pyproject.toml`, gomod, cargo, maven, gem, composer)
- [ ] `.gitignore` rules and hard-coded build directories (`node_modules/`, `vendor/`, `target/`, `.venv/`, `__pycache__/`) are excluded from discovery
- [ ] `OsvScannerAdapter` maps OSV ecosystem strings to `Ecosystem` union members correctly; unknown strings are skipped without throwing
- [ ] A scan over a polyglot fixture repo produces findings from all manifests in a single merged result, each tagged with its originating `manifestPath`
- [ ] BDD scenario `@adw-6` passes: fixture repo with `package.json` + `go.mod` + `requirements.txt` produces findings attributed to each manifest
- [ ] `bun run typecheck` passes with no errors
- [ ] `bun test` passes with no regressions

## Validation Commands
```bash
bun run lint
bun run typecheck
bun test
bun run test:e2e -- --tags "@adw-6"
bun run test:e2e -- --tags "@regression"
```

## Notes
- All implementation is in the `paysdoc/depaudit` repository (not the ADW repo). The worktree for this issue is created at `/Users/martin/projects/paysdoc/depaudit/.worktrees/`.
- The `Ecosystem` type expansion in `finding.ts` is a breaking change for any downstream code that pattern-matches exhaustively on `Ecosystem`. Audit all switch statements and exhaustive checks; update them before running `typecheck`.
- Issue #5 (`depaudit-yml-schema-finding-matcher`) must be merged first — this issue inherits `FindingMatcher` and `ConfigLoader` from that branch. The `Ecosystem` type change here supersedes the `"npm"`-only type from earlier slices.
- OSV-Scanner's multi-dir subprocess invocation is already correctly implemented in the adapter (passes unique parent directories). No subprocess argument changes are required — only output parsing.
- If `pyproject.toml` and `requirements.txt` coexist in the same directory, both are surfaced. OSV-Scanner deduplicates at the scan level; any duplicate findings surface as identical `Finding` objects that `FindingMatcher` will collapse by identity.
