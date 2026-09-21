import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { clientGapAnalysis } from "./tools/client-gap-analysis.mjs";
import { CHECKLIST_ITEM_STATUSES } from "./lib/constants.mjs";
import { DEFAULT_MODEL, DEFAULT_CLIENT_ID, DEFAULT_TARGET_STATES } from "./agent-loop.mjs";

export const DEFAULT_MAX_ATTEMPTS = 3;

// study/plan.html section 07: `output_config.format` (via the SDK's
// zodOutputFormat helper + `client.messages.parse()`), not the deprecated
// forced-tool_choice trick.
export const ChecklistItemSchema = z.object({
  item: z.string(),
  status: z.enum(CHECKLIST_ITEM_STATUSES),
});

export const StateChecklistSchema = z.object({
  state: z.string(),
  hasGap: z.boolean(),
  gapSummary: z
    .string()
    .describe("One or two sentences on what's missing, citing the actual gap-analysis numbers."),
  checklist: z.array(ChecklistItemSchema),
});

export const ExpansionChecklistSchema = z.object({
  clientId: z.string(),
  disclaimer: z
    .string()
    .describe("Must repeat that every figure is sample data only, never real regulatory guidance."),
  states: z.array(StateChecklistSchema),
});

// Bounded retry: client.messages.parse() throws when the model's output
// doesn't validate against the schema (see @anthropic-ai/sdk/lib/parser.mjs)
// rather than silently returning something malformed. Each retry appends a
// corrective note rather than resending the identical prompt unchanged.
export async function getStructuredChecklist({
  client,
  model = DEFAULT_MODEL,
  system,
  messages,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
}) {
  const format = zodOutputFormat(ExpansionChecklistSchema);
  let conversation = messages;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await client.messages.parse({
        model,
        max_tokens: 1536,
        system,
        messages: conversation,
        output_config: { format },
      });
      return { ok: true, attempt, checklist: response.parsed_output };
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        conversation = [
          ...conversation,
          {
            role: "user",
            content:
              `That response didn't parse as valid JSON matching the required schema ` +
              `(${error.message}). Return ONLY the JSON object — no prose, no code fences.`,
          },
        ];
      }
    }
  }

  return { ok: false, attempts: maxAttempts, error: lastError };
}

function buildSystemPrompt() {
  return (
    "You turn a licensing-expansion gap analysis into a structured checklist. " +
    "Every number in the gap analysis below is sample data, clearly marked as " +
    "such — repeat that in your disclaimer field, and never invent a number or " +
    "a regulator name that isn't in the data you were given."
  );
}

function buildTaskPrompt({ clientId, targetStates }) {
  const gapsByState = Object.fromEntries(
    targetStates.map((state) => [state, clientGapAnalysis({ clientId, state })]),
  );

  return (
    `Here is the gap analysis for ${clientId} expanding into ${targetStates.join(", ")}:\n\n` +
    `${JSON.stringify(gapsByState, null, 2)}\n\n` +
    "Produce the structured expansion checklist for these states."
  );
}

// Shared with review-loop.mjs's main(), which chains off this same
// structured checklist rather than re-deriving the gap analysis itself.
export function buildStructuredChecklistRequest({
  clientId = DEFAULT_CLIENT_ID,
  targetStates = DEFAULT_TARGET_STATES,
} = {}) {
  return {
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: buildTaskPrompt({ clientId, targetStates }) }],
  };
}

async function main() {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file is fine as long as ANTHROPIC_API_KEY is set some other way.
  }

  const client = new Anthropic();

  const result = await getStructuredChecklist({
    client,
    ...buildStructuredChecklistRequest(),
  });

  if (!result.ok) {
    console.error(`Structured output failed after ${result.attempts} attempts:`, result.error);
    process.exit(1);
  }

  console.log(`(succeeded on attempt ${result.attempt})`);
  console.log(JSON.stringify(result.checklist, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("structured-output run failed:", error);
    process.exit(1);
  });
}
