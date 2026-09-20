import { z } from "zod";
import { loadClientDataset } from "../lib/load-data.mjs";
import { CHECKLIST_ITEM_STATUSES } from "../lib/constants.mjs";

// Design decision (study/build-plan.html Session 3): this tool mutates the
// client dataset that load-data.mjs cached in memory the first time this
// process read it — it never writes mcp-server/data/clients.json back to
// disk. A lab run is one Node process at a time; persisting to disk would
// make repeated test runs and repeated agent-loop runs against the same
// sample data non-idempotent across process restarts, and risks corrupting
// the committed sample dataset. Every `npm test` invocation starts a fresh
// process, so mutations never survive between runs.
//
// Idempotency: calling this twice with an identical
// {clientId, state, item, status} is a true no-op the second time. If the
// item's status already equals the requested status, the tool returns
// changed:false and leaves engagement.lastUpdated untouched. It only flips
// the status and bumps lastUpdated when the call actually changes something.

export const name = "update_checklist_item";

export const description =
  "Update one checklist item's status on a client's state engagement. The " +
  "one tool in this project with a side effect — mutates the in-memory " +
  "client dataset and returns the updated engagement, idempotently.";

export const inputSchema = z.object({
  clientId: z.string().min(1),
  state: z
    .string()
    .min(1)
    .describe("US state name matching one of the client's existing licensingEngagements."),
  item: z.string().min(1).describe("Exact checklist item text to update."),
  status: z.enum(CHECKLIST_ITEM_STATUSES),
});

export function updateChecklistItem(rawInput) {
  const { clientId, state, item, status } = inputSchema.parse(rawInput);
  const { clients } = loadClientDataset();
  const client = clients.find((c) => c.clientId === clientId);

  if (!client) {
    return {
      found: false,
      clientId,
      message: `Unknown client id "${clientId}" — not in the sample dataset.`,
    };
  }

  const normalized = state.trim().toLowerCase();
  const engagement = client.licensingEngagements.find(
    (e) => e.state.toLowerCase() === normalized,
  );

  if (!engagement) {
    return {
      found: true,
      clientId,
      state,
      changed: false,
      message: `No licensing engagement found for ${clientId} in ${state}; nothing to update.`,
    };
  }

  const checklistItem = engagement.checklist.find((c) => c.item === item);

  if (!checklistItem) {
    return {
      found: true,
      clientId,
      state: engagement.state,
      changed: false,
      message: `No checklist item "${item}" found on ${clientId}'s ${engagement.state} engagement.`,
    };
  }

  if (checklistItem.status === status) {
    return {
      found: true,
      clientId,
      state: engagement.state,
      item,
      status,
      changed: false,
      engagement,
    };
  }

  checklistItem.status = status;
  engagement.lastUpdated = `${new Date().toISOString().slice(0, 10)} (sample)`;

  return {
    found: true,
    clientId,
    state: engagement.state,
    item,
    status,
    changed: true,
    engagement,
  };
}
