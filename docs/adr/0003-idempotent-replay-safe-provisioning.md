# ADR 0003: Idempotent, replay-safe provisioning

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

HR systems retry webhooks, people click "submit" twice, and when a run fails partway through the fix is usually to run it again. A provisioning flow that creates duplicate accounts, duplicate tickets, or a second Slack announcement on replay can't be safely retried, which makes every failure a manual cleanup.

## Decision

Every step either checks before acting or is naturally idempotent:

| Step | How it stays safe on replay |
|---|---|
| Okta user | Look up by login first; create only on 404 |
| Okta groups | `PUT /groups/{g}/users/{u}` is idempotent, so a replay also repairs drift |
| Jira ticket | Search by a deterministic label (`w0rkfl0w5-onboard-<employeeId>`); create only if none |
| Slack messages | Sent only on the run that created the ticket |
| Offboarding | A `DEPROVISIONED` user short-circuits to `already_offboarded` |

The employee ID from the HR system is the correlation key throughout.

## Consequences

- The runbook answer to almost any failure is "fix the cause, replay the request" (see `docs/runbook.md`).
- Responses distinguish `onboarded` (201) from `already_onboarded` (200) so callers can tell what happened.
- Lookups add a few API calls per run; that's acceptable at onboarding volumes.
- If a replay happens after a *partial* offboarding (Okta deactivated but the Slack alert failed), the replay returns `already_offboarded` and the alert isn't re-sent. The Jira audit ticket is created before any destructive step, so the record still exists.
