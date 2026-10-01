---
status: accepted
date: 2026-03-04
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/issue-64-adw-permanent-webhook-ur-zqsq62-sdlc_planner-webhook-signature-and-portfolio.md
  - kind: contemporaneous
    source: specs/issue-0-adw-tsx-sdlc_planner-cloudflare-tunnel-script.md
  - kind: recalled
    source: "Martin Koster, 2026-09-29"
supersedes: []
superseded-by: []
---

# Webhook endpoint through a Cloudflare Tunnel, with signed payloads

## Context and Problem Statement

The webhook server runs on the operator's machine and GitHub must reach it. It was exposed through ngrok, whose public URL "resets on every restart", so the webhook of every registered repository had to be reconfigured by hand each time. The endpoint also had no signature validation: "any party that knows the URL can send forged payloads" (spec for #64).

The decision covers `adws/triggers/trigger_webhook.ts`, `adws/triggers/webhookSignature.ts`, `adws/triggers/cloudflareTunnel.tsx` and the Cloudflare setup for `paysdoc.nl`.

## Decision Drivers

* A URL that survives restarts.
* Reject payloads that do not come from GitHub.
* A tunnel points at one fixed local port; the server must not move silently.

## Considered Options

None recorded. The spec names ngrok only as the state being replaced.

## Decision Outcome

The webhook server is published at a permanent hostname through a Cloudflare Tunnel, and payloads are verified.

* A tunnel named `adw-webhook` forwards the public hostname to the local server on port 8001. `cloudflareTunnel.tsx` creates the tunnel, routes the hostname and runs `cloudflared` in the foreground; the spec for #64 also describes `cloudflared` as a launchd service.
* When `GITHUB_WEBHOOK_SECRET` is set, the server computes the HMAC-SHA256 of the raw body and compares it with the `x-hub-signature-256` header in constant time. A missing or wrong signature gets HTTP 401.
* When the secret is not set, validation is skipped and a warning is logged at start-up. The spec gives backward compatibility as the reason.
* When the secret is set and port 8001 is taken, start-up fails instead of falling back to a random port, because a fallback "would silently break the Cloudflare tunnel".
* The domain stays registered at its registrar; only the nameservers point to Cloudflare.

### Consequences

* Good, because the webhook URL in each repository is configured once.
* Good, because forged payloads are rejected when the secret is set.
* Bad, because ADW depends on Cloudflare and on a `cloudflared` process running on the host.
* Bad, because validation is opt-in: a host without the secret accepts any payload.
* Bad, because the presence of the secret doubles as the "tunnel mode" switch for the port rule. The two concerns cannot be set separately.

### Confirmation

Checked on 2026-09-29:

* `trigger_webhook.ts:130-133` calls `validateWebhookSignature` and answers 401; `resolveWebhookPort` (line 332) throws when the port is taken and the secret is set.
* `gh api repos/paysdoc/AI_Dev_Workflow/hooks` shows one active webhook, URL `https://adw.paysdoc.nl/webhook`, with a secret configured.
* `adw.paysdoc.nl` resolves.
* No test covers `validateWebhookSignature` or the port rule: a search for the function name under `adws/`, `test/` and `features/` finds only the two source files. The one test that mentions the secret (`features/per-issue/step_definitions/feature-908.steps.ts`) unsets it so that its unsigned payload is accepted. The tests planned in the spec for #64 are not in the repository.
* Not checked: whether `GITHUB_WEBHOOK_SECRET` is set on the host, and how `cloudflared` is kept running there.

## More Information

* Settled (owner, 2026-09-29): `adw.paysdoc.nl` is the endpoint. The spec for #64 names `api.paysdoc.nl`. The owner recalls, without certainty, that it was considered first and dropped for the more descriptive name.
* Accepted risk (owner, 2026-09-29): in `startServer`, the `EADDRINUSE` handler listens on a random port without testing for the secret. If the port is taken between the availability check and `listen`, the server moves even in tunnel mode.
* Unresolved: `cloudflareTunnel.tsx` creates a DNS route with `cloudflared tunnel route dns`. See [ADR-0030](0030-cloudflare-dns-managed-by-hand.md) on manually managed DNS. The owner was asked on 2026-09-29 whether the script or the manual-DNS rule is the decision and gave no ruling.
* What the server does with an accepted event is in [ADR-0012](0012-webhook-gatekeeper-cron-sweeper.md).
* The portfolio site in the same issue lives in another repository and is not part of this decision.
