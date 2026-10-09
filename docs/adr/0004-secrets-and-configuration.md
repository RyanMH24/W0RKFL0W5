# ADR 0004: Secrets in n8n credentials, config in a generated file, env access blocked

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

The workflows need API tokens (secret) and per-environment settings such as base URLs, the Jira project, and Slack channels (not secret). The easy path, letting workflows read environment variables with `$env`, would also let any workflow expression read `N8N_ENCRYPTION_KEY` and the database password. n8n 2.x blocks env access in nodes by default for this reason.

## Decision

- **Secrets** come from `.env` (never committed) and are imported by `scripts/bootstrap.mjs` as n8n credentials, which n8n encrypts at rest with `N8N_ENCRYPTION_KEY`. The temporary plaintext file is deleted immediately. Workflows reference credentials by fixed ID; tokens never appear in workflow JSON.
- **Non-secret config** is written by the bootstrap to `~/.n8n-files/w0rkfl0w5.json` (the only directory n8n lets nodes read) together with the access policy, and each workflow loads it as its first step.
- `N8N_BLOCK_ENV_ACCESS_IN_NODE` stays at its secure default. The validator fails any Code node that references `$env` or `process.env`, and any workflow containing something that looks like a token.
- Inbound webhooks require a shared secret header (`X-W0RKFL0W5-Secret`), stored as an n8n credential.

## Consequences

- Rotating a token means updating `.env` and restarting; no workflow changes.
- Switching from the mocks to real Okta/Slack/Jira is a `.env` change only.
- A shared secret is the minimum bar. In production, put n8n behind an internal load balancer or VPN and consider HMAC-signed requests from the HR system.
