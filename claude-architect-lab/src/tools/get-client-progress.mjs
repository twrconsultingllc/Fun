import { z } from "zod";
import { loadClientDataset } from "../lib/load-data.mjs";

export const name = "get_client_progress";

export const description =
  "Get one client's licensing engagements (per-state progress and checklist), " +
  "optionally filtered to a single state.";

export const inputSchema = z.object({
  clientId: z.string().min(1).describe('Client id, e.g. "meridian-payments".'),
  state: z
    .string()
    .min(1)
    .optional()
    .describe("Optional US state name to filter to one engagement (case-insensitive)."),
});

export function getClientProgress(rawInput) {
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

  if (!state) {
    return { found: true, clientId, engagements: client.licensingEngagements };
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
      engagement: null,
      message: `No licensing engagement found for ${clientId} in ${state}.`,
    };
  }

  return { found: true, clientId, state, engagement };
}
