// Fake Okta, Slack, and Jira APIs for local development and CI.
//
// Implements only the endpoints W0RKFL0W5 calls, with the same paths, auth
// schemes, and response shapes as the real services, so the n8n workflows
// run unchanged against either. Test-only endpoints live under /__:
//   GET  /__calls   every request received (method, service, path, body)
//   GET  /__state   current users, group memberships, and issues
//   POST /__reset   restore seed data and clear calls and faults
//   POST /__faults  { service, method?, pathIncludes?, status, times? }
import http from "node:http";
import { randomUUID } from "node:crypto";

export const TOKENS = {
  okta: process.env.MOCK_OKTA_TOKEN ?? "mock-okta-token",
  slack: process.env.MOCK_SLACK_TOKEN ?? "xoxb-mock-slack-token",
  jiraEmail: process.env.MOCK_JIRA_EMAIL ?? "it-bot@example.com",
  jiraToken: process.env.MOCK_JIRA_TOKEN ?? "mock-jira-token",
};

const SEED_GROUPS = [
  "All Employees", "Engineering", "GitHub Users", "VPN Users", "IT Admins", "Jamf Admins",
  "Sales", "Salesforce Users", "Finance", "NetSuite Users", "People Team", "Workday Users",
];

const SEED_SLACK_USERS = [
  { id: "U0MANAGER1", email: "dana.lee@example.com", name: "dana.lee" },
  { id: "U0MANAGER2", email: "sam.rivera@example.com", name: "sam.rivera" },
];

export function createState() {
  const groups = new Map(
    SEED_GROUPS.map((name, i) => [`00g${String(i + 1).padStart(17, "0")}`, { name, members: new Set() }]),
  );
  return { users: new Map(), groups, issues: [], calls: [], faults: [], nextIssue: 1 };
}

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
};

const oktaError = (res, status, code, summary) =>
  json(res, status, { errorCode: code, errorSummary: summary, errorId: randomUUID(), errorCauses: [] });

function authorized(service, headers) {
  const auth = headers.authorization ?? "";
  if (service === "okta") return auth === `SSWS ${TOKENS.okta}`;
  if (service === "slack") return auth === `Bearer ${TOKENS.slack}`;
  if (service === "jira") {
    const expected = Buffer.from(`${TOKENS.jiraEmail}:${TOKENS.jiraToken}`).toString("base64");
    return auth === `Basic ${expected}`;
  }
  return true;
}

function findUser(state, idOrLogin) {
  const needle = decodeURIComponent(idOrLogin).toLowerCase();
  for (const user of state.users.values()) {
    if (user.id === idOrLogin || user.profile.login.toLowerCase() === needle) return user;
  }
  return null;
}

function publicUser(user) {
  const { id, status, created, profile } = user;
  return { id, status, created, profile };
}

function handleOkta(state, method, path, query, body, res) {
  let m;
  if (method === "POST" && path === "/api/v1/users") {
    const profile = body?.profile ?? {};
    if (!profile.login || !profile.email || !profile.firstName || !profile.lastName) {
      return oktaError(res, 400, "E0000001", "Api validation failed: profile");
    }
    if (findUser(state, profile.login)) {
      return oktaError(res, 400, "E0000001", "Api validation failed: login: An object with this field already exists");
    }
    const user = {
      id: `00u${randomUUID().replace(/-/g, "").slice(0, 17)}`,
      status: query.get("activate") === "true" ? "ACTIVE" : "STAGED",
      created: new Date().toISOString(),
      profile,
      sessions: 0,
    };
    state.users.set(user.id, user);
    return json(res, 200, publicUser(user));
  }
  if ((m = path.match(/^\/api\/v1\/users\/([^/]+)$/)) && method === "GET") {
    const user = findUser(state, m[1]);
    return user ? json(res, 200, publicUser(user)) : oktaError(res, 404, "E0000007", `Not found: Resource not found: ${m[1]} (User)`);
  }
  if ((m = path.match(/^\/api\/v1\/users\/([^/]+)\/groups$/)) && method === "GET") {
    const user = findUser(state, m[1]);
    if (!user) return oktaError(res, 404, "E0000007", "Not found: Resource not found (User)");
    const list = [...state.groups].filter(([, g]) => g.members.has(user.id)).map(([id, g]) => ({ id, profile: { name: g.name } }));
    return json(res, 200, list);
  }
  if ((m = path.match(/^\/api\/v1\/users\/([^/]+)\/sessions$/)) && method === "DELETE") {
    const user = findUser(state, m[1]);
    if (!user) return oktaError(res, 404, "E0000007", "Not found: Resource not found (User)");
    user.sessions = 0;
    return json(res, 204);
  }
  if ((m = path.match(/^\/api\/v1\/users\/([^/]+)\/lifecycle\/deactivate$/)) && method === "POST") {
    const user = findUser(state, m[1]);
    if (!user) return oktaError(res, 404, "E0000007", "Not found: Resource not found (User)");
    if (user.status === "DEPROVISIONED") return oktaError(res, 403, "E0000038", "This operation is not allowed in the user's current status.");
    user.status = "DEPROVISIONED";
    return json(res, 200, {});
  }
  if (path === "/api/v1/groups" && method === "GET") {
    const q = (query.get("q") ?? "").toLowerCase();
    const list = [...state.groups]
      .filter(([, g]) => g.name.toLowerCase().startsWith(q))
      .map(([id, g]) => ({ id, type: "OKTA_GROUP", profile: { name: g.name } }));
    return json(res, 200, list);
  }
  if ((m = path.match(/^\/api\/v1\/groups\/([^/]+)\/users\/([^/]+)$/)) && method === "PUT") {
    const group = state.groups.get(m[1]);
    const user = state.users.get(m[2]);
    if (!group || !user) return oktaError(res, 404, "E0000007", "Not found: Resource not found");
    group.members.add(user.id);
    return json(res, 204);
  }
  return oktaError(res, 404, "E0000022", `The endpoint does not support the provided HTTP method (${method} ${path})`);
}

