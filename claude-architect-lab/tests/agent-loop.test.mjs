// Session 5 (study/build-plan.html): agent-loop.mjs's loop logic, exercised
// against a stubbed Messages.create — zero network calls, per plan.html
// section 11 ("loop/logic tests stub Messages.create"). The real run against
// the live API is a separate, manual step once ANTHROPIC_API_KEY is set.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runToolPhase,
  runAgentLoop,
  verifyChecklists,
  MAX_TURNS,
} from "../src/agent-loop.mjs";
import { getClientProgress } from "../src/tools/get-client-progress.mjs";
import * as getClientTool from "../src/tools/get-client.mjs";

function textResponse(text) {
  return { stop_reason: "end_turn", content: [{ type: "text", text }] };
}

function toolUseResponse(name, input, { id = "toolu_1" } = {}) {
  return { stop_reason: "tool_use", content: [{ type: "tool_use", id, name, input }] };
}

function stubClient(responses) {
  let i = 0;
  return {
    messages: {
      create: async () => {
        assert.ok(i < responses.length, "stub exhausted — more calls than expected");
        return responses[i++];
      },
    },
  };
}

test("runToolPhase: stops on the first non-tool_use response without hitting the turn cap", async () => {
  const client = stubClient([textResponse("Meridian is already licensed in CA and NY.")]);

  const result = await runToolPhase({
    client,
    model: "stub-model",
    system: "stub system",
    messages: [{ role: "user", content: "stub task" }],
    toolSet: [],
    maxTurns: 4,
  });

  assert.equal(result.turns, 1);
  assert.equal(result.hitTurnCap, false);
  assert.equal(result.stopReason, "end_turn");
});

test("runToolPhase: enforces the hard turn cap when the model keeps requesting tools", async () => {
  let calls = 0;
  const client = {
    messages: {
      create: async () => {
        calls += 1;
        return toolUseResponse("get_client", { clientId: "meridian-payments" }, { id: `toolu_${calls}` });
      },
    },
  };

  const result = await runToolPhase({
    client,
    model: "stub-model",
    system: "stub system",
    messages: [{ role: "user", content: "stub task" }],
    toolSet: [{ module: getClientTool, handler: () => ({ found: true }) }],
    maxTurns: 3,
  });

  assert.equal(calls, 3);
  assert.equal(result.turns, 3);
  assert.equal(result.hitTurnCap, true);
  assert.equal(result.stopReason, "tool_use");
});

test("runToolPhase: executes the real tool handler and feeds a tool_result back", async () => {
  const client = stubClient([
    toolUseResponse("get_client", { clientId: "meridian-payments" }),
    textResponse("Meridian's profile confirms CA/NY licensing."),
  ]);

  const result = await runToolPhase({
    client,
    model: "stub-model",
    system: "stub system",
    messages: [{ role: "user", content: "stub task" }],
    toolSet: [{ module: getClientTool, handler: getClientTool.getClient }],
    maxTurns: 4,
  });

  assert.equal(result.turns, 2);
  assert.equal(result.hitTurnCap, false);

  const toolResultMessage = result.messages.find((m) => m.role === "user" && Array.isArray(m.content));
  const toolResult = JSON.parse(toolResultMessage.content[0].content);
  assert.equal(toolResult.found, true);
  assert.equal(toolResult.client.clientId, "meridian-payments");
});

test("verifyChecklists: reports which target states still have missing items", () => {
  const result = verifyChecklists({ clientId: "quickship-financial", targetStates: ["Arizona"] });
  assert.equal(result.complete, true);
  assert.equal(result.byState.Arizona.complete, true);
});

test("verifyChecklists: an unknown client surfaces as not found, not a crash", () => {
  const result = verifyChecklists({ clientId: "nope", targetStates: ["Texas"] });
  assert.equal(result.complete, false);
  assert.equal(result.byState.Texas.found, false);
});

// Meridian's Texas engagement starts with two pending items: "NMLS filing
// drafted" and "Background checks for control persons" (mcp-server/data/
// clients.json). This drives the verify-phase branching itself, rather than
// asserting against a canned expectation of it.
test("runAgentLoop: verify-phase branching retries the act phase once, then stops once complete", async () => {
  const before = getClientProgress({ clientId: "meridian-payments", state: "Texas" });
  assert.equal(
    before.engagement.checklist.find((c) => c.item === "NMLS filing drafted").status,
    "pending",
  );
  assert.equal(
    before.engagement.checklist.find((c) => c.item === "Background checks for control persons").status,
    "pending",
  );

  const client = stubClient([
    // Gather phase: the model asks nothing further and moves straight to acting.
    textResponse("Reviewed Meridian's profile and Texas's requirements."),
    // Act round 1: only fixes one of the two pending items.
    toolUseResponse(
      "update_checklist_item",
      { clientId: "meridian-payments", state: "Texas", item: "NMLS filing drafted", status: "done" },
      { id: "toolu_r1" },
    ),
    textResponse("Marked the NMLS filing as drafted."),
    // Act round 2 (triggered by the verify feedback): fixes the remaining item.
    toolUseResponse(
      "update_checklist_item",
      {
        clientId: "meridian-payments",
        state: "Texas",
        item: "Background checks for control persons",
        status: "done",
      },
      { id: "toolu_r2" },
    ),
    textResponse("Background checks are now recorded as done too."),
  ]);

  const result = await runAgentLoop({
    client,
    model: "stub-model",
    clientId: "meridian-payments",
    targetStates: ["Texas"],
    maxTurns: MAX_TURNS,
    maxVerifyRounds: 2,
  });

  assert.equal(result.verify.complete, true);
  assert.equal(result.verify.byState.Texas.complete, true);

  const after = getClientProgress({ clientId: "meridian-payments", state: "Texas" });
  assert.equal(
    after.engagement.checklist.find((c) => c.item === "Background checks for control persons").status,
    "done",
  );
});

test("runAgentLoop: stops after maxVerifyRounds even if gaps remain, rather than looping forever", async () => {
  const client = stubClient([
    textResponse("Reviewed Northstar's profile and Washington's requirements."),
    // Act round 1: no tool calls at all, so nothing changes.
    textResponse("No action taken."),
  ]);

  const result = await runAgentLoop({
    client,
    model: "stub-model",
    clientId: "northstar-remittance",
    targetStates: ["Washington"],
    maxTurns: MAX_TURNS,
    maxVerifyRounds: 1,
  });

  assert.equal(result.verify.complete, false);
  assert.deepEqual(result.verify.byState.Washington.found, false);
});
