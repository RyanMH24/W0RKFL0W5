# ADR 0002: Workflows as code, with git as the source of truth

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

n8n stores workflows in its database, and anyone with editor access can change production behavior with a click. For automations that grant and revoke access, changes need review, history, and a way to roll back.

## Decision

- Workflow JSON lives in `workflows/` and is the source of truth.
- On every start, `scripts/bootstrap.mjs` imports the repo's workflows (overwriting the DB copy) and publishes them.
- Changes go through pull requests. CI runs `scripts/validate-workflows.mjs`, which enforces platform standards (authenticated webhooks, credentials instead of inline tokens, retries on every HTTP call, no hardcoded hosts, an error workflow on every webhook flow, no unreachable nodes, no secrets in the JSON), plus the e2e suite against a real n8n.
- Editing in the n8n UI is fine for prototyping, but the change must be exported back to `workflows/` and merged, or it's lost on the next restart.

## Consequences

- Every production change is reviewed, tested, and revertible with `git revert`.
- Drift is impossible to keep: a restart resets n8n to `main`.
- Workflow IDs and credential IDs are fixed strings so references survive re-imports.
- The validator encodes the team's standards, so reviewers spend time on logic instead of style.
