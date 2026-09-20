// Session 2 covered the read-only client tools. Session 3 extends this file
// with gap-analysis.mjs, client-gap-analysis.mjs, validate-expansion-
// checklist.mjs, validate-client-checklist.mjs, and update-checklist-item.mjs
// — plan.html's own test-file list names client-gap-analysis here but never
// itemizes a home for the other four; they're added here too rather than
// spinning up a new file for a handful of small tool tests this session
// (see this session's notes in study/build-plan.html).
//
// Ordering matters within this file: update-checklist-item.mjs is the one
// tool with a side effect, and it mutates the same in-memory client dataset
// every other tool in this file reads (see load-data.mjs's module-level
// cache). Its tests run last, after every read-only assertion that depends
// on the original checklist data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getClient } from "../src/tools/get-client.mjs";
import { listClients } from "../src/tools/list-clients.mjs";
import { getClientProgress } from "../src/tools/get-client-progress.mjs";
import { gapAnalysis } from "../src/tools/gap-analysis.mjs";
import { clientGapAnalysis } from "../src/tools/client-gap-analysis.mjs";
import { validateExpansionChecklist } from "../src/tools/validate-expansion-checklist.mjs";
import { validateClientChecklist } from "../src/tools/validate-client-checklist.mjs";
import { updateChecklistItem } from "../src/tools/update-checklist-item.mjs";

test("get-client: returns the full case file for a known client", () => {
  const result = getClient({ clientId: "meridian-payments" });
  assert.equal(result.found, true);
  assert.equal(result.client.legalName, "Meridian Payments LLC (sample)");
});

test("get-client: returns an explicit not-found result for an unknown id, not a crash", () => {
  const result = getClient({ clientId: "nope" });
  assert.equal(result.found, false);
  assert.match(result.message, /unknown client id/i);
});

test("list-clients: with no filter returns all three sample clients", () => {
  const result = listClients();
  const ids = result.clients.map((c) => c.clientId).sort();
  assert.deepEqual(ids, [
    "meridian-payments",
    "northstar-remittance",
    "quickship-financial",
  ]);
});

test("list-clients: filtered by engagement status returns only matching clients", () => {
  const result = listClients({ engagementStatus: "gathering_documents" });
  assert.deepEqual(
    result.clients.map((c) => c.clientId),
    ["meridian-payments"],
  );
});

test("list-clients: a status nothing matches returns an empty list, not an error", () => {
  const result = listClients({ engagementStatus: "approved" });
  assert.deepEqual(result.clients, []);
});

test("list-clients: rejects an engagement status outside the enum", () => {
  assert.throws(() => listClients({ engagementStatus: "made_up_status" }));
});

test("get-client-progress: with no state filter returns every engagement", () => {
  const result = getClientProgress({ clientId: "meridian-payments" });
  assert.equal(result.found, true);
  assert.equal(result.engagements.length, 3);
});

test("get-client-progress: filtered to one state returns just that engagement", () => {
  const result = getClientProgress({
    clientId: "meridian-payments",
    state: "Texas",
  });
  assert.equal(result.engagement.status, "gathering_documents");
});

test("get-client-progress: a state the client has no engagement in is explicit, not a crash", () => {
  const result = getClientProgress({
    clientId: "meridian-payments",
    state: "Washington",
  });
  assert.equal(result.found, true);
  assert.equal(result.engagement, null);
  assert.match(result.message, /no licensing engagement/i);
});

test("get-client-progress: a brand-new prospective client has zero engagements", () => {
  const result = getClientProgress({ clientId: "northstar-remittance" });
  assert.equal(result.found, true);
  assert.deepEqual(result.engagements, []);
});

test("get-client-progress: unknown client id returns an explicit not-found result", () => {
  const result = getClientProgress({ clientId: "nope" });
  assert.equal(result.found, false);
});

test("gap-analysis: a hypothetical business that clears both bars has no gap", () => {
  const result = gapAnalysis({
    state: "Colorado",
    netWorthUsd: 200_000,
    suretyBondPostedUsd: 60_000,
  });
  assert.equal(result.found, true);
  assert.equal(result.gap.netWorth.meetsRequirement, true);
  assert.equal(result.gap.suretyBond.meetsMinimum, true);
  assert.equal(result.gap.hasGap, false);
});

