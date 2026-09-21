import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import * as getClientTool from "./tools/get-client.mjs";
import * as getStateRequirementsTool from "./tools/get-state-requirements.mjs";
import * as clientGapAnalysisTool from "./tools/client-gap-analysis.mjs";
import * as updateChecklistItemTool from "./tools/update-checklist-item.mjs";
import { validateClientChecklist } from "./tools/validate-client-checklist.mjs";

// study/plan.html section 03's "Default model for lab runs" decision.
export const DEFAULT_MODEL = "claude-sonnet-5";

export const DEFAULT_CLIENT_ID = "meridian-payments";
export const DEFAULT_TARGET_STATES = ["Texas", "Florida", "Illinois"];

// A hard cap per phase, not a target — see study/build-plan.html Session 5's
// "explicit phase transitions, not an open-ended while (true)" instruction.
// Hitting the cap ends the phase early rather than looping forever; it is
// not itself an error.
export const MAX_TURNS = { gather: 4, act: 6 };

// If the code-based verify step (validateClientChecklist, kept internal —
// never exposed as an MCP tool, per plan.html section 07) still finds gaps
// after an act phase, the loop feeds those gaps back and runs one more act
// phase. This bounds how many times that can happen.
export const MAX_VERIFY_ROUNDS = 2;

// Read-only lookup tools for the gather phase.
const GATHER_TOOLS = [
  { module: getClientTool, handler: getClientTool.getClient },
  { module: getStateRequirementsTool, handler: getStateRequirementsTool.getStateRequirements },
];

// The tools that compute a real gap and record progress against it.
const ACT_TOOLS = [
  { module: clientGapAnalysisTool, handler: clientGapAnalysisTool.clientGapAnalysis },
  { module: updateChecklistItemTool, handler: updateChecklistItemTool.updateChecklistItem },
];

function toAnthropicTool({ name, description, inputSchema }) {
  const inputJsonSchema = z.toJSONSchema(inputSchema);
  delete inputJsonSchema.$schema;
  return { name, description, input_schema: inputJsonSchema };
}

function runTool(block, handlers) {
  const handler = handlers[block.name];
  let output;
  try {
    output = handler ? handler(block.input) : { error: `Unknown tool "${block.name}"` };
  } catch (error) {
    output = { error: error.message };
  }
  return { type: "tool_result", tool_use_id: block.id, content: JSON.stringify(output) };
}

// Runs one phase's gather-or-act tool-calling conversation: repeatedly calls
// Messages.create, executes any tool_use blocks against the real handlers,
// and feeds the results back — until the model stops asking for tools or
// the phase's turn cap is reached, whichever comes first.
export async function runToolPhase({ client, model, system, messages, toolSet, maxTurns }) {
  const tools = toolSet.map((t) => toAnthropicTool(t.module));
  const handlers = Object.fromEntries(toolSet.map((t) => [t.module.name, t.handler]));

  let turns = 0;
  let hitTurnCap = false;
  let response;

  while (true) {
    response = await client.messages.create({
      model,
      max_tokens: 1024,
      system,
      messages,
      tools,
    });
    turns += 1;
    messages = [...messages, { role: "assistant", content: response.content }];

    if (response.stop_reason !== "tool_use") break;

    if (turns >= maxTurns) {
      hitTurnCap = true;
      break;
    }

    const toolResults = response.content
      .filter((block) => block.type === "tool_use")
      .map((block) => runTool(block, handlers));
    messages = [...messages, { role: "user", content: toolResults }];
  }

  return { messages, turns, hitTurnCap, stopReason: response.stop_reason, lastResponse: response };
}

// Deterministic, code-based verify — deliberately not another model call.
// validate-client-checklist.mjs is kept off the MCP server for the same
// reason (study/plan.html section 07): this is the "verify via code" half
// of the "verify, twice, two ways" idea in section 08.
export function verifyChecklists({ clientId, targetStates }) {
  const byState = Object.fromEntries(
    targetStates.map((state) => [state, validateClientChecklist({ clientId, state })]),
  );
  const complete = Object.values(byState).every((result) => result.found && result.complete);
  return { complete, byState };
}

function buildSystemPrompt() {
  return (
    "You are a licensing-operations assistant at a money-transmitter-licensing " +
    "(MTL) consulting firm. Every number you see from these tools is sample " +
    "data only, clearly marked as such — never present it as a real regulatory " +
    "requirement, and never invent a number or a regulator name that isn't in " +
    "the tool output. Use the gather tools to look up what you don't already " +
    "know before acting, and only call update_checklist_item when you can point " +
    "to a specific tool result that justifies the status change."
  );
}

function buildTaskPrompt({ clientId, targetStates }) {
  const statesList = targetStates.join(", ");
  return (
    `${clientId} is our client. They want to expand their money-transmitter ` +
    `licensing into ${statesList}. Look up their current profile and each ` +
    "target state's requirements, then produce an expansion checklist: flag " +
    "any gaps against their actual financials, and record progress on each " +
    "state's checklist as you confirm it."
  );
}

function buildVerifyFeedback({ byState }) {
  const gaps = Object.entries(byState)
    .filter(([, result]) => result.found && !result.complete)
    .map(([state, result]) => `${state}: still missing ${result.missingItems.join(", ")}`);

  return (
    "Checking the checklist against the standard items found gaps that are " +
    "still open:\n" +
    gaps.join("\n") +
    "\nUse the tools to confirm and record whatever progress is actually " +
    "justified — do not mark an item done without a tool result to back it up."
  );
}

// The explicit gather → act → verify loop: one gather phase, then one or
// more act phases bounded by MAX_VERIFY_ROUNDS, with the code-based verify
// step deciding whether another act phase is needed.
export async function runAgentLoop({
  client,
  model = DEFAULT_MODEL,
  clientId = DEFAULT_CLIENT_ID,
  targetStates = DEFAULT_TARGET_STATES,
  maxTurns = MAX_TURNS,
  maxVerifyRounds = MAX_VERIFY_ROUNDS,
}) {
  const system = buildSystemPrompt();
  let messages = [{ role: "user", content: buildTaskPrompt({ clientId, targetStates }) }];

  const gather = await runToolPhase({
    client,
    model,
    system,
    messages,
    toolSet: GATHER_TOOLS,
    maxTurns: maxTurns.gather,
  });
  messages = gather.messages;

  let act;
  let verify;
  for (let round = 1; round <= maxVerifyRounds; round++) {
    act = await runToolPhase({
      client,
      model,
      system,
      messages,
      toolSet: ACT_TOOLS,
      maxTurns: maxTurns.act,
    });
    messages = act.messages;

    verify = verifyChecklists({ clientId, targetStates });
    if (verify.complete || round === maxVerifyRounds) break;

    messages = [...messages, { role: "user", content: buildVerifyFeedback(verify) }];
  }

  return { clientId, targetStates, phases: { gather, act }, verify, messages };
}

function extractText(content) {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

async function main() {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file is fine as long as ANTHROPIC_API_KEY is set some other way.
  }

  const client = new Anthropic();
  const result = await runAgentLoop({ client });

  console.log("--- final assistant turn ---");
  console.log(extractText(result.phases.act.lastResponse.content));
  console.log("\n--- verify (code-based, against validate-client-checklist.mjs) ---");
  console.log(JSON.stringify(result.verify, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("agent-loop run failed:", error);
    process.exit(1);
  });
}
