// Session 9 (study/build-plan.html): sdk-version/agent.mjs's PreToolUse
// hook, called directly with fabricated input — no live call, per
// plan.html section 11. Whether the hook actually fires during a real SDK
// session, and whether the MCP tool is actually reachable through it, is a
// separate manual-run-and-eyeball step once ANTHROPIC_API_KEY is set (same
// convention as battle-bots-v2.core.test.mjs elsewhere in this repo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPreToolUseHook } from "../sdk-version/agent.mjs";

function fakeInput({ tool_name, tool_input = {} }) {
  return {
    session_id: "fake-session",
    transcript_path: "/dev/null",
    cwd: process.cwd(),
    hook_event_name: "PreToolUse",
    tool_name,
    tool_input,
    tool_use_id: "toolu_fake",
  };
}

test("createPreToolUseHook: auto-allows an mtl MCP tool call with a stated reason", async () => {
  const logs = [];
  const hook = createPreToolUseHook({ log: (message) => logs.push(message) });

  const result = await hook(
    fakeInput({ tool_name: "mcp__mtl__get_client", tool_input: { clientId: "meridian-payments" } }),
    "toolu_fake",
    { signal: new AbortController().signal },
  );

  assert.equal(result.continue, true);
  assert.equal(result.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(result.hookSpecificOutput.permissionDecision, "allow");
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /mcp__mtl__get_client/);
});

test("createPreToolUseHook: has no opinion on a non-mtl tool, just continues", async () => {
  const hook = createPreToolUseHook({ log: () => {} });

  const result = await hook(fakeInput({ tool_name: "Task", tool_input: { subagent_type: "general-purpose" } }));

  assert.equal(result.continue, true);
  assert.equal(result.hookSpecificOutput, undefined);
});

test("createPreToolUseHook: logs every call it sees, regardless of tool", async () => {
  const logs = [];
  const hook = createPreToolUseHook({ log: (message) => logs.push(message) });

  await hook(fakeInput({ tool_name: "mcp__mtl__client_gap_analysis", tool_input: { clientId: "x", state: "Texas" } }), "toolu_1");
  await hook(fakeInput({ tool_name: "Task", tool_input: {} }), "toolu_2");

  assert.equal(logs.length, 2);
  assert.match(logs[0], /mcp__mtl__client_gap_analysis/);
  assert.match(logs[0], /toolu_1/);
  assert.match(logs[1], /Task/);
  assert.match(logs[1], /toolu_2/);
});

test("createPreToolUseHook: defaults to logging via console.error when no logger is given", async () => {
  const hook = createPreToolUseHook();
  const result = await hook(fakeInput({ tool_name: "mcp__mtl__get_state_requirements" }), "toolu_default");
  assert.equal(result.continue, true);
});
