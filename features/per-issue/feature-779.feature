@adw-779 @adw-uds89n-readlocalrepoinfo-tr
Feature: A local clone of a repository whose name contains a dot resolves to its FULL name — paysdoc/paysdoc.nl is no longer read as paysdoc/paysdoc, so the App token mint stops asking about a repository that does not exist

  Issue #779 is a wrong-identity defect in the one permanently-allowlisted
  pre-context git read. `readLocalRepoInfo` (`adws/gitContext/bootstrapIdentity.ts`)
  parses owner/repo out of the local clone's `origin` remote URL with:

    const httpsMatch = remoteUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
    const sshMatch   = remoteUrl.match(/git@github\.com:([^/]+)\/([^/.]+)/);

  The repo capture group `([^/.]+)` was meant to drop a trailing `.git`, but it
  stops at the FIRST dot. For `git@github.com:paysdoc/paysdoc.nl.git` it captures
  `paysdoc`, so the resolved identity is `paysdoc/paysdoc` — a repository that
  does not exist. Every repository with a dot in its name is mis-identified.

  The cost is a permanent dead end, not a flake. On 2026-07-30 the run
  `a7tfo4-remove-secrets-store` against `paysdoc/paysdoc.nl` died in the upgrade
  gate at `GET https://api.github.com/repos/paysdoc/paysdoc/installation`. That
  particular curl happened to exit 56 (connection reset), but with the wrong repo
  name the call 404s forever: the upgrade claim can never mint a token, so the
  upgrade gate can never pass for this repo. This is the same wrong-repo-identity
  class the GitContext PRD exists to kill — and it is invisible to the git/gh
  guard, because `readLocalRepoInfo` IS the sanctioned bootstrap read.

  Every cwd-derived-identity caller inherits the truncation. Verified consumers in
  this checkout: `upgradeClaim.ts:174` (`buildDefaultUpgradeClaimDeps` — the site
  in the crash trace), `orchestratorLib.ts:35`, `trigger_webhook.ts:93` (self-host
  health check), `githubApi.ts:20` (`getRepoInfo`), `gitContextFactory.ts:61`
  (`getSelfHostIdentity`), `checkLivingDocsIndex.ts:52`, `healthCheck.tsx:112`.
  The webhook EVENT path is the one identity path that is safe, because it takes
  `repository.full_name` from the payload rather than from the clone.

  The behavioural contract pinned below. Every RED/GREEN state was measured
  against the current regexes and against the issue's suggested replacement
  before this file was written — none of them is assumed:

    1. THE REPORTED FAILURE (the fix). A clone whose origin remote names
       `paysdoc/paysdoc.nl` resolves to owner `paysdoc`, repository `paysdoc.nl`
       — for the SSH and HTTPS forms, with and without the `.git` suffix. RED
       today: all four forms resolve to `paysdoc/paysdoc`.
    2. THE REST OF THE DOTTED FAMILY (the fix). Multi-dot names (`a.b.c`), the
       GitHub Pages shape (`paysdoc.github.io`), a trailing slash on the HTTPS
       form, and a leading-dot name (`.github`) all resolve to the full name. RED
       today: the first three truncate at the first dot; `.github` fails to parse
       at all, because `([^/.]+)` cannot match a name that STARTS with the dot.
    3. NO REGRESSION ON EVERY OTHER REMOTE FORM (guard). Dot-free names still
       resolve, across all seven remote shapes ADW actually meets: SSH and HTTPS
       with and without `.git`, a trailing slash, a credential-prefixed HTTPS URL
       (the App-token push form), and the `ssh://` scheme form. GREEN today and
       must stay GREEN — this is the load-bearing half of the fix, because
       widening the repo group from `([^/.]+)` to something dot-tolerant is
       exactly the kind of change that starts swallowing suffixes. The
       trailing-slash row earns its place: a LITERAL transcription of the issue's
       suggested HTTPS pattern (`/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/`, no
       trailing-slash tolerance) returns `webapp/` for it. The issue's own
       parenthetical says to tolerate the slash; this row is what enforces it.
    4. ONE PARSE BEHIND BOTH ENTRY POINTS (guard). `getRepoInfo(cwd)` — the other
       function the git/gh guard recognises as a legitimate cwd-derived identity
       read — resolves the dotted clone to the same full name as
       `readLocalRepoInfo(cwd)`. Guards against a fix applied at one call site
       instead of in the shared parse. RED today (both truncate identically).
    5. THE CRASH SURFACE (the fix). Given the dotted clone, the App
       installation-token mint is requested for `paysdoc/paysdoc.nl`, and never
       for `paysdoc/paysdoc`. This is the assertion that speaks to the reported
       symptom: the mint's `(owner, repo)` arguments are literally the path
       segments of the `/repos/{owner}/{repo}/installation` URL that 404s. RED
       today: the recorded mint targets `paysdoc/paysdoc`.
    6. STILL FAILS LOUDLY ON A NON-GITHUB REMOTE (guard). A GitLab or Bitbucket
       origin still raises rather than returning a fabricated identity. GREEN
       today and must stay GREEN: a silently-wrong identity is precisely the
       failure mode this whole package was built to prevent, and §2's leading-dot
       requirement pushes the pattern in the permissive direction.
    7. TYPE-CHECK BACKSTOP.

  How the scenarios drive the system under test:

    In-process (the phase-import pattern), with no orchestrator subprocess, no
    mock server, and no network:

      • Each scenario's Given builds a REAL throwaway git repository in a temp
        directory (`git init`, then `git remote add origin <url>`) — both are
        purely local operations. The remote URL is the scenario's INPUT.
      • The identity is resolved by calling the REAL `readLocalRepoInfo(tempDir)`
        (and, in §4, the REAL `getRepoInfo(tempDir)`), which shells out to the
        real `git remote get-url origin` in that temp repo. The returned
        `RepoInfo` is the assertion target. Nothing re-implements the parse, so
        these scenarios cannot drift from production the way the current unit
        tests did: `bootstrapIdentity.test.ts` copies the two regexes inline, so
        it asserts a transcription of the bug rather than the code, which is why
        four green tests never saw it.
      • §5 composes the two REAL production functions the crash trace runs
        through — `readLocalRepoInfo` for the identity, then
        `resolveContextToken` for the mint — with `isAppConfigured: () => true`
        and a RECORDING `mintInstallationToken` in place of
        `getInstallationToken`. `ResolveContextTokenInput` also requires
        `ghAuthToken`; the App branch returns before it is ever called, but it is
        not optional, so the composition must still supply a `() => ''` stub.
        The recorded `(owner, repo)` pair is the assertion target.

        The composition stops there deliberately. `getInstallationToken` builds
        the failing URL, but it reads App env vars, signs a JWT with a real
        private key, and curls api.github.com through an unseamed `execSync` —
        none of it hermetically drivable. `gitContextForRepo` is no better: it
        binds module-load-time `GITHUB_PAT` and mints eagerly at construction.
        So the pinned surface is the identity handed to the mint, which is what
        becomes the URL's path. This is the same deliberate stop feature-770 §"how
        the scenarios drive" makes when it re-composes the verdict → channel
        mapping rather than running `executeUnitTestPhase`.

  Observability / rot-prevention note:

    Every assertion targets a value the system RETURNS at runtime, or an error it
    RAISES, over a temp-directory fixture the step itself builds:

      • §1–§4 assert the `RepoInfo` returned by the real resolver. A returned
        value over a self-built fixture is exactly the registry's `@adw-537`
        pattern (G-HC1/W-HC1/T-HC1: the step writes a throwaway fixture, the
        module under test runs over it, the RETURN VALUE is asserted).
      • §5 asserts the arguments recorded on an injected collaborator — the
        registry's recorded-call surface (#2), reached in-process rather than
        through a mock server, as T23/T24 already do for auth calls.
      • §6 asserts the error the resolver raises (registry surface: raised error,
        as in T-HC4/T-HC5).
      • §7 asserts the type-checker's verdict (registry T22).

    Deliberately NOT asserted (would violate the framework Rot-Prevention rule):
    that a pure parsing function was extracted, that it carries any particular
    name or signature, that `bootstrapIdentity.ts` contains any particular regex,
    or any substring/AST match against `bootstrapIdentity.ts` or its test file.
    The extraction the issue asks for is a testability refactor; what these
    scenarios pin is that the parse is CORRECT and that both entry points share
    it (§4). No step reads a source file of this repo as text, substring-matches
    its contents, or parses it as JSON/AST.

  Scope notes:

    • The issue's suggested regexes are a SUGGESTION. Pinning them verbatim would
      make this file rot on the first refactor, and one of them is subtly
      incomplete (§3's trailing-slash row). §1–§3 pin the resolved identity for
      every remote form instead, so any correct implementation passes — a
      dot-tolerant regex, or `([^/]+)` plus a `replace(/\.git$/, '')`, both do.
    • The leading-dot row in §2 (`paysdoc/.github`, the org profile repo) is not
      in the issue's list. It is included because it is a real GitHub name shape
      that is broken today by the same root cause — the group cannot match a
      name starting with a dot — and because it discriminates between candidate
      fixes: a `split('.')[0]`-shaped fix passes §1 and fails here.
    • The requested unit-test cases in `bootstrapIdentity.test.ts` and the
      extraction of the parse into a pure exported function are the implementer's
      business and are not restated here. §4 pins the observable consequence of
      the extraction (both entry points agreeing) rather than its shape.
    • The webhook EVENT path is out of scope: it derives identity from the
      payload's `repository.full_name`, never from a clone, so this bug cannot
      reach it and no scenario here pins it.
    • `getSelfHostIdentity` (`gitContextFactory.ts:61`) also truncates, but its
      input is the framework's own `REPO_ROOT` behind a module-level cache, and
      this repo's name has no dot — so there is no observable defect to pin and
      no hermetic seam to pin it through. It is listed in the docstring's blast
      radius for the implementer, not scenario-pinned.
    • The same defective capture group is duplicated twice more, OUTSIDE the
      identity-read path: `getRepoInfoFromUrl` (`githubApi.ts:27-28`) and
      `convertToSshUrl` (`repoWorkspace.ts:62`). Neither is a cwd-derived
      identity read, so neither is scenario-pinned here — this file is the
      issue-faithful contract and the issue names only the identity read.
      (`getRepoInfoFromUrl` has no internal callers; `convertToSshUrl` is
      fully anchored, so a dotted name does not truncate — it fails to match and
      the function returns its input unchanged, silently cloning a dotted target
      repo over HTTPS instead of SSH.) Both are in scope for the FIX — same
      regex, same root cause — and are guarded by unit tests rather than by a
      scenario. §4 is what forces one shared parse behind all of them.
    • The curl exit 56 in the report is noise, as the issue itself states. No
      scenario asserts anything about transport failure.
    • The `@regression` maintenance sweep is SKIPPED for this issue:
      `.adw/scenarios.md` configures a `## Regression Scenario Directory`, so
      promotion is a deliberate human decision and the agent never auto-promotes.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 (`the ADW codebase is checked out`),
      T22 (`the ADW TypeScript type-check passes`).

    No registered phrase covers building a temp clone with a chosen origin remote
    and asserting the identity read back out of it. The registry's git phrases
    (G2/G11/T4/T11) all address git-mock invocations or worktree branch state, and
    its recorded-call phrases (T23/T24) name auth activation on a mock server,
    which these server-free scenarios never start. Novel phrasing is therefore
    introduced and the gap is surfaced to the maintainer in the agent Output:
      • `a local clone whose origin remote is {string}`
      • `the local repository identity is read from that clone`
      • `reading the local repository identity from that clone is attempted`
      • `the local repository identity is read from that clone through both cwd-derived entry points`
      • `an App installation token is minted for the identity read from that clone`
      • `the resolved identity is owner {string} and repository {string}`
      • `both cwd-derived entry points resolve the identity to owner {string} and repository {string}`
      • `the recorded installation-token mint targets the repository {string}`
      • `no installation-token mint targets the repository {string}`
      • `reading the local repository identity fails loudly rather than returning an identity`

  Background:
    Given the ADW codebase is checked out

  # ── §1 The reported failure — paysdoc/paysdoc.nl, all four canonical forms ────
  #
  # The bug as filed. RED today in every row: `([^/.]+)` stops at the first dot,
  # so all four resolve to `paysdoc/paysdoc`. The `.git`-less rows matter as much
  # as the suffixed ones — the group was written to strip `.git`, so a fix that
  # only handles the suffixed form would leave half the matrix broken.

  @adw-779 @adw-uds89n-readlocalrepoinfo-tr
  Scenario Outline: A clone of paysdoc/paysdoc.nl resolves to the full dotted repository name (<form>)
    Given a local clone whose origin remote is "<remote>"
    When the local repository identity is read from that clone
    Then the resolved identity is owner "paysdoc" and repository "paysdoc.nl"

    Examples:
      | form                | remote                                    |
      | SSH, .git suffix    | git@github.com:paysdoc/paysdoc.nl.git     |
      | SSH, no suffix      | git@github.com:paysdoc/paysdoc.nl         |
      | HTTPS, .git suffix  | https://github.com/paysdoc/paysdoc.nl.git |
      | HTTPS, no suffix    | https://github.com/paysdoc/paysdoc.nl     |

  # ── §2 The rest of the dotted family ─────────────────────────────────────────
  #
  # RED today, in two distinct ways. The first three truncate at the first dot
  # (`a`, `paysdoc`, `paysdoc`). The leading-dot row does not truncate — it fails
  # to parse at all and the resolver throws, because `([^/.]+)` needs at least one
  # non-dot character immediately after the slash. Both symptoms are the same root
  # cause, and the leading-dot row is what separates a real fix from a
  # split-on-first-dot fix.

  @adw-779 @adw-uds89n-readlocalrepoinfo-tr
  Scenario Outline: A dotted repository name of any shape resolves in full (<shape>)
    Given a local clone whose origin remote is "<remote>"
    When the local repository identity is read from that clone
    Then the resolved identity is owner "paysdoc" and repository "<repo>"

    Examples:
      | shape                      | remote                                          | repo              |
      | multiple dots              | git@github.com:paysdoc/a.b.c.git                | a.b.c             |
      | GitHub Pages name          | git@github.com:paysdoc/paysdoc.github.io.git    | paysdoc.github.io |
      | HTTPS with trailing slash  | https://github.com/paysdoc/paysdoc.nl/          | paysdoc.nl        |
      | leading dot (org profile)  | git@github.com:paysdoc/.github.git              | .github           |

  # ── §3 Guard — no regression on any other remote form ────────────────────────
  #
  # GREEN today and must stay GREEN. Widening the repo group is what makes this
  # fix risky: a dot-tolerant group can start swallowing the `.git` suffix, a
  # trailing slash, or a credential prefix. All seven rows are remote shapes ADW
  # actually encounters, including the `x-access-token:` form produced by App-token
  # pushes and the `ssh://` scheme form git emits for some clones (which parses
  # through the HTTPS branch, since it contains `github.com/`).
  #
  # The trailing-slash row is the sharp one: a literal transcription of the issue's
  # suggested HTTPS pattern returns `webapp/` here. The issue's own parenthetical
  # asks for slash tolerance; this row is what makes that non-optional.

  @adw-779 @adw-uds89n-readlocalrepoinfo-tr
  Scenario Outline: A dot-free repository name still resolves unchanged (<form>)
    Given a local clone whose origin remote is "<remote>"
    When the local repository identity is read from that clone
    Then the resolved identity is owner "acme" and repository "webapp"

    Examples:
      | form                       | remote                                              |
      | SSH, .git suffix           | git@github.com:acme/webapp.git                      |
      | SSH, no suffix             | git@github.com:acme/webapp                          |
      | HTTPS, .git suffix         | https://github.com/acme/webapp.git                  |
      | HTTPS, no suffix           | https://github.com/acme/webapp                      |
      | HTTPS, trailing slash      | https://github.com/acme/webapp/                     |
      | HTTPS with App credentials | https://x-access-token:TOK@github.com/acme/webapp.git |
      | ssh:// scheme form         | ssh://git@github.com/acme/webapp.git                |

  # ── §4 Guard — one parse behind both cwd-derived entry points ────────────────
  #
  # `readLocalRepoInfo` and `getRepoInfo` are the two functions the git/gh guard
  # recognises as legitimate cwd-derived identity reads, and `getRepoInfo`
  # delegates to `readLocalRepoInfo`. Both truncate today, so both must agree
  # after the fix — this fails if the parse is corrected at one call site instead
  # of in the shared implementation.

  @adw-779 @adw-uds89n-readlocalrepoinfo-tr
  Scenario: Both cwd-derived identity entry points read the dotted clone identically
    Given a local clone whose origin remote is "git@github.com:paysdoc/paysdoc.nl.git"
    When the local repository identity is read from that clone through both cwd-derived entry points
    Then both cwd-derived entry points resolve the identity to owner "paysdoc" and repository "paysdoc.nl"

  # ── §5 The crash surface — what the token mint is actually asked about ───────
  #
  # The reported symptom, one composition step downstream: the identity read from
  # the clone is handed to the App token mint, whose (owner, repo) arguments become
  # the path segments of `/repos/{owner}/{repo}/installation`. RED today — the
  # recorded mint targets `paysdoc/paysdoc`, the repository that does not exist,
  # which is why the upgrade gate can never pass for this repo. The second Then
  # names the truncated slug explicitly so the scenario reports the actual defect
  # rather than a bare inequality.

  @adw-779 @adw-uds89n-readlocalrepoinfo-tr
  Scenario: The App installation-token mint is requested for the full dotted repository, never the truncated one
    Given a local clone whose origin remote is "git@github.com:paysdoc/paysdoc.nl.git"
    When an App installation token is minted for the identity read from that clone
    Then the recorded installation-token mint targets the repository "paysdoc/paysdoc.nl"
    And no installation-token mint targets the repository "paysdoc/paysdoc"

  # ── §6 Guard — a non-GitHub remote still fails loudly ────────────────────────
  #
  # GREEN today and must stay GREEN. Returning a fabricated identity for an
  # unrecognised remote is the wrong-repo failure mode this package exists to
  # prevent, and §2's leading-dot requirement pushes the pattern towards
  # permissiveness. Loud failure is the only acceptable outcome here.

  @adw-779 @adw-uds89n-readlocalrepoinfo-tr
  Scenario Outline: A non-GitHub origin remote raises instead of yielding a fabricated identity (<host>)
    Given a local clone whose origin remote is "<remote>"
    When reading the local repository identity from that clone is attempted
    Then reading the local repository identity fails loudly rather than returning an identity

    Examples:
      | host      | remote                                |
      | GitLab    | https://gitlab.com/acme/webapp.git    |
      | Bitbucket | git@bitbucket.org:acme/webapp.git     |

  # ── §7 Type-check backstop ───────────────────────────────────────────────────

  @adw-779 @adw-uds89n-readlocalrepoinfo-tr
  Scenario: TypeScript type-check passes after the dotted-repo-name parsing fix
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