test("gap-analysis: a hypothetical business with no bond posted has a gap", () => {
  const result = gapAnalysis({ state: "Colorado", netWorthUsd: 200_000 });
  assert.equal(result.gap.suretyBond.posted, false);
  assert.equal(result.gap.hasGap, true);
});

test("gap-analysis: an unknown state passes through the same unknown-state result", () => {
  const result = gapAnalysis({ state: "Wakanda", netWorthUsd: 1 });
  assert.equal(result.found, false);
  assert.match(result.message, /unknown/i);
});

test("client-gap-analysis: Northstar in Washington — plan.html's own example question", () => {
  // "Would Northstar Remittance qualify for a Washington MTL today, and
  // what's the gap?" (study/plan.html section 06). Northstar's net worth
  // clears Washington's sample minimum, but it has posted no bond anywhere.
  const result = clientGapAnalysis({
    clientId: "northstar-remittance",
    state: "Washington",
  });
  assert.equal(result.found, true);
  assert.equal(result.gap.netWorth.meetsRequirement, true);
  assert.equal(result.gap.suretyBond.posted, false);
  assert.equal(result.gap.hasGap, true);
});

test("client-gap-analysis: Quickship in Colorado, where it's already licensed, has no gap", () => {
  const result = clientGapAnalysis({
    clientId: "quickship-financial",
    state: "Colorado",
  });
  assert.equal(result.gap.netWorth.meetsRequirement, true);
  assert.equal(result.gap.suretyBond.meetsMinimum, true);
  assert.equal(result.gap.hasGap, false);
});

test("client-gap-analysis: Meridian expanding into Texas has a bond gap, not a net-worth gap", () => {
  const result = clientGapAnalysis({ clientId: "meridian-payments", state: "Texas" });
  assert.equal(result.gap.netWorth.meetsRequirement, true);
  assert.equal(result.gap.suretyBond.posted, false);
  assert.equal(result.gap.hasGap, true);
});

test("client-gap-analysis: unknown client id returns the get-client not-found shape", () => {
  const result = clientGapAnalysis({ clientId: "nope", state: "Texas" });
  assert.equal(result.found, false);
});

test("client-gap-analysis: unknown state returns the get-state-requirements unknown shape", () => {
  const result = clientGapAnalysis({ clientId: "meridian-payments", state: "Wakanda" });
  assert.equal(result.found, false);
});

test("validate-expansion-checklist: all four standard items done is complete", () => {
  const result = validateExpansionChecklist({
    checklist: [
      { item: "Surety bond quote obtained", status: "done" },
      { item: "Net worth statement prepared", status: "done" },
      { item: "NMLS filing drafted", status: "done" },
      { item: "Background checks for control persons", status: "done" },
    ],
  });
  assert.equal(result.complete, true);
  assert.deepEqual(result.missingItems, []);
});

test("validate-expansion-checklist: missing items are named, not just counted", () => {
  const result = validateExpansionChecklist({
    checklist: [{ item: "Surety bond quote obtained", status: "done" }],
  });
  assert.equal(result.complete, false);
  assert.deepEqual(result.missingItems, [
    "Net worth statement prepared",
    "NMLS filing drafted",
    "Background checks for control persons",
  ]);
});

test("validate-expansion-checklist: an extra item is flagged but doesn't block completeness", () => {
  const result = validateExpansionChecklist({
    checklist: [
      { item: "Surety bond quote obtained", status: "done" },
      { item: "Net worth statement prepared", status: "done" },
      { item: "NMLS filing drafted", status: "done" },
      { item: "Background checks for control persons", status: "done" },
      { item: "State-specific onboarding call", status: "pending" },
    ],
  });
  assert.equal(result.complete, true);
  assert.deepEqual(result.unexpectedItems, ["State-specific onboarding call"]);
});

test("validate-expansion-checklist: rejects a checklist item status outside the enum", () => {
  assert.throws(() =>
    validateExpansionChecklist({ checklist: [{ item: "x", status: "in_review" }] }),
  );
});

