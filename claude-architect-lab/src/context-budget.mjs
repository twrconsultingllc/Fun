import Anthropic from "@anthropic-ai/sdk";

import { loadStateDataset, loadClientDataset } from "./lib/load-data.mjs";
import { DEFAULT_MODEL } from "./agent-loop.mjs";

// A hard budget, not a target — once one call's input_tokens crosses this,
// the next iteration compacts the running conversation before continuing.
// The lab's own dataset is small (study/plan.html section 10 puts a full
// query around ~3,000 input tokens), so this is set low enough to actually
// fire during one real run over every state and client, rather than a
// production-sized number that would never trigger at this scale.
export const DEFAULT_COMPACTION_THRESHOLD_TOKENS = 6000;

// study/plan.html section 10's published per-token list prices, keyed by
// the model id the Anthropic SDK actually accepts — re-check this table
// against current pricing before treating any dollar figure derived from
// it as more than a study exercise (the section's own disclaimer).
export const PRICING_USD_PER_MTOK = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-5": { input: 2.0, output: 10.0 },
  "claude-opus-5": { input: 5.0, output: 25.0 },
};

export function estimateCost({
  model,
  inputTokens = 0,
  outputTokens = 0,
  cacheWriteTokens = 0,
  cacheReadTokens = 0,
}) {
  const pricing = PRICING_USD_PER_MTOK[model];
  if (!pricing) {
    throw new Error(`No pricing on record for model "${model}" — re-check plan.html section 10.`);
  }

  const perMillion = (tokens, usdPerMtok) => (tokens / 1_000_000) * usdPerMtok;
  // study/plan.html section 10: a cache write costs 1.25x the base input
  // price (5-minute TTL); a cache read costs 0.1x.
  const inputUsd = perMillion(inputTokens, pricing.input);
  const outputUsd = perMillion(outputTokens, pricing.output);
  const cacheWriteUsd = perMillion(cacheWriteTokens, pricing.input * 1.25);
  const cacheReadUsd = perMillion(cacheReadTokens, pricing.input * 0.1);

  return {
    inputUsd,
    outputUsd,
    cacheWriteUsd,
    cacheReadUsd,
    totalUsd: inputUsd + outputUsd + cacheWriteUsd + cacheReadUsd,
  };
}

// The "before" half of the caching measurement is just the first call's
// cache_creation_input_tokens (the write); the "after" half is every later
// call's cache_read_input_tokens (reads of that same static prefix) against
// its much smaller uncached remainder.
export function summarizeCacheUsage(usageLog) {
  if (usageLog.length === 0) {
    return { firstCallInputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, laterCallsAvgInputTokens: 0 };
  }

  const [first, ...rest] = usageLog;
  const cacheWriteTokens = usageLog.reduce(
    (sum, entry) => sum + (entry.usage.cache_creation_input_tokens ?? 0),
    0,
  );
  const cacheReadTokens = usageLog.reduce(
    (sum, entry) => sum + (entry.usage.cache_read_input_tokens ?? 0),
    0,
  );
  const laterCallsAvgInputTokens = rest.length
    ? rest.reduce((sum, entry) => sum + entry.usage.input_tokens, 0) / rest.length
    : 0;

  return {
    firstCallInputTokens: first.usage.input_tokens,
    cacheWriteTokens,
    cacheReadTokens,
    laterCallsAvgInputTokens,
  };
}

// study/plan.html section 07: system prompt + full state dataset behind one
// cache_control breakpoint — the static portion every lookup reuses.
export function buildStaticSystemPrompt() {
  const { disclaimer, states } = loadStateDataset();
  return [
    {
      type: "text",
      text:
        "You are a licensing-operations lookup assistant. For each question, " +
        "answer in one short sentence using only the data below — never guess " +
        `beyond it. ${disclaimer}\n\nFull state requirements dataset:\n` +
        JSON.stringify(states, null, 2),
      cache_control: { type: "ephemeral" },
    },
  ];
}

