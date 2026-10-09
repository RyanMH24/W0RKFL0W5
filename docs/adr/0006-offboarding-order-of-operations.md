# ADR 0006: Offboarding order of operations

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

Offboarding is the security-critical half of the lifecycle. Two requirements pull against each other: cut access fast, and keep an accurate record of what access the person had (for audits, legal holds, and app owners doing cleanup).

## Decision

1. **Snapshot first.** List the user's Okta groups and write them to a Jira audit ticket *before* changing anything.
2. **Revoke sessions and OAuth tokens** (`DELETE /users/{id}/sessions?oauthTokens=true`), so existing logins stop working immediately.
3. **Deactivate** the Okta user (`lifecycle/deactivate?sendEmail=false`). Deactivation, not deletion: it removes app access via provisioning while keeping the identity for audit and possible rehire. Hard deletion is a separate, later retention process.
4. **Alert IT in Slack** with the ticket link. A failed alert doesn't fail the run; the error is visible in the response (`slack.itAlerted: false`).

## Consequences

- If step 2 or 3 fails, the audit ticket already exists, and the error workflow raises an incident so a human finishes the job.
- Okta Integrator (free) tenants don't provision Slack or Google, so the ticket's checklist lists those as manual follow-ups. With SCIM-enabled apps, deactivation handles them automatically.
