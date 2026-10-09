# Running against real Okta, Slack, and Jira

All three have free tiers that are enough for a working demo. Budget about 15 minutes. Everything below goes into `.env`; nothing in the workflows changes.

## Okta (Integrator Free Plan)

1. Sign up at **developer.okta.com/signup**. You'll get an org URL like `https://integrator-1234567.okta.com`.
2. In the Admin Console, go to **Directory → Groups → Add group** and create every group named in `config/access-policy.json`:
   `All Employees`, `Engineering`, `GitHub Users`, `VPN Users`, `IT Admins`, `Jamf Admins`, `Sales`, `Salesforce Users`, `Finance`, `NetSuite Users`, `People Team`, `Workday Users`.
3. Go to **Security → API → Tokens → Create token**, name it `w0rkfl0w5`, and copy the value (shown once).

```dotenv
OKTA_BASE_URL=https://integrator-1234567.okta.com
OKTA_API_TOKEN=<token>
```

> The token acts with the permissions of the admin who created it. In production, create it from a dedicated service account with a custom admin role scoped to user and group management.

## Slack (free workspace)

1. Create a workspace at **slack.com/get-started**, and create channels `#it-onboarding` and `#it-alerts`.
2. Go to **api.slack.com/apps → Create New App → From scratch** and pick your workspace.
3. Under **OAuth & Permissions → Bot Token Scopes**, add `chat:write`, `users:read`, and `users:read.email`.
4. Click **Install to Workspace** and copy the **Bot User OAuth Token** (`xoxb-…`).
5. In each channel, run `/invite @<your app name>`.

```dotenv
SLACK_API_URL=https://slack.com/api
SLACK_BOT_TOKEN=xoxb-<token>
SLACK_ONBOARDING_CHANNEL=#it-onboarding
SLACK_IT_ALERTS_CHANNEL=#it-alerts
```

To see the manager DM, use your own Slack email as `managerEmail` in the onboarding request.

## Jira Cloud (free)

1. Sign up at **atlassian.com/software/jira/free** and create a project with the key `IT` (any template with a **Task** issue type).
2. Create an API token at **id.atlassian.com/manage-profile/security/api-tokens**.

```dotenv
JIRA_BASE_URL=https://<your-site>.atlassian.net
JIRA_BROWSE_URL=https://<your-site>.atlassian.net
JIRA_EMAIL=<the email you log in with>
JIRA_API_TOKEN=<token>
JIRA_PROJECT_KEY=IT
JIRA_ISSUE_TYPE=Task
```

## Switch over

1. In `.env`, delete the `COMPOSE_PROFILES=mocks` line (the mocks no longer start).
2. `docker compose up -d --force-recreate n8n`
3. Send a test hire:

```bash
curl -X POST http://localhost:5678/webhook/onboard \
  -H "Content-Type: application/json" \
  -H "X-W0RKFL0W5-Secret: <WEBHOOK_SECRET from .env>" \
  -d '{
    "employeeId": "E1001",
    "firstName": "Ada",
    "lastName": "Park",
    "workEmail": "ada.park@<a domain you own or example.com>",
    "department": "Engineering",
    "title": "Software Engineer",
    "managerEmail": "<your Slack email>",
    "startDate": "2026-11-02"
  }'
```

You should see a STAGED user with four groups in Okta, a setup ticket in Jira, an announcement in `#it-onboarding`, and a DM from the bot. Then offboard them:

```bash
curl -X POST http://localhost:5678/webhook/offboard \
  -H "Content-Type: application/json" \
  -H "X-W0RKFL0W5-Secret: <WEBHOOK_SECRET>" \
  -d '{"employeeId": "E1001", "workEmail": "ada.park@<same domain>", "requestedBy": "you@example.com", "reason": "Demo"}'
```
