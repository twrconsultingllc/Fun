import { z } from "zod";
import { loadClientDataset } from "../lib/load-data.mjs";
import { evaluateChecklist } from "../lib/checklist.mjs";

export const name = "validate_client_checklist";

export const description =
  "Deterministically check whether one client's checklist for a given " +
  "state's engagement is complete against the standard set of licensing " +
  "checklist items — the code-based counterpart to a subagent review.";

export const inputSchema = z.object({
  clientId: z.string().min(1),
  state: z.string().min(1),
});

export function validateClientChecklist(rawInput) {
  const { clientId, state } = inputSchema.parse(rawInput);
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
      found: false,
      clientId,
      state,
      message: `No licensing engagement found for ${clientId} in ${state}.`,
    };
  }

  return {
    found: true,
    clientId,
    state: engagement.state,
    ...evaluateChecklist(engagement.checklist),
  };
}