function handleSlack(state, method, path, query, body, res) {
  if (path === "/api/users.lookupByEmail") {
    const email = (query.get("email") ?? body?.email ?? "").toLowerCase();
    const user = SEED_SLACK_USERS.find((u) => u.email === email);
    return json(res, 200, user ? { ok: true, user: { id: user.id, name: user.name, profile: { email: user.email } } } : { ok: false, error: "users_not_found" });
  }
  if (path === "/api/chat.postMessage" && method === "POST") {
    if (!body?.channel || !(body.text || body.blocks)) return json(res, 200, { ok: false, error: "invalid_arguments" });
    return json(res, 200, { ok: true, channel: body.channel, ts: `${Date.now() / 1000}`, message: { text: body.text } });
  }
  return json(res, 200, { ok: false, error: "unknown_method" });
}

function handleJira(state, method, path, query, body, res) {
  if (path === "/rest/api/2/issue" && method === "POST") {
    const f = body?.fields ?? {};
    if (!f.project?.key || !f.summary || !f.issuetype?.name) {
      return json(res, 400, { errorMessages: [], errors: { summary: "Field 'summary' is required" } });
    }
    const n = state.nextIssue++;
    const issue = { id: String(10000 + n), key: `${f.project.key}-${n}`, fields: f };
    state.issues.push(issue);
    return json(res, 201, { id: issue.id, key: issue.key, self: `http://mocks/rest/api/2/issue/${issue.id}` });
  }
  if (path === "/rest/api/3/search/jql" && (method === "GET" || method === "POST")) {
    const jql = query.get("jql") ?? body?.jql ?? "";
    const label = jql.match(/labels\s*=\s*"?([\w.-]+)"?/i)?.[1];
    const issues = state.issues
      .filter((i) => !label || (i.fields.labels ?? []).includes(label))
      .map((i) => ({ id: i.id, key: i.key, fields: { summary: i.fields.summary } }));
    return json(res, 200, { issues, isLast: true });
  }
  return json(res, 404, { errorMessages: [`No route for ${method} ${path}`] });
}

const SERVICES = { okta: handleOkta, slack: handleSlack, jira: handleJira };

export function createServer(state = createState()) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = Object.fromEntries(new URLSearchParams(raw));
    }

    if (url.pathname === "/health") return json(res, 200, { ok: true });
    if (url.pathname === "/__calls") return json(res, 200, state.calls);
    if (url.pathname === "/__state") {
      return json(res, 200, {
        users: [...state.users.values()].map(publicUser),
        groups: Object.fromEntries([...state.groups.values()].map((g) => [g.name, [...g.members]])),
        issues: state.issues,
      });
    }
    if (url.pathname === "/__reset" && req.method === "POST") {
      Object.assign(state, createState());
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/__faults" && req.method === "POST") {
      state.faults.push({ times: Infinity, ...body });
      return json(res, 200, { ok: true });
    }

    const [, service, ...rest] = url.pathname.split("/");
    const handler = SERVICES[service];
    if (!handler) return json(res, 404, { error: `unknown service: ${service}` });
    const path = `/${rest.join("/")}`;
    state.calls.push({ service, method: req.method, path, query: Object.fromEntries(url.searchParams), body, at: new Date().toISOString() });

    if (!authorized(service, req.headers)) {
      if (service === "slack") return json(res, 200, { ok: false, error: "invalid_auth" });
      if (service === "okta") return oktaError(res, 401, "E0000011", "Invalid token provided");
      return json(res, 401, { errorMessages: ["Unauthorized"] });
    }

    const fault = state.faults.find(
      (f) => f.service === service && f.times > 0 && (!f.method || f.method === req.method) && (!f.pathIncludes || path.includes(f.pathIncludes)),
    );
    if (fault) {
      fault.times -= 1;
      return json(res, fault.status, { error: "injected fault" });
    }

    return handler(state, req.method, path, url.searchParams, body, res);
  });
  return server;
}

if (process.argv[1]?.endsWith("server.mjs")) {
  const port = Number(process.env.PORT ?? 8080);
  createServer().listen(port, () => console.log(`mock services listening on :${port}`));
}
