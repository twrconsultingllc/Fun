// A real Client<->Server round-trip over InMemoryTransport, per
// study/build-plan.html Session 4 — no subprocess, no network call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../mcp-server/server.mjs";

async function connectedClient() {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.1.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

function parseToolText(result) {
  return JSON.parse(result.content[0].text);
}

test("lists exactly the seven Session 2/3 tools — not the internal validate-*.mjs ones", async () => {
  const client = await connectedClient();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "client_gap_analysis",
    "gap_analysis",
    "get_client",
    "get_client_progress",
    "get_state_requirements",
    "list_clients",
    "update_checklist_item",
  ]);
});

test("get_state_requirements: a known state round-trips through the real protocol", async () => {
  const client = await connectedClient();
  const result = await client.callTool({
    name: "get_state_requirements",
    arguments: { state: "California" },
  });
  const parsed = parseToolText(result);
  assert.equal(parsed.found, true);
  assert.equal(parsed.state, "California");
});

test("get_state_requirements: an unknown state still returns the explicit not-found shape", async () => {
  const client = await connectedClient();
  const result = await client.callTool({
    name: "get_state_requirements",
    arguments: { state: "Wakanda" },
  });
  assert.equal(parseToolText(result).found, false);
});

test("get_client: returns the sample client's case file", async () => {
  const client = await connectedClient();
  const result = await client.callTool({
    name: "get_client",
    arguments: { clientId: "meridian-payments" },
  });
  assert.equal(parseToolText(result).client.legalName, "Meridian Payments LLC (sample)");
});

test("list_clients: filtered by engagement status over the real protocol", async () => {
  const client = await connectedClient();
  const result = await client.callTool({
    name: "list_clients",
    arguments: { engagementStatus: "gathering_documents" },
  });
  assert.deepEqual(
    parseToolText(result).clients.map((c) => c.clientId),
    ["meridian-payments"],
  );
});

test("get_client_progress: filtered to one state over the real protocol", async () => {
  const client = await connectedClient();
  const result = await client.callTool({
    name: "get_client_progress",
    arguments: { clientId: "meridian-payments", state: "Texas" },
  });
  assert.equal(parseToolText(result).engagement.status, "gathering_documents");
});

test("gap_analysis: a hypothetical business that clears both bars over the real protocol", async () => {
  const client = await connectedClient();
  const result = await client.callTool({
    name: "gap_analysis",
    arguments: { state: "Colorado", netWorthUsd: 200_000, suretyBondPostedUsd: 60_000 },
  });
  assert.equal(parseToolText(result).gap.hasGap, false);
});

test("client_gap_analysis: Northstar in Washington over the real protocol", async () => {
  const client = await connectedClient();
  const result = await client.callTool({
    name: "client_gap_analysis",
    arguments: { clientId: "northstar-remittance", state: "Washington" },
  });
  const parsed = parseToolText(result);
  assert.equal(parsed.gap.netWorth.meetsRequirement, true);
  assert.equal(parsed.gap.hasGap, true);
});

// Meridian's Florida engagement starts with "Surety bond quote obtained"
// pending — untouched by any other test in this file, so it's safe to
// mutate here.
test("update_checklist_item: mutates through the real protocol and is idempotent", async () => {
  const client = await connectedClient();

  const first = await client.callTool({
    name: "update_checklist_item",
    arguments: {
      clientId: "meridian-payments",
      state: "Florida",
      item: "Surety bond quote obtained",
      status: "done",
    },
  });
  assert.equal(parseToolText(first).changed, true);

  const second = await client.callTool({
    name: "update_checklist_item",
    arguments: {
      clientId: "meridian-payments",
      state: "Florida",
      item: "Surety bond quote obtained",
      status: "done",
    },
  });
  assert.equal(parseToolText(second).changed, false);
});

test("resource mtl://dataset returns the full state dataset up front", async () => {
  const client = await connectedClient();
  const result = await client.readResource({ uri: "mtl://dataset" });
  const parsed = JSON.parse(result.contents[0].text);
  assert.equal(parsed.states.length, 10);
  assert.ok(parsed.disclaimer);
});

test("resource mtl-clients://{clientId} returns one client's full case file", async () => {
  const client = await connectedClient();
  const result = await client.readResource({ uri: "mtl-clients://meridian-payments" });
  const parsed = JSON.parse(result.contents[0].text);
  assert.equal(parsed.clientId, "meridian-payments");
});

test("resource mtl-clients://{clientId} is explicit for an unknown client id, not a crash", async () => {
  const client = await connectedClient();
  const result = await client.readResource({ uri: "mtl-clients://nope" });
  const parsed = JSON.parse(result.contents[0].text);
  assert.equal(parsed.found, false);
});
