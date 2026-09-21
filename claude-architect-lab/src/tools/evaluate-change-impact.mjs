import { z } from "zod";
import { loadClientDataset } from "../lib/load-data.mjs";

export const name = "evaluate_change_impact";

// study/plan.html section 06: deliberately a "thinner" tool. It surfaces
// which states a client currently touches and the raw facts about a
// pending change — it never encodes "which ownership changes trigger which
// state's refiling rules" as a lookup table, because that can't actually be
// sourced. The materiality judgment stays with whoever calls this tool.
export const description =
  "Given one of a client's pending changes (e.g. a new control person), " +
  "returns which states the client currently touches and the raw facts " +
  "relevant to that change — never a verdict on whether any specific state " +
  "actually requires an amendment or a fresh disclosure.";

export const inputSchema = z.object({
  clientId: z.string().min(1),
  changeIndex: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Index into the client's pendingChanges array; defaults to 0, the first pending change."),
});

export function evaluateChangeImpact(rawInput) {
  const { clientId, changeIndex = 0 } = inputSchema.parse(rawInput);
  const { clients } = loadClientDataset();
  const client = clients.find((c) => c.clientId === clientId);

  if (!client) {
    return {
      found: false,
      clientId,
      message: `Unknown client id "${clientId}" — not in the sample dataset.`,
    };
  }

  const pendingChanges = client.pendingChanges ?? [];
  const change = pendingChanges[changeIndex];

  if (!change) {
    return {
      found: true,
      clientId,
      change: null,
      touchedStates: [],
      message:
        pendingChanges.length === 0
          ? `${clientId} has no pending changes on record.`
          : `No pending change at index ${changeIndex} — ${clientId} has ${pendingChanges.length}.`,
    };
  }

  const licensedStates = client.businessProfile.statesCurrentlyLicensed.map((state) => ({
    state,
    relationship: "currently_licensed",
    engagementStatus: null,
    controlPersonChecklistItem: null,
  }));

  const engagementStates = client.licensingEngagements.map((engagement) => ({
    state: engagement.state,
    relationship: "active_engagement",
    engagementStatus: engagement.status,
    controlPersonChecklistItem:
      engagement.checklist.find((item) => item.item === "Background checks for control persons") ?? null,
  }));

  return {
    found: true,
    clientId,
    change,
    currentControlPersons: client.controlPersons,
    touchedStates: [...licensedStates, ...engagementStates],
    disclaimer:
      "This only lists the states the client currently touches and the raw " +
      "facts about the pending change — it does not determine whether any " +
      "specific state actually requires an amendment or a fresh background " +
      "disclosure. That judgment needs real research against each state's " +
      "regulator, or a model reasoning over these facts.",
  };
}
