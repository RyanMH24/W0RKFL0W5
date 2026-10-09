import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadWorkflows, validateWorkflows } from "../scripts/validate-workflows.mjs";

const fresh = () => loadWorkflows(fileURLToPath(new URL("../workflows", import.meta.url)));
const byId = (workflows, id) => workflows.find((wf) => wf.id === id);
const nodeOf = (wf, type) => wf.nodes.find((n) => n.type === type);

function expectProblem(mutate, pattern) {
  const workflows = fresh();
  mutate(workflows);
  const problems = validateWorkflows(workflows);
  assert.ok(problems.some((p) => pattern.test(p)), `expected a problem matching ${pattern}, got:\n${problems.join("\n")}`);
}

test("the committed workflows pass every check", () => {
  assert.deepEqual(validateWorkflows(fresh()), []);
});

test("flags an unauthenticated webhook", () => {
  expectProblem((wfs) => {
    const hook = nodeOf(byId(wfs, "w0rkfl0w5Onboard"), "n8n-nodes-base.webhook");
    hook.parameters.authentication = "none";
    delete hook.credentials;
  }, /webhook must require authentication/);
});

test("flags a hardcoded URL", () => {
  expectProblem((wfs) => {
    nodeOf(byId(wfs, "w0rkfl0w5Offboard"), "n8n-nodes-base.httpRequest").parameters.url = "=https://acme.okta.com/api/v1/users";
  }, /is hardcoded/);
});

test("flags an HTTP request without retries", () => {
  expectProblem((wfs) => {
    nodeOf(byId(wfs, "w0rkfl0w5Onboard"), "n8n-nodes-base.httpRequest").retryOnFail = false;
  }, /must retry on failure/);
});

test("flags a pasted secret", () => {
  expectProblem((wfs) => {
    nodeOf(byId(wfs, "w0rkfl0w5Onboard"), "n8n-nodes-base.code").parameters.jsCode += "\n// xoxb-123456789012-abcdefghijkl";
  }, /looks like a Slack token/);
});

test("flags env access in a Code node", () => {
  expectProblem((wfs) => {
    nodeOf(byId(wfs, "w0rkfl0w5Onboard"), "n8n-nodes-base.code").parameters.jsCode += "\nconst t = $env.OKTA_API_TOKEN;";
  }, /must not read environment variables/);
});

test("flags a missing error workflow", () => {
  expectProblem((wfs) => {
    delete byId(wfs, "w0rkfl0w5Offboard").settings.errorWorkflow;
  }, /settings\.errorWorkflow/);
});

test("flags an unreachable node", () => {
  expectProblem((wfs) => {
    const wf = byId(wfs, "w0rkfl0w5Onboard");
    wf.nodes.push({ ...nodeOf(wf, "n8n-nodes-base.code"), name: "Leftover Node", id: "x" });
  }, /Leftover Node: is not reachable/);
});

test("flags an unknown credential", () => {
  expectProblem((wfs) => {
    nodeOf(byId(wfs, "w0rkfl0w5Onboard"), "n8n-nodes-base.httpRequest").credentials = { httpHeaderAuth: { id: "personalToken", name: "mine" } };
  }, /doesn't provision/);
});
