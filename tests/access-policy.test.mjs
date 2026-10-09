import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createState } from "../mocks/server.mjs";

const policy = JSON.parse(readFileSync(new URL("../config/access-policy.json", import.meta.url), "utf8"));
const mockGroupNames = new Set([...createState().groups.values()].map((g) => g.name));

test("baseline grants at least one group and an announce channel", () => {
  assert.ok(policy.baseline.oktaGroups.length > 0);
  assert.match(policy.baseline.slackAnnounceChannel, /^#[a-z0-9-]+$/);
});

test("every department grants at least one group, with no duplicates", () => {
  for (const [name, dept] of Object.entries(policy.departments)) {
    assert.ok(dept.oktaGroups.length > 0, `${name} grants no groups`);
    assert.equal(new Set(dept.oktaGroups).size, dept.oktaGroups.length, `${name} lists a group twice`);
  }
});

test("every group in the policy exists in the mock Okta tenant", () => {
  const all = [...policy.baseline.oktaGroups, ...Object.values(policy.departments).flatMap((d) => d.oktaGroups)];
  for (const group of all) assert.ok(mockGroupNames.has(group), `"${group}" is not seeded in mocks/server.mjs`);
});

test("admin groups are only granted to the IT department", () => {
  for (const [name, dept] of Object.entries(policy.departments)) {
    if (name === "IT") continue;
    for (const group of dept.oktaGroups) assert.doesNotMatch(group, /admin/i, `${name} is granted admin group "${group}"`);
  }
});
