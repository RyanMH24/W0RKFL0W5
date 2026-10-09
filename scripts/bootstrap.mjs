// Container entrypoint for the n8n service: syncs this repo's workflows and
// credentials into n8n, then starts it.
//
// 1. Writes the runtime config file the workflows read (service URLs, Jira
//    project, Slack channels, access policy). Only non-secret values go here;
//    n8n's N8N_BLOCK_ENV_ACCESS_IN_NODE stays at its secure default, so
//    workflows can't read the environment directly.
// 2. Imports credentials from environment variables. n8n encrypts them with
//    N8N_ENCRYPTION_KEY on import; the plaintext file is deleted right after.
// 3. Imports every workflow in WORKFLOWS_DIR (git is the source of truth;
//    UI edits are overwritten on restart unless exported back to the repo).
// 4. Publishes the workflows so webhooks and the error trigger are live.
// 5. Execs `n8n start` (skipped with --no-start, used by tests).
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const env = process.env;
const N8N_BIN = env.N8N_BIN ?? "n8n";
const WORKFLOWS_DIR = env.WORKFLOWS_DIR ?? "/workflows";
const POLICY_FILE = env.ACCESS_POLICY_FILE ?? "/config/access-policy.json";
const FILES_DIR = env.N8N_RESTRICT_FILE_ACCESS_TO ?? path.join(homedir(), ".n8n-files");

export const CONFIG_FILE_NAME = "w0rkfl0w5.json";

export const CREDENTIAL_IDS = {
  okta: "w0rkfl0w5OktaApi",
  slack: "w0rkfl0w5SlackBot",
  jira: "w0rkfl0w5JiraApi",
  webhook: "w0rkfl0w5Webhook",
};

function required(name) {
  const value = env[name];
  if (!value) throw new Error(`Missing required environment variable ${name} (see .env.example)`);
  return value;
}

const trimSlash = (url) => url.replace(/\/+$/, "");

export function buildRuntimeConfig(policy) {
  return {
    okta: { baseUrl: trimSlash(required("OKTA_BASE_URL")) },
    slack: {
      apiUrl: trimSlash(required("SLACK_API_URL")),
      onboardingChannel: required("SLACK_ONBOARDING_CHANNEL"),
      itAlertsChannel: required("SLACK_IT_ALERTS_CHANNEL"),
    },
    jira: {
      baseUrl: trimSlash(required("JIRA_BASE_URL")),
      browseUrl: trimSlash(env.JIRA_BROWSE_URL ?? required("JIRA_BASE_URL")),
      projectKey: required("JIRA_PROJECT_KEY"),
      issueType: env.JIRA_ISSUE_TYPE ?? "Task",
    },
    n8n: { editorUrl: trimSlash(env.N8N_EDITOR_BASE_URL ?? "http://localhost:5678") },
    policy,
  };
}

export function buildCredentials() {
  return [
    {
      id: CREDENTIAL_IDS.okta,
      name: "Okta API token",
      type: "httpHeaderAuth",
      data: { name: "Authorization", value: `SSWS ${required("OKTA_API_TOKEN")}` },
    },
    {
      id: CREDENTIAL_IDS.slack,
      name: "Slack bot token",
      type: "httpHeaderAuth",
      data: { name: "Authorization", value: `Bearer ${required("SLACK_BOT_TOKEN")}` },
    },
    {
      id: CREDENTIAL_IDS.jira,
      name: "Jira API token",
      type: "httpBasicAuth",
      data: { user: required("JIRA_EMAIL"), password: required("JIRA_API_TOKEN") },
    },
    {
      id: CREDENTIAL_IDS.webhook,
      name: "W0RKFL0W5 webhook secret",
      type: "httpHeaderAuth",
      data: { name: "X-W0RKFL0W5-Secret", value: required("WEBHOOK_SECRET") },
    },
  ];
}

function n8n(...args) {
  console.log(`[bootstrap] n8n ${args.join(" ")}`);
  execFileSync(N8N_BIN, args, { stdio: "inherit", shell: process.platform === "win32" });
}

function main() {
  const policy = JSON.parse(readFileSync(POLICY_FILE, "utf8"));
  mkdirSync(FILES_DIR, { recursive: true });
  writeFileSync(path.join(FILES_DIR, CONFIG_FILE_NAME), JSON.stringify(buildRuntimeConfig(policy), null, 2));
  console.log(`[bootstrap] wrote runtime config to ${path.join(FILES_DIR, CONFIG_FILE_NAME)}`);

  const credsFile = path.join(tmpdir(), `w0rkfl0w5-credentials-${process.pid}.json`);
  writeFileSync(credsFile, JSON.stringify(buildCredentials()), { mode: 0o600 });
  try {
    n8n("import:credentials", `--input=${credsFile}`);
  } finally {
    rmSync(credsFile, { force: true });
  }

  n8n("import:workflow", "--separate", `--input=${WORKFLOWS_DIR}`);

  // Every workflow here is triggered (webhook or error trigger), and n8n 2.x
  // only runs published workflows, including ones used as error workflows.
  for (const file of readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".json"))) {
    const workflow = JSON.parse(readFileSync(path.join(WORKFLOWS_DIR, file), "utf8"));
    n8n("publish:workflow", `--id=${workflow.id}`);
  }

  if (process.argv.includes("--no-start")) return;
  console.log("[bootstrap] starting n8n");
  const child = spawn(N8N_BIN, ["start"], { stdio: "inherit", shell: process.platform === "win32" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => process.exit(code ?? 0));
}

if (process.argv[1]?.endsWith("bootstrap.mjs")) main();
