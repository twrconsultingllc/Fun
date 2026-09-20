import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getStateRequirements,
  inputSchema,
} from "../src/tools/get-state-requirements.mjs";

test("schema rejects a missing state", () => {
  assert.throws(() => inputSchema.parse({}));
});

test("schema rejects an empty state string", () => {
  assert.throws(() => inputSchema.parse({ state: "" }));
});

test("returns the full record for a known state", () => {
  const result = getStateRequirements({ state: "California" });
  assert.equal(result.found, true);
  assert.equal(result.state, "California");
  assert.equal(result.licenseName, "Money Transmitter License (sample)");
  assert.match(result.suretyBondRangeUsd, /sample/);
});

test("lookup is case-insensitive and tolerates surrounding whitespace", () => {
  const result = getStateRequirements({ state: "  new york  " });
  assert.equal(result.found, true);
  assert.equal(result.state, "New York");
});

test("returns an explicit unknown result for a state outside the sample set, never a guess", () => {
  const result = getStateRequirements({ state: "Wakanda" });
  assert.equal(result.found, false);
  assert.equal(result.state, "Wakanda");
  assert.match(result.message, /unknown/i);
  assert.ok(result.disclaimer);
});
