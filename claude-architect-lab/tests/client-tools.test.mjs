// Read-only client tools only, per study/build-plan.html Session 2.
// update-checklist-item and client-gap-analysis are added here in Session 3.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getClient } from "../src/tools/get-client.mjs";
import { listClients } from "../src/tools/list-clients.mjs";
import { getClientProgress } from "../src/tools/get-client-progress.mjs";

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
