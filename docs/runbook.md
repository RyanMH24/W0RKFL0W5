# Runbook

## A run failed

You'll see a Jira ticket labeled `incident` and a `#it-alerts` message with two links: the incident and the n8n execution.

1. Open the **execution** link. The failed node is highlighted; its input and output show the exact request and response.
2. Fix the cause. Common ones:

   | Symptom | Likely cause | Fix |
   |---|---|---|
   | `Okta group "X" not found` | Policy names a group that doesn't exist in Okta | Create the group in Okta, or fix `config/access-policy.json` (PR) |
   | Okta `401 E0000011` | API token expired or revoked | Rotate `OKTA_API_TOKEN` (below) |
   | `Slack announce failed: not_in_channel` | Bot isn't a member of the channel | `/invite @<bot>` in the channel |
   | `Slack announce failed: channel_not_found` | Channel name in `.env` is wrong | Fix `SLACK_ONBOARDING_CHANNEL` and restart |
   | Jira `400` on create | Project key or issue type wrong, or `labels` not on the create screen | Fix `.env` or the Jira project's screen |
   | Retries exhausted, `5xx` | Vendor outage | Wait for the vendor status page to clear |

3. **Replay the original request.** Every workflow is idempotent ([ADR 0003](adr/0003-idempotent-replay-safe-provisioning.md)): steps that already succeeded are detected and skipped, and the rest complete.
4. Close the incident ticket with the cause.

## Replaying a request

```bash
curl -X POST http://localhost:5678/webhook/onboard \
  -H "Content-Type: application/json" \
  -H "X-W0RKFL0W5-Secret: $WEBHOOK_SECRET" \
  -d @request.json
```

The request body is also visible on the webhook node of the failed execution.

## Changing who gets what access

Edit `config/access-policy.json` in a PR. CI checks that every department grants at least one group, there are no duplicates, and admin groups are granted only to IT. After merge, restart n8n (`docker compose restart n8n`); the bootstrap rewrites the runtime config.

Changing the policy doesn't affect existing employees. To re-apply access for someone, replay their onboarding request; group adds are idempotent.

## Rotating a secret

1. Create the new token in Okta / Slack / Jira.
2. Update `.env`.
3. `docker compose up -d n8n` (recreates the container; the bootstrap re-imports credentials).
4. Revoke the old token.

`N8N_ENCRYPTION_KEY` is different: it encrypts stored credentials and must not change for an existing database. If you must rotate it, re-import credentials from `.env` afterwards (the bootstrap does this on start).

## Upgrading n8n

Dependabot opens a PR when a new n8n image is released. CI runs the full e2e suite against the new version. Read the n8n release notes for breaking changes, merge, then `docker compose pull && docker compose up -d`.

## Editing a workflow

1. Edit it in the n8n UI (http://localhost:5678) and test it with a manual execution.
2. **Workflow menu → Download**, and save over the file in `workflows/`.
3. `npm run validate && npm test`, then open a PR.

Changes made only in the UI are overwritten on the next restart ([ADR 0002](adr/0002-workflows-as-code.md)).
