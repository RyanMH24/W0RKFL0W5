import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, TOKENS } from "../mocks/server.mjs";

let server;
let base;

const okta = (path, init = {}) =>
  fetch(`${base}/okta${path}`, {
    ...init,
    headers: { Authorization: `SSWS ${TOKENS.okta}`, "Content-Type": "application/json", ...init.headers },
  });
const slack = (path, init = {}) =>
  fetch(`${base}/slack${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKENS.slack}`, "Content-Type": "application/json", ...init.headers },
  });
const jiraAuth = `Basic ${Buffer.from(`${TOKENS.jiraEmail}:${TOKENS.jiraToken}`).toString("base64")}`;
const jira = (path, init = {}) =>
  fetch(`${base}/jira${path}`, {
    ...init,
    headers: { Authorization: jiraAuth, "Content-Type": "application/json", ...init.headers },
  });

const newHire = { firstName: "Ada", lastName: "Park", email: "ada.park@example.com", login: "ada.park@example.com" };

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => fetch(`${base}/__reset`, { method: "POST" }));

test("okta rejects a bad token like the real API", async () => {
  const res = await fetch(`${base}/okta/api/v1/users/someone`, { headers: { Authorization: "SSWS wrong" } });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).errorCode, "E0000011");
});

test("okta creates a staged user, then finds it by login", async () => {
  const created = await okta("/api/v1/users?activate=false", { method: "POST", body: JSON.stringify({ profile: newHire }) });
  assert.equal(created.status, 200);
  const user = await created.json();
  assert.equal(user.status, "STAGED");

  const found = await okta(`/api/v1/users/${encodeURIComponent(newHire.login)}`);
  assert.equal((await found.json()).id, user.id);
});

test("okta refuses a duplicate login", async () => {
  await okta("/api/v1/users", { method: "POST", body: JSON.stringify({ profile: newHire }) });
  const dup = await okta("/api/v1/users", { method: "POST", body: JSON.stringify({ profile: newHire }) });
  assert.equal(dup.status, 400);
});

test("okta returns 404 E0000007 for an unknown user", async () => {
  const res = await okta("/api/v1/users/nobody%40example.com");
  assert.equal(res.status, 404);
  assert.equal((await res.json()).errorCode, "E0000007");
});

test("okta group search, membership, and the user's group list agree", async () => {
  const user = await (await okta("/api/v1/users", { method: "POST", body: JSON.stringify({ profile: newHire }) })).json();
  const [group] = await (await okta("/api/v1/groups?q=VPN%20Users")).json();
  assert.equal(group.profile.name, "VPN Users");

  assert.equal((await okta(`/api/v1/groups/${group.id}/users/${user.id}`, { method: "PUT" })).status, 204);
  // PUT is idempotent.
  assert.equal((await okta(`/api/v1/groups/${group.id}/users/${user.id}`, { method: "PUT" })).status, 204);

  const groups = await (await okta(`/api/v1/users/${user.id}/groups`)).json();
  assert.deepEqual(groups.map((g) => g.profile.name), ["VPN Users"]);
});

test("okta deactivation moves the user to DEPROVISIONED and cannot repeat", async () => {
  const user = await (await okta("/api/v1/users", { method: "POST", body: JSON.stringify({ profile: newHire }) })).json();
  assert.equal((await okta(`/api/v1/users/${user.id}/sessions`, { method: "DELETE" })).status, 204);
  assert.equal((await okta(`/api/v1/users/${user.id}/lifecycle/deactivate`, { method: "POST" })).status, 200);
  assert.equal((await (await okta(`/api/v1/users/${user.id}`)).json()).status, "DEPROVISIONED");
  assert.equal((await okta(`/api/v1/users/${user.id}/lifecycle/deactivate`, { method: "POST" })).status, 403);
});

test("slack looks up seeded users by email and reports misses the way Slack does", async () => {
  const hit = await (await slack("/api/users.lookupByEmail?email=dana.lee%40example.com")).json();
  assert.deepEqual([hit.ok, hit.user.id], [true, "U0MANAGER1"]);
  const miss = await (await slack("/api/users.lookupByEmail?email=ghost%40example.com")).json();
  assert.deepEqual(miss, { ok: false, error: "users_not_found" });
});

test("slack returns ok:false with HTTP 200 on bad auth", async () => {
  const res = await fetch(`${base}/slack/api/chat.postMessage`, { method: "POST", body: "{}" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).error, "invalid_auth");
});

test("jira creates issues with sequential keys and finds them by label", async () => {
  const fields = { project: { key: "IT" }, issuetype: { name: "Task" }, summary: "Onboard Ada", labels: ["w0rkfl0w5-onboard-E1"] };
  const first = await (await jira("/rest/api/2/issue", { method: "POST", body: JSON.stringify({ fields }) })).json();
  assert.equal(first.key, "IT-1");

  const search = await (await jira(`/rest/api/3/search/jql?jql=${encodeURIComponent('labels = "w0rkfl0w5-onboard-E1"')}`)).json();
  assert.deepEqual(search.issues.map((i) => i.key), ["IT-1"]);
  const none = await (await jira(`/rest/api/3/search/jql?jql=${encodeURIComponent('labels = "other"')}`)).json();
  assert.equal(none.issues.length, 0);
});

test("injected faults fire the requested number of times and are recorded as calls", async () => {
  await fetch(`${base}/__faults`, { method: "POST", body: JSON.stringify({ service: "okta", pathIncludes: "/groups", status: 503, times: 1 }) });
  assert.equal((await okta("/api/v1/groups?q=VPN")).status, 503);
  assert.equal((await okta("/api/v1/groups?q=VPN")).status, 200);

  const calls = await (await fetch(`${base}/__calls`)).json();
  assert.equal(calls.filter((c) => c.path === "/api/v1/groups").length, 2);
});
