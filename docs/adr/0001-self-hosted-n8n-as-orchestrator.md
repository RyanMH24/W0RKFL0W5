# ADR 0001: Self-hosted n8n as the orchestration platform

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

Joiner/leaver automation touches several SaaS APIs (Okta, Slack, Jira) and has to be readable by the IT engineers who support it, not only the person who wrote it. The options considered:

| Option | Pros | Cons |
|---|---|---|
| **Okta Workflows** | Native to the IdP, no hosting | Okta-centric; weak version control and testing story; per-flow licensing |
| **Workato / Tray** | Mature connectors, managed | Expensive, closed, hard to run in CI |
| **Custom code** (Python/Node service) | Full control, easy to unit test | Every change needs a developer; no visual run history for support staff |
| **Temporal / Airflow** | Durable execution, great for long-running jobs | Heavy for request/response provisioning; still custom code per integration |
| **n8n, self-hosted** | Visual flows *and* JSON export; per-run execution history; runs in Docker and CI; fair-code license | We operate it ourselves (DB, upgrades, secrets) |

## Decision

Use **self-hosted n8n** (pinned version, Postgres, external task runners) as the orchestrator. Keep business logic in small Code nodes and API calls in HTTP Request nodes, so a flow reads top-to-bottom in the editor.

## Consequences

- Support engineers can open a failed execution and see exactly which step failed with which payload.
- We own uptime and upgrades. Versions are pinned in `docker-compose.yml` and bumped through Dependabot PRs that must pass the e2e suite.
- Long-running, multi-day processes (e.g. "activate the account on the start date") are a better fit for a scheduler or Temporal; they're out of scope here and noted as a follow-up.
