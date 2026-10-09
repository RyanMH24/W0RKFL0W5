// Static checks for the n8n workflow JSON in workflows/. Runs in CI on every
// pull request, so a workflow exported from the n8n UI can't merge if it
// breaks one of the platform standards below.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { CONFIG_FILE_NAME, CREDENTIAL_IDS } from "./bootstrap.mjs";

const TRIGGERS = new Set(["n8n-nodes-base.webhook", "n8n-nodes-base.errorTrigger"]);
const CONFIG_PATH = `/home/node/.n8n-files/${CONFIG_FILE_NAME}`;
const SECRET_PATTERNS = [
  [/SSWS\s+[A-Za-z0-9_-]{20,}/, "an Okta API token"],
  [/xox[abpr]-[A-Za-z0-9-]{10,}/, "a Slack token"],
  [/ATATT[A-Za-z0-9_=-]{20,}/, "an Atlassian API token"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
];

export function validateWorkflows(workflows) {
  const problems = [];
  const knownCredentialIds = new Set(Object.values(CREDENTIAL_IDS));
  const workflowIds = new Map(workflows.map((wf) => [wf.id, wf]));
  const webhookPaths = new Map();

  for (const wf of workflows) {
    const where = (node) => `${wf.name ?? wf.id}${node ? ` › ${node.name}` : ""}`;
    const fail = (node, message) => problems.push(`${where(node)}: ${message}`);

    if (!wf.id || !wf.name || !Array.isArray(wf.nodes) || typeof wf.connections !== "object") {
      fail(null, "missing id, name, nodes, or connections");
      continue;
    }

    const names = new Set();
    for (const node of wf.nodes) {
      if (names.has(node.name)) fail(node, "duplicate node name");
      names.add(node.name);
    }
    for (const [from, { main = [] }] of Object.entries(wf.connections)) {
      if (!names.has(from)) fail(null, `connection from unknown node "${from}"`);
      for (const target of main.flat()) if (!names.has(target.node)) fail(null, `connection to unknown node "${target.node}"`);
    }

    // Every node must be reachable from a trigger; orphans are dead code.
    const reachable = new Set();
    const queue = wf.nodes.filter((n) => TRIGGERS.has(n.type)).map((n) => n.name);
    if (queue.length === 0) fail(null, "has no webhook or error trigger");
    while (queue.length) {
      const name = queue.shift();
      if (reachable.has(name)) continue;
      reachable.add(name);
      for (const target of (wf.connections[name]?.main ?? []).flat()) queue.push(target.node);
    }
    for (const node of wf.nodes) if (!reachable.has(node.name) && node.type !== "n8n-nodes-base.stickyNote") fail(node, "is not reachable from a trigger");

    const isWebhookWorkflow = wf.nodes.some((n) => n.type === "n8n-nodes-base.webhook");
    if (isWebhookWorkflow) {
      const target = workflowIds.get(wf.settings?.errorWorkflow);
      if (!target) fail(null, "settings.errorWorkflow must point to a workflow in this repo");
      else if (!target.nodes.some((n) => n.type === "n8n-nodes-base.errorTrigger")) fail(null, "settings.errorWorkflow points to a workflow without an Error Trigger");
    }

    for (const node of wf.nodes) {
      const p = node.parameters ?? {};
      for (const cred of Object.values(node.credentials ?? {})) {
        if (!knownCredentialIds.has(cred.id)) fail(node, `uses credential "${cred.id}", which scripts/bootstrap.mjs doesn't provision`);
      }

      if (node.type === "n8n-nodes-base.webhook") {
        if (!p.authentication || p.authentication === "none" || !node.credentials) fail(node, "webhook must require authentication");
        if (p.responseMode === "responseNode" && !wf.nodes.some((n) => n.type === "n8n-nodes-base.respondToWebhook")) fail(node, "responds via a node, but the workflow has no Respond to Webhook node");
        const route = `${p.httpMethod ?? "GET"} ${p.path}`;
        if (webhookPaths.has(route)) fail(node, `webhook ${route} is also used by ${webhookPaths.get(route)}`);
        webhookPaths.set(route, wf.name);
      }

      if (node.type === "n8n-nodes-base.httpRequest") {
        if (p.authentication !== "genericCredentialType" || !node.credentials) fail(node, "HTTP requests must authenticate with an n8n credential");
        if (/^=?\s*https?:\/\//.test(p.url ?? "")) fail(node, `URL "${p.url}" is hardcoded; build it from the runtime config`);
        if (!node.retryOnFail || (node.maxTries ?? 3) < 2) fail(node, "HTTP requests must retry on failure");
      }

      if (node.type === "n8n-nodes-base.code" && /\$env\b|process\.env/.test(p.jsCode ?? "")) {
        fail(node, "Code nodes must not read environment variables; use the runtime config");
      }

      if (node.type === "n8n-nodes-base.readWriteFile" && p.fileSelector !== CONFIG_PATH) {
        fail(node, `reads "${p.fileSelector}"; only ${CONFIG_PATH} is provisioned`);
      }
    }

    const raw = JSON.stringify(wf);
    for (const [pattern, label] of SECRET_PATTERNS) if (pattern.test(raw)) fail(null, `contains what looks like ${label}`);
  }
  return problems;
}

export function loadWorkflows(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")));
}

if (process.argv[1]?.endsWith("validate-workflows.mjs")) {
  const dir = process.argv[2] ?? path.join(import.meta.dirname, "..", "workflows");
  const workflows = loadWorkflows(dir);
  const problems = validateWorkflows(workflows);
  if (problems.length) {
    console.error(`✖ ${problems.length} problem(s) in ${dir}:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`✔ ${workflows.length} workflows pass all checks (${workflows.reduce((n, wf) => n + wf.nodes.length, 0)} nodes)`);
}
