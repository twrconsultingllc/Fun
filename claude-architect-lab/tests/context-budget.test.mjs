// Session 7 (study/build-plan.html): context-budget.mjs's compaction-trigger
// threshold math and cache accounting, exercised against a stubbed
// client.messages.create — zero network calls, per plan.html section 11.
// The real measurement run (actual token counts against the live API) is a
// separate, manual step once ANTHROPIC_API_KEY is set.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateCost,
  summarizeCacheUsage,
  compactMessages,
  runContextBudget,
  PRICING_USD_PER_MTOK,
} from "../src/context-budget.mjs";

function usageResponse({
  input_tokens,
  output_tokens = 20,
  cache_creation_input_tokens = null,
  cache_read_input_tokens = null,
}) {
  return {
    content: [{ type: "text", text: "stub answer" }],
    usage: { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens },
  };
}

function stubClient(responses) {
  let i = 0;
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params) => {
        calls.push(params);
        assert.ok(i < responses.length, "stub exhausted — more calls than expected");
        return responses[i++];
      },
    },
  };
}

test("estimateCost: matches plan.html section 10's Sonnet 5 pricing exactly", () => {
  const result = estimateCost({ model: "claude-sonnet-5", inputTokens: 1_000_000, outputTokens: 1_000_000 });
  assert.equal(result.inputUsd, PRICING_USD_PER_MTOK["claude-sonnet-5"].input);
  assert.equal(result.outputUsd, PRICING_USD_PER_MTOK["claude-sonnet-5"].output);
  assert.equal(result.totalUsd, result.inputUsd + result.outputUsd);
});

test("estimateCost: a cache write costs 1.25x input price, a cache read costs 0.1x", () => {
  const result = estimateCost({
    model: "claude-sonnet-5",
    cacheWriteTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
  });
  const inputPrice = PRICING_USD_PER_MTOK["claude-sonnet-5"].input;
  assert.equal(result.cacheWriteUsd, inputPrice * 1.25);
  assert.equal(result.cacheReadUsd, inputPrice * 0.1);
});

test("estimateCost: rejects a model with no pricing on record rather than guessing", () => {
  assert.throws(() => estimateCost({ model: "claude-made-up", inputTokens: 100 }), /no pricing on record/i);
});

test("summarizeCacheUsage: separates the first call's cache write from later calls' cache reads", () => {
  const usageLog = [
    { item: { key: "a" }, usage: { input_tokens: 2300, output_tokens: 50, cache_creation_input_tokens: 2300, cache_read_input_tokens: null } },
    { item: { key: "b" }, usage: { input_tokens: 700, output_tokens: 50, cache_creation_input_tokens: null, cache_read_input_tokens: 2300 } },
    { item: { key: "c" }, usage: { input_tokens: 500, output_tokens: 50, cache_creation_input_tokens: null, cache_read_input_tokens: 2300 } },
  ];

  const result = summarizeCacheUsage(usageLog);
  assert.equal(result.firstCallInputTokens, 2300);
  assert.equal(result.cacheWriteTokens, 2300);
  assert.equal(result.cacheReadTokens, 4600);
  assert.equal(result.laterCallsAvgInputTokens, 600);
});

test("summarizeCacheUsage: an empty log is a clean zero result, not a crash", () => {
  const result = summarizeCacheUsage([]);
  assert.deepEqual(result, {
    firstCallInputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    laterCallsAvgInputTokens: 0,
  });
});

test("compactMessages: collapses everything but the most recent exchange into a summary", () => {
  const messages = [
    { role: "user", content: "q1" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "q2" },
    { role: "assistant", content: "a2" },
    { role: "user", content: "q3" },
    { role: "assistant", content: "a3" },
  ];

  const compacted = compactMessages(messages);
  assert.equal(compacted.length, 4);
  assert.equal(compacted[0].role, "user");
  assert.match(compacted[0].content, /context compacted/i);
  assert.equal(compacted[1].role, "assistant");
  assert.deepEqual(compacted.at(-2), messages.at(-2));
  assert.deepEqual(compacted.at(-1), messages.at(-1));
});

test("runContextBudget: compaction fires once a call's input_tokens crosses the threshold, and shrinks the next call's messages", async () => {
  const client = stubClient([
    usageResponse({ input_tokens: 300 }),
    usageResponse({ input_tokens: 300 }),
    usageResponse({ input_tokens: 1200 }), // crosses the threshold here
    usageResponse({ input_tokens: 300 }),
  ]);

  const result = await runContextBudget({
    client,
    model: "stub-model",
    states: ["California", "New York", "Texas"],
    clientIds: ["meridian-payments"],
    compactionThresholdTokens: 1000,
  });

  assert.equal(result.compactionEvents.length, 1);
  assert.equal(result.compactionEvents[0].beforeTokens, 1200);
  assert.equal(result.compactionEvents[0].afterTokens, 300);
  assert.equal(result.compactionEvents[0].triggeredAfterItem.key, "Texas");

  // Without compaction, call 4 would carry all 3 prior exchanges (6 messages)
  // plus its own question (7). Compaction should have cut that down.
  const call4Messages = client.calls[3].messages;
  assert.equal(call4Messages.length, 5);
});

test("runContextBudget: never triggers compaction when every call stays under the threshold", async () => {
  const client = stubClient([
    usageResponse({ input_tokens: 300 }),
    usageResponse({ input_tokens: 320 }),
  ]);

  const result = await runContextBudget({
    client,
    model: "stub-model",
    states: ["California"],
    clientIds: ["meridian-payments"],
    compactionThresholdTokens: 1000,
  });

  assert.deepEqual(result.compactionEvents, []);
});

test("runContextBudget: compaction triggered on the final item is logged with a null afterTokens", async () => {
  const client = stubClient([usageResponse({ input_tokens: 200 }), usageResponse({ input_tokens: 900 })]);

  const result = await runContextBudget({
    client,
    model: "stub-model",
    states: ["California", "New York"],
    clientIds: [],
    compactionThresholdTokens: 500,
  });

  assert.equal(result.compactionEvents.length, 1);
  assert.equal(result.compactionEvents[0].beforeTokens, 900);
  assert.equal(result.compactionEvents[0].afterTokens, null);
});

test("runContextBudget: its cacheUsage summary matches summarizeCacheUsage over the same log", async () => {
  const client = stubClient([
    usageResponse({ input_tokens: 2300, cache_creation_input_tokens: 2300 }),
    usageResponse({ input_tokens: 700, cache_read_input_tokens: 2300 }),
  ]);

  const result = await runContextBudget({
    client,
    model: "stub-model",
    states: ["California"],
    clientIds: ["meridian-payments"],
    compactionThresholdTokens: 100_000,
  });

  assert.equal(result.cacheUsage.cacheWriteTokens, 2300);
  assert.equal(result.cacheUsage.cacheReadTokens, 2300);
});
