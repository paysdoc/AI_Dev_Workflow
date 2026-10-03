@regression @webhook
Feature: The webhook ensures a cron for the repository of every accepted event

  Auto-merge happens only when a cron polls the repository (`trigger_cron.ts`). The webhook does
  not run `adwMerge` on an approved review; it relies on that repository's cron to sweep
  `awaiting_merge` issues. So `dispatchWebhookEvent` calls `ensureCronProcess` for every delivery
  that passes the signature and JSON checks and names a repository, before it branches on the
  event. When only some branches did this, an approved review could leave its repository with no
  cron and its pull request waiting in `awaiting_merge` indefinitely. `ensureCronProcess` launches
  nothing when the repository's cron is already alive, and a rejected delivery launches nothing.

  Each scenario drives the real exported `dispatchWebhookEvent` in-process, with a fake request
  and response and a fake per-event boundary, so no provider is ever minted. The shared launch
  recorder puts a `bunx` shadow on `PATH` for the dispatch; it records the argv of every launch and
  exits at once. A cron launch is a record naming `adws/triggers/trigger_cron.ts` and
  `--target-repo <repository>`. Every assertion targets the response the dispatcher wrote or the
  launches the recorder captured; no step reads a source file.

  Not covered here: ordering against `ensureAppAuthForRepo`, which the dispatcher no longer calls;
  `/health`, 404 and 405, which the HTTP listener answers before dispatch (`/health` runs a real
  `claude -p` probe); and `issues` opened/closed and `pull_request` closed, which hand work to a
  provider.

  Background:
    Given the ADW codebase is checked out
    And no cron is running for the repository "acme/widgets"

  Scenario: An approved review launches exactly one cron, for its repository, and nothing else
    Given the webhook secret is set to "adw-regression-webhook-secret"
    When the webhook receives an approved review from the repository "acme/widgets", signed with the secret "adw-regression-webhook-secret"
    Then the webhook answers 200 with the status "ignored"
    And exactly one cron is launched, for the repository "acme/widgets"
    And nothing other than that cron is launched

  Scenario Outline: A "<event>" event with the action "<action>" launches a cron for its repository
    When the webhook receives a "<event>" event with the action "<action>" from the repository "acme/widgets"
    Then the webhook answers 200 with the status "ignored"
    And exactly one cron is launched, for the repository "acme/widgets"

    Examples:
      | event                       | action    |
      | pull_request_review         | dismissed |
      | pull_request_review_comment | edited    |
      | pull_request                | opened    |
      | issue_comment               | created   |
      | issues                      | edited    |
      | check_run                   | completed |

  Scenario: A cron that is already running for the repository is left alone
    Given a cron is already running for the repository "acme/widgets"
    When the webhook receives an approved review from the repository "acme/widgets"
    Then the webhook answers 200 with the status "ignored"
    And no cron is launched
    And the cron that was already running is still the one registered for the repository "acme/widgets"

  Scenario: A delivery with a wrong signature is answered 401 and launches no cron
    Given the webhook secret is set to "adw-regression-webhook-secret"
    When the webhook receives an approved review from the repository "acme/widgets", signed with the secret "not-the-webhook-secret"
    Then the webhook answers 401 with the error "invalid signature"
    And no cron is launched

  Scenario: A delivery whose body is not valid JSON is answered 400 and launches no cron
    When the webhook receives a "pull_request_review" delivery whose body is not valid JSON
    Then the webhook answers 400 with the error "invalid json"
    And no cron is launched

  Scenario: An event that names no repository is answered 200 and launches no cron
    When the webhook receives an approved review that names no repository
    Then the webhook answers 200 with the status "ignored"
    And no cron is launched
