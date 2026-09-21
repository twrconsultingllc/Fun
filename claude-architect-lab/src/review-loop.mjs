import Anthropic from "@anthropic-ai/sdk";

import { DEFAULT_MODEL } from "./agent-loop.mjs";
import { getStructuredChecklist, buildStructuredChecklistRequest } from "./structured-output.mjs";

const SYSTEM_PROMPT =
  "You write short internal compliance memos from a licensing-expansion " +
  "checklist. Every figure in the checklist is sample data, clearly marked " +
  "as such — repeat that in the memo, and never invent a number or a " +
  "regulator name that isn't already in the checklist you were given.";

function extractText(content) {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

async function callText({ client, model, prompt }) {
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });
  return extractText(response.content);
}

// Prompt chaining, not one open-ended request: each step only ever sees the
// checklist data plus the previous step's own output, never the raw
// conversation that produced the checklist (study/plan.html section 07).
export async function draftMemo({ client, model = DEFAULT_MODEL, checklist }) {
  return callText({
    client,
    model,
    prompt:
      "Write a short internal compliance memo summarizing this expansion " +
      `checklist for a colleague:\n\n${JSON.stringify(checklist, null, 2)}`,
  });
}

export async function critiqueMemo({ client, model = DEFAULT_MODEL, checklist, draft }) {
  return callText({
    client,
    model,
    prompt:
      `Here is a draft compliance memo:\n\n${draft}\n\n` +
      `Here is the checklist data it's meant to summarize:\n\n${JSON.stringify(checklist, null, 2)}\n\n` +
      "Critique the draft: does it accurately reflect every state's gap and " +
      'checklist status? Is anything missing, wrong, or overstated? List ' +
      'concrete issues, or say "No issues found" if there genuinely are none.',
  });
}

export async function reviseMemo({ client, model = DEFAULT_MODEL, checklist, draft, critique }) {
  return callText({
    client,
    model,
    prompt:
      `Draft memo:\n\n${draft}\n\nCritique:\n\n${critique}\n\n` +
      `Checklist data:\n\n${JSON.stringify(checklist, null, 2)}\n\n` +
      "Revise the memo to address every issue the critique raised. If the " +
      'critique said "No issues found", return the draft unchanged. Return ' +
      "only the final memo text.",
  });
}

export async function runReviewLoop({ client, model = DEFAULT_MODEL, checklist }) {
  const draft = await draftMemo({ client, model, checklist });
  const critique = await critiqueMemo({ client, model, checklist, draft });
  const final = await reviseMemo({ client, model, checklist, draft, critique });
  return { draft, critique, final };
}

async function main() {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file is fine as long as ANTHROPIC_API_KEY is set some other way.
  }

  const client = new Anthropic();

  const structured = await getStructuredChecklist({ client, ...buildStructuredChecklistRequest() });
  if (!structured.ok) {
    console.error(`Structured output failed after ${structured.attempts} attempts:`, structured.error);
    process.exit(1);
  }

  const result = await runReviewLoop({ client, checklist: structured.checklist });

  console.log("--- draft ---");
  console.log(result.draft);
  console.log("\n--- critique ---");
  console.log(result.critique);
  console.log("\n--- final ---");
  console.log(result.final);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("review-loop run failed:", error);
    process.exit(1);
  });
}
