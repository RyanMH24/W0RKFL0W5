## What and why

<!-- What does this change, and what problem does it solve? Link the issue or ticket. -->

## How it was tested

- [ ] `npm run validate` and `npm test` pass
- [ ] `npm run e2e` passes against `docker compose up` (CI runs this too)
- [ ] Tried against real Okta/Slack/Jira (if the change touches an API call)

## Checklist

- [ ] Workflows edited in the n8n UI were exported back to `workflows/`
- [ ] No secrets, tokens, or real employee data in the diff
- [ ] Access policy changes reviewed by IT Security (`config/access-policy.json`)
- [ ] New architecture decision? Added an ADR in `docs/adr/`
