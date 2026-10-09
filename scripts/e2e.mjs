// End-to-end test: drives the real n8n workflows over HTTP and asserts what
// they did to the mock Okta, Slack, and Jira. Expects the stack from
// `docker compose up` (or any n8n wired to mocks/server.mjs).
//
//   N8N_URL         default http://localhost:5678
//   MOCKS_URL       default http://localhost:4010
//   WEBHOOK_SECRET  default the value in .env.example
import { test, before } from "node:test";
import assert from "node:assert/strict";

const N8N_URL = process.env.N8N_URL ?? "http://localhost:5678";
const MOCKS_URL = process.env.MOCKS_URL ?? "http://localhost:4010";
const SECRET = process.env.WEBHOOK_SECRET ?? "change-me-local-webhook-secret";

const hire = {
  employeeId: "E1001",
  firstName: "Ada",
  lastName: "Park",
  workEmail: "Ada.Park@example.com",
  department: "Engineering",
  title: "Software Engineer",
  managerEmail: "dana.lee@example.com",
  startDate: "2026-11-02",
};
const leaver = { employeeId: "E1001", workEmail: "ada.park@example.com", requestedBy: "hr@example.com", reason: "Resigned" };

async function call(path, body, { secret = SECRET } = {}) {
  const res = await fetch(`${N8N_URL}/webhook/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret ? { "X-W0RKFL0W5-Secret": secret } : {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

const mocks = async (path, init) => (await fetch(`${MOCKS_URL}${path}`, init)).json();
const state = () => mocks("/__state");
const calls = () => mocks("/__calls");
const reset = () => mocks("/__reset", { method: "POST" });
const fault = (f) => mocks("/__faults", { method: "POST", body: JSON.stringify(f) });
const slackMessages = async () => (await calls()).filter((c) => c.service === "slack" && c.path === "/api/chat.postMessage");

async function waitFor(check, { timeoutMs = 20000, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

before(async () => {
  await waitFor(async () => (await fetch(`${N8N_URL}/healthz`).catch(() => ({ ok: false }))).ok, { timeoutMs: 120000, label: "n8n /healthz" });
  await reset();
});

test("webhooks reject requests without the shared secret", async () => {
  const res = await call("onboard", hire, { secret: null });
  assert.ok([401, 403].includes(res.status), `expected 401/403, got ${res.status}`);
  assert.equal((await calls()).length, 0, "nothing should reach Okta, Slack, or Jira");
});

test("onboarding rejects an invalid request with every problem listed", async () => {
  const res = await call("onboard", { ...hire, workEmail: "not-an-email", department: "Marketing", startDate: undefined });
  assert.equal(res.status, 400);
  assert.equal(res.body.status, "invalid_request");
  assert.equal(res.body.errors.length, 3, JSON.stringify(res.body.errors));
  assert.equal((await calls()).length, 0);
});

test("onboarding stages the Okta user, grants policy groups, opens a ticket, and notifies Slack", async () => {
  const res = await call("onboard", hire);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.status, "onboarded");
  assert.equal(res.body.okta.created, true);
  assert.deepEqual(res.body.okta.groups, ["All Employees", "Engineering", "GitHub Users", "VPN Users"]);
  assert.match(res.body.jira.key, /^IT-\d+$/);
  assert.deepEqual(res.body.slack, { announced: true, managerNotified: true });

  const s = await state();
  const user = s.users.find((u) => u.profile.login === "ada.park@example.com");
  assert.equal(user.status, "STAGED");
  assert.equal(user.profile.employeeNumber, "E1001");
  for (const group of res.body.okta.groups) assert.ok(s.groups[group].includes(user.id), `missing ${group}`);
  assert.equal(s.groups["IT Admins"].length, 0, "no privileged groups for Engineering");

  const [issue] = s.issues;
  assert.ok(issue.fields.labels.includes("w0rkfl0w5-onboard-E1001"));
  assert.match(issue.fields.description, /Okta groups: All Employees, Engineering/);

  const messages = await slackMessages();
  assert.deepEqual(messages.map((m) => m.body.channel), ["#it-onboarding", "U0MANAGER1"]);
  assert.match(messages[0].body.text, new RegExp(res.body.jira.key));
});

test("replaying the same onboarding is safe: no duplicate user, ticket, or Slack spam", async () => {
  const before = { issues: (await state()).issues.length, slack: (await slackMessages()).length };
  const res = await call("onboard", hire);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, "already_onboarded");
  assert.equal(res.body.okta.created, false);

  const s = await state();
  assert.equal(s.users.length, 1);
  assert.equal(s.issues.length, before.issues);
  assert.equal((await slackMessages()).length, before.slack);
});

test("offboarding snapshots access to Jira, then revokes sessions and deactivates in that order", async () => {
  const res = await call("offboard", leaver);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, "offboarded");
  assert.deepEqual(res.body.okta.groupsAtOffboarding.sort(), ["All Employees", "Engineering", "GitHub Users", "VPN Users"]);

  const s = await state();
  assert.equal(s.users[0].status, "DEPROVISIONED");
  const audit = s.issues.find((i) => i.fields.labels.includes("w0rkfl0w5-offboard-E1001"));
  assert.match(audit.fields.description, /\* VPN Users/);

  const okta = (await calls()).filter((c) => c.service === "okta").map((c) => `${c.method} ${c.path}`);
  const jiraCreate = (await calls()).findIndex((c) => c.service === "jira" && c.method === "POST" && c.body?.fields?.labels?.includes("offboarding"));
  const sessions = (await calls()).findIndex((c) => c.method === "DELETE" && c.path.endsWith("/sessions"));
  const deactivate = (await calls()).findIndex((c) => c.path.endsWith("/lifecycle/deactivate"));
  assert.ok(okta.some((c) => c.endsWith("/groups")), "groups listed for the audit");
  assert.ok(jiraCreate < sessions && sessions < deactivate, "audit ticket → revoke sessions → deactivate");

  const alerts = (await slackMessages()).filter((m) => m.body.channel === "#it-alerts");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].body.text, /Offboarded \*Ada Park\*/);
});

test("replaying an offboarding is a no-op", async () => {
  const issuesBefore = (await state()).issues.length;
  const res = await call("offboard", leaver);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "already_offboarded");
  assert.equal((await state()).issues.length, issuesBefore);
});

test("offboarding an unknown user returns 404 and changes nothing", async () => {
  const issuesBefore = (await state()).issues.length;
  const res = await call("offboard", { ...leaver, employeeId: "E404", workEmail: "ghost@example.com" });
  assert.equal(res.status, 404);
  assert.equal((await state()).issues.length, issuesBefore);
});

test("an Okta outage is retried, then raises a Jira incident and a Slack alert", async () => {
  await reset();
  await fault({ service: "okta", pathIncludes: "/api/v1/groups", status: 503 });
  const res = await call("onboard", { ...hire, employeeId: "E2002", workEmail: "lin.cho@example.com", firstName: "Lin", lastName: "Cho" });
  assert.ok(res.status >= 500, `expected a 5xx, got ${res.status}`);

  const groupCalls = (await calls()).filter((c) => c.service === "okta" && c.path === "/api/v1/groups");
  // The node looks up all 4 policy groups per attempt and makes 3 attempts.
  assert.equal(groupCalls.length, 3 * 4, "HTTP node retries 3 times before giving up");

  const incident = await waitFor(async () => (await state()).issues.find((i) => i.fields.labels.includes("incident")), { label: "Jira incident" });
  assert.match(incident.fields.summary, /Okta: Find Group/);
  const alert = await waitFor(async () => (await slackMessages()).find((m) => m.body.channel === "#it-alerts"), { label: "Slack alert" });
  assert.match(alert.body.text, new RegExp(incident.key));
});
