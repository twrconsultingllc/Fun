// Session 6 (study/build-plan.html): structured-output.mjs's bounded-retry
// logic, exercised against a stubbed client.messages.parse() — zero network
// calls, per plan.html section 11. The real run against the live API is a
// separate, manual step once ANTHROPIC_API_KEY is set.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getStructuredChecklist, DEFAULT_MAX_ATTEMPTS } from "../src/structured-output.mjs";

const VALID_CHECKLIST = {
  clientId: "meridian-payments",
  disclaimer: "Sample data only — verify against NMLS and the state regulator.",
  states: [
    {
      state: "Texas",
      hasGap: true,
      gapSummary: "No surety bond posted for Texas yet.",
      checklist: [{ item: "Surety bond quote obtained", status: "pending" }],
    },
  ],
};

function stubParseClient(behaviors) {
  let i = 0;
  return {
    messages: {
      parse: async () => {
        assert.ok(i < behaviors.length, "stub exhausted — more calls than expected");
        const behavior = behaviors[i++];
        if (behavior.error) throw behavior.error;
        return { parsed_output: behavior.parsed_output };
      },
    },
  };
}

test("getStructuredChecklist: succeeds on the first attempt with no retry needed", async () => {
  const client = stubParseClient([{ parsed_output: VALID_CHECKLIST }]);

  const result = await getStructuredChecklist({
    client,
    model: "stub-model",
    system: "stub system",
    messages: [{ role: "user", content: "stub task" }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempt, 1);
  assert.deepEqual(result.checklist, VALID_CHECKLIST);
});

test("getStructuredChecklist: retries once after an invalid-output error, then succeeds", async () => {
  let calls = 0;
  const client = {
    messages: {
      parse: async ({ messages }) => {
        calls += 1;
        if (calls === 1) throw new Error("Failed to parse structured output: invalid JSON");
        // The retry should have appended a corrective note to the conversation.
        assert.equal(messages.length, 2);
        assert.match(messages.at(-1).content, /didn't parse as valid JSON/);
        return { parsed_output: VALID_CHECKLIST };
      },
    },
  };

  const result = await getStructuredChecklist({
    client,
    model: "stub-model",
    system: "stub system",
    messages: [{ role: "user", content: "stub task" }],
  });

  assert.equal(calls, 2);
  assert.equal(result.ok, true);
  assert.equal(result.attempt, 2);
});

test("getStructuredChecklist: gives up after maxAttempts and reports the last error", async () => {
  const persistentError = new Error("Failed to parse structured output: still invalid");
  const client = stubParseClient([
    { error: persistentError },
    { error: persistentError },
    { error: persistentError },
  ]);

  const result = await getStructuredChecklist({
    client,
    model: "stub-model",
    system: "stub system",
    messages: [{ role: "user", content: "stub task" }],
    maxAttempts: 3,
  });

  assert.equal(result.ok, false);
  assert.equal(result.attempts, 3);
  assert.equal(result.error, persistentError);
});

test("getStructuredChecklist: defaults to DEFAULT_MAX_ATTEMPTS when not overridden", async () => {
  const persistentError = new Error("always invalid");
  const behaviors = Array.from({ length: DEFAULT_MAX_ATTEMPTS }, () => ({ error: persistentError }));
  const client = stubParseClient(behaviors);

  const result = await getStructuredChecklist({
    client,
    model: "stub-model",
    system: "stub system",
    messages: [{ role: "user", content: "stub task" }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.attempts, DEFAULT_MAX_ATTEMPTS);
});