function buildLookupPrompt(item) {
  return item.type === "state"
    ? `What are the money-transmitter licensing requirements for ${item.key}?`
    : `Briefly describe client "${item.key}"'s current licensing engagements.`;
}

// A crude compaction: collapse everything except the most recent exchange
// into one summary note, so the next call's input_tokens actually drops —
// that drop is the "after" half of the compaction measurement.
export function compactMessages(messages) {
  const recent = messages.slice(-2);
  return [
    {
      role: "user",
      content:
        `[Context compacted: ${messages.length - recent.length} earlier turns summarized. ` +
        "Continue answering lookup questions about the remaining states and clients.]",
    },
    { role: "assistant", content: "Acknowledged — continuing." },
    ...recent,
  ];
}

function buildLookupItems({ states, clientIds }) {
  return [
    ...states.map((state) => ({ type: "state", key: state })),
    ...clientIds.map((clientId) => ({ type: "client", key: clientId })),
  ];
}

// Loops every state and every client one at a time in a single growing
// conversation, tracking usage as it goes; compacts once a call's
// input_tokens crosses compactionThresholdTokens, and logs the before/after
// token counts around that compaction (study/build-plan.html Session 7).
export async function runContextBudget({
  client,
  model = DEFAULT_MODEL,
  states,
  clientIds,
  compactionThresholdTokens = DEFAULT_COMPACTION_THRESHOLD_TOKENS,
}) {
  const system = buildStaticSystemPrompt();
  const items = buildLookupItems({
    states: states ?? loadStateDataset().states.map((s) => s.state),
    clientIds: clientIds ?? loadClientDataset().clients.map((c) => c.clientId),
  });

  let messages = [];
  const usageLog = [];
  const compactionEvents = [];
  let pendingCompaction = null;

  for (const item of items) {
    messages = [...messages, { role: "user", content: buildLookupPrompt(item) }];

    const response = await client.messages.create({
      model,
      max_tokens: 200,
      system,
      messages,
    });
    messages = [...messages, { role: "assistant", content: response.content }];
    usageLog.push({ item, usage: response.usage });

    if (pendingCompaction) {
      compactionEvents.push({ ...pendingCompaction, afterTokens: response.usage.input_tokens });
      pendingCompaction = null;
    }

    if (response.usage.input_tokens >= compactionThresholdTokens) {
      pendingCompaction = { triggeredAfterItem: item, beforeTokens: response.usage.input_tokens };
      messages = compactMessages(messages);
    }
  }

  if (pendingCompaction) {
    compactionEvents.push({ ...pendingCompaction, afterTokens: null });
  }

  return { usageLog, compactionEvents, cacheUsage: summarizeCacheUsage(usageLog) };
}

async function main() {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file is fine as long as ANTHROPIC_API_KEY is set some other way.
  }

  const client = new Anthropic();
  const { usageLog, compactionEvents, cacheUsage } = await runContextBudget({ client });

  console.log(`Ran ${usageLog.length} lookups (${loadStateDataset().states.length} states + ` +
    `${loadClientDataset().clients.length} clients).`);
  console.log("\n--- compaction events ---");
  console.log(compactionEvents.length ? JSON.stringify(compactionEvents, null, 2) : "(threshold never reached)");
  console.log("\n--- cache usage ---");
  console.log(JSON.stringify(cacheUsage, null, 2));
  console.log("\n--- estimated cost (Sonnet 5 pricing) ---");
  console.log(
    JSON.stringify(
      estimateCost({
        model: DEFAULT_MODEL,
        inputTokens: usageLog.reduce((sum, e) => sum + e.usage.input_tokens, 0),
        outputTokens: usageLog.reduce((sum, e) => sum + e.usage.output_tokens, 0),
        cacheWriteTokens: cacheUsage.cacheWriteTokens,
        cacheReadTokens: cacheUsage.cacheReadTokens,
      }),
      null,
      2,
    ),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("context-budget run failed:", error);
    process.exit(1);
  });
}
