import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { DEFAULT_MODEL, DEFAULT_CLIENT_ID, MAX_TURNS, runToolPhase } from "./agent-loop.mjs";
import * as getClientTool from "./tools/get-client.mjs";
import * as getStateRequirementsTool from "./tools/get-state-requirements.mjs";
import * as getClientProgressTool from "./tools/get-client-progress.mjs";
import * as clientGapAnalysisTool from "./tools/client-gap-analysis.mjs";

// A bigger, more ad hoc expansion than agent-loop.mjs's own 3-state Meridian
// scenario (study/plan.html section 08) — deliberately so, per plan.html
// section 07's "help Meridian expand into 5 target states" framing for this
// file specifically. client_gap_analysis doesn't require an existing
// licensingEngagements entry, so a state Meridian hasn't targeted yet
// (Washington, Georgia) works fine alongside the three it already has.
export const DEFAULT_TARGET_STATES = ["Texas", "Florida", "Illinois", "Washington", "Georgia"];

// The research worker only ever sees read-only lookup tools — no
// update_checklist_item, since research must never mutate case data
// (study/plan.html section 08: "the orchestrator's research worker only
// ever sees the lookup tools (state + client)"). client_gap_analysis is
// included because it's read-only despite combining both datasets.
const RESEARCH_TOOLS = [
  { module: getClientTool, handler: getClientTool.getClient },
  { module: getStateRequirementsTool, handler: getStateRequirementsTool.getStateRequirements },
  { module: getClientProgressTool, handler: getClientProgressTool.getClientProgress },
  { module: clientGapAnalysisTool, handler: clientGapAnalysisTool.clientGapAnalysis },
];

export const ResearchFindingsSchema = z.object({
  clientId: z.string(),
  states: z.array(
    z.object({
      state: z.string(),
      requirementsKnown: z.boolean().describe("False if the state wasn't in the sample dataset."),
      hasGap: z.boolean(),
      gapSummary: z.string().describe("One or two sentences citing the actual gap-analysis numbers."),
    }),
  ),
});

function buildResearchSystemPrompt() {
  return (
    "You are the research worker in a two-worker pipeline. Use the lookup " +
    "tools to gather facts about the client and every target state — you " +
    "have no tool that changes any data. Every number you see is sample " +
    "data only; never present it as real regulatory guidance, and never " +
    "invent a number or regulator name that isn't in a tool result."
  );
}

function buildResearchTaskPrompt({ clientId, targetStates }) {
  return (
    `${clientId} wants to expand into: ${targetStates.join(", ")}. Look up ` +
    "their current profile and each target state's requirements, and run " +
    "the gap analysis for every state before summarizing."
  );
}

// Research worker: gathers via tools, then produces ONE structured findings
// object. The writing worker below only ever sees that structured object —
// never the raw tool calls or conversation that produced it (the
// "structuring multi-agent architectures" exam point plan.html section 08
// calls out, not incidental plumbing).
export async function runResearchWorker({
  client,
  model = DEFAULT_MODEL,
  clientId = DEFAULT_CLIENT_ID,
  targetStates = DEFAULT_TARGET_STATES,
  maxTurns = MAX_TURNS.gather,
}) {
  const system = buildResearchSystemPrompt();
  const gather = await runToolPhase({
    client,
    model,
    system,
    messages: [{ role: "user", content: buildResearchTaskPrompt({ clientId, targetStates }) }],
    toolSet: RESEARCH_TOOLS,
    maxTurns,
  });

  const format = zodOutputFormat(ResearchFindingsSchema);
  const response = await client.messages.parse({
    model,
    max_tokens: 1024,
    system,
    messages: [
      ...gather.messages,
      { role: "user", content: "Summarize your research as structured findings for each target state." },
    ],
    output_config: { format },
  });

  return { findings: response.parsed_output, turns: gather.turns, hitTurnCap: gather.hitTurnCap };
}

const WRITING_SYSTEM_PROMPT =
  "You are the writing worker in a two-worker pipeline. You only ever see " +
  "the research worker's structured findings below — never its raw tool " +
  "calls. Every figure in the findings is sample data; repeat that in the " +
  "memo, and never add a fact that isn't already in the findings.";

function extractText(content) {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export async function runWritingWorker({ client, model = DEFAULT_MODEL, findings }) {
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: WRITING_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content:
          "Draft a short internal memo on this client's expansion, state by " +
          `state, from these findings:\n\n${JSON.stringify(findings, null, 2)}`,
      },
    ],
  });
  return extractText(response.content);
}

export async function runOrchestrator({
  client,
  model = DEFAULT_MODEL,
  clientId = DEFAULT_CLIENT_ID,
  targetStates = DEFAULT_TARGET_STATES,
}) {
  const research = await runResearchWorker({ client, model, clientId, targetStates });
  const memo = await runWritingWorker({ client, model, findings: research.findings });
  return { findings: research.findings, memo, turns: research.turns, hitTurnCap: research.hitTurnCap };
}

async function main() {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file is fine as long as ANTHROPIC_API_KEY is set some other way.
  }

  const client = new Anthropic();
  const result = await runOrchestrator({ client });

  console.log("--- research findings (structured) ---");
  console.log(JSON.stringify(result.findings, null, 2));
  console.log("\n--- merged memo ---");
  console.log(result.memo);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("orchestrator run failed:", error);
    process.exit(1);
  });
}
