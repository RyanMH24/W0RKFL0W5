# ADR 0005: Contract mocks for development and CI

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

End-to-end tests against live Okta, Slack, and Jira need real credentials in CI, create real accounts and tickets, are rate-limited, and can't easily simulate outages. Without e2e tests, though, a workflow can pass review and still fail on its first real run.

## Decision

`mocks/server.mjs` is a dependency-free service that implements exactly the endpoints the workflows call, with the real paths, auth schemes, status codes, and response shapes (Okta's `E0000007` 404s, Slack's HTTP-200-with-`ok:false` errors, Jira's v2 create and v3 JQL search). It also exposes test-only endpoints to inspect calls and state, reset, and inject faults.

CI starts the full stack (n8n, task runners, Postgres, mocks) with Docker Compose and runs `scripts/e2e.mjs`, which covers the happy paths, replays, validation, unknown users, auth, and an Okta outage that must trigger retries and the error workflow.

## Consequences

- Every PR proves the workflows run end-to-end on the pinned n8n version, in about two minutes, with no secrets.
- The mocks can drift from the real APIs. Mitigations: keep them minimal, unit-test their contracts (`tests/mocks.test.mjs`), and smoke-test against free developer tenants before releases (`docs/real-accounts.md`).