test("validate-client-checklist: Quickship's Arizona engagement is already complete", () => {
  const result = validateClientChecklist({
    clientId: "quickship-financial",
    state: "Arizona",
  });
  assert.equal(result.found, true);
  assert.equal(result.complete, true);
});

test("validate-client-checklist: Meridian's Texas engagement is missing two items", () => {
  const result = validateClientChecklist({
    clientId: "meridian-payments",
    state: "Texas",
  });
  assert.equal(result.complete, false);
  assert.deepEqual(result.missingItems, [
    "NMLS filing drafted",
    "Background checks for control persons",
  ]);
});

test("validate-client-checklist: unknown client id is an explicit not-found result", () => {
  const result = validateClientChecklist({ clientId: "nope", state: "Texas" });
  assert.equal(result.found, false);
});

test("validate-client-checklist: a state the client has no engagement in is explicit", () => {
  const result = validateClientChecklist({
    clientId: "meridian-payments",
    state: "Washington",
  });
  assert.equal(result.found, false);
  assert.match(result.message, /no licensing engagement/i);
});

// update-checklist-item.mjs mutates the in-memory client dataset shared by
// every tool above — these tests must run last in this file (see the header
// comment). Meridian's Texas "NMLS filing drafted" item starts "pending".
test("update-checklist-item: flips a pending item to done and bumps lastUpdated", () => {
  const before = getClientProgress({ clientId: "meridian-payments", state: "Texas" });
  const originalLastUpdated = before.engagement.lastUpdated;

  const result = updateChecklistItem({
    clientId: "meridian-payments",
    state: "Texas",
    item: "NMLS filing drafted",
    status: "done",
  });

  assert.equal(result.changed, true);
  assert.equal(result.engagement.lastUpdated === originalLastUpdated, false);

  const checklistItem = result.engagement.checklist.find(
    (c) => c.item === "NMLS filing drafted",
  );
  assert.equal(checklistItem.status, "done");
});

test("update-checklist-item: calling it again with identical input is a true no-op", () => {
  const first = updateChecklistItem({
    clientId: "meridian-payments",
    state: "Texas",
    item: "Background checks for control persons",
    status: "done",
  });
  assert.equal(first.changed, true);
  const lastUpdatedAfterFirstCall = first.engagement.lastUpdated;

  const second = updateChecklistItem({
    clientId: "meridian-payments",
    state: "Texas",
    item: "Background checks for control persons",
    status: "done",
  });

  assert.equal(second.changed, false);
  assert.equal(second.engagement.lastUpdated, lastUpdatedAfterFirstCall);
});

test("update-checklist-item: Texas is now complete after the two updates above", () => {
  const result = validateClientChecklist({ clientId: "meridian-payments", state: "Texas" });
  assert.equal(result.complete, true);
});

test("update-checklist-item: setting an already-done item to done is a no-op from the start", () => {
  const result = updateChecklistItem({
    clientId: "meridian-payments",
    state: "Texas",
    item: "Surety bond quote obtained",
    status: "done",
  });
  assert.equal(result.changed, false);
});

test("update-checklist-item: unknown client id is explicit, not a crash", () => {
  const result = updateChecklistItem({
    clientId: "nope",
    state: "Texas",
    item: "Surety bond quote obtained",
    status: "done",
  });
  assert.equal(result.found, false);
});

test("update-checklist-item: a state the client has no engagement in is explicit", () => {
  const result = updateChecklistItem({
    clientId: "meridian-payments",
    state: "Washington",
    item: "Surety bond quote obtained",
    status: "done",
  });
  assert.equal(result.changed, false);
  assert.match(result.message, /no licensing engagement/i);
});

test("update-checklist-item: an unknown checklist item is explicit, not a crash", () => {
  const result = updateChecklistItem({
    clientId: "meridian-payments",
    state: "Texas",
    item: "Made-up item",
    status: "done",
  });
  assert.equal(result.changed, false);
  assert.match(result.message, /no checklist item/i);
});

test("update-checklist-item: rejects a status outside the pending/done enum", () => {
  assert.throws(() =>
    updateChecklistItem({
      clientId: "meridian-payments",
      state: "Texas",
      item: "Surety bond quote obtained",
      status: "in_review",
    }),
  );
});
