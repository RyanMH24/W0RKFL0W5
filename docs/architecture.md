# Architecture

## System view

```mermaid
flowchart LR
  HR["HR system / form<br/>(Workday, BambooHR, ...)"] -- "POST /webhook/onboard<br/>POST /webhook/offboard<br/>X-W0RKFL0W5-Secret" --> N8N

  subgraph Stack["docker compose"]
    N8N["n8n main<br/>webhooks + orchestration"]
    RUN["n8n task runners<br/>(Code nodes, isolated)"]
    PG[("Postgres<br/>workflows, encrypted credentials,<br/>execution history")]
    N8N <--> RUN
    N8N <--> PG
  end

  REPO["git repo<br/>workflows/*.json<br/>config/access-policy.json"] -- "bootstrap.mjs on start:<br/>import + publish" --> N8N
  N8N -- "SSWS token" --> OKTA["Okta<br/>users, groups, sessions"]
  N8N -- "Basic (email + API token)" --> JIRA["Jira<br/>setup / audit / incident tickets"]
  N8N -- "Bot token" --> SLACK["Slack<br/>announcements, manager DM, IT alerts"]
```

In development and CI, Okta, Slack, and Jira are replaced by `mocks/server.mjs` (see [ADR 0005](adr/0005-contract-mocks-for-ci.md)).

## Onboarding

```mermaid
sequenceDiagram
  autonumber
  participant HR as HR system
  participant W as n8n: Onboarding
  participant O as Okta
  participant J as Jira
  participant S as Slack
  HR->>W: POST /webhook/onboard {employeeId, name, dept, manager, startDate}
  W->>W: Load config + access policy, validate (400 with all errors if invalid)
  W->>O: GET /users/{login}
  alt 404: new hire
    W->>O: POST /users?activate=false (STAGED)
  end
  loop each group in baseline + department policy
    W->>O: GET /groups?q=name (exact match required)
    W->>O: PUT /groups/{g}/users/{u} (idempotent)
  end
  W->>J: JQL search label w0rkfl0w5-onboard-{employeeId}
  alt no ticket yet
    W->>J: Create setup ticket (checklist + what was automated)
    W->>S: Announce in #it-onboarding
    W->>S: DM the manager (if they're on Slack)
    W-->>HR: 201 onboarded
  else ticket exists (replay)
    W-->>HR: 200 already_onboarded
  end
```

## Offboarding

```mermaid
sequenceDiagram
  autonumber
  participant HR as HR system
  participant W as n8n: Offboarding
  participant O as Okta
  participant J as Jira
  participant S as Slack
  HR->>W: POST /webhook/offboard {employeeId, workEmail, requestedBy, reason}
  W->>O: GET /users/{login}
  alt not found
    W-->>HR: 404
  else already DEPROVISIONED
    W-->>HR: 200 already_offboarded
  else active or staged
    W->>O: GET /users/{id}/groups (snapshot)
    W->>J: Create audit ticket with the access snapshot (unless one exists)
    W->>O: DELETE /users/{id}/sessions?oauthTokens=true
    W->>O: POST /users/{id}/lifecycle/deactivate
    W->>S: Alert #it-alerts with the ticket link
    W-->>HR: 200 offboarded
  end
```

Order of operations is deliberate; see [ADR 0006](adr/0006-offboarding-order-of-operations.md).

## Failure handling

```mermaid
flowchart LR
  A["Any node fails<br/>(after 3 retries for HTTP)"] --> B["Caller gets 5xx"]
  A --> C["Error handler workflow"]
  C --> D["Jira incident<br/>(workflow, failed node, error, execution link)"]
  D --> E["Slack #it-alerts<br/>with incident + execution links"]
```

- Every HTTP Request node retries 3 times, 1 second apart.
- Slack returns errors as HTTP 200 with `ok: false`; the onboarding announce step checks for that explicitly and fails the run if Slack rejected it.
- Non-critical steps (manager DM, offboarding Slack alert) continue on error and report the outcome in the response instead of failing the run.
- The error handler creates the Jira incident with "continue on error", so the Slack alert still goes out if Jira is the thing that's down.

## Repository layout

| Path | Purpose |
|---|---|
| `workflows/` | n8n workflow JSON, the source of truth ([ADR 0002](adr/0002-workflows-as-code.md)) |
| `config/access-policy.json` | Role-based access: baseline + per-department Okta groups |
| `scripts/bootstrap.mjs` | n8n entrypoint: writes runtime config, imports credentials and workflows, publishes, starts |
| `scripts/validate-workflows.mjs` | Static checks enforced in CI |
| `scripts/e2e.mjs` | End-to-end scenarios against the running stack |
| `mocks/` | Contract mocks for Okta, Slack, and Jira |
| `tests/` | Unit tests for the mocks, policy guardrails, and validator |
| `docs/adr/` | Architecture decision records |
