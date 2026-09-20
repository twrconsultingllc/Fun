import { z } from "zod";
import { loadClientDataset } from "../lib/load-data.mjs";
import { ENGAGEMENT_STATUSES } from "../lib/constants.mjs";

export const name = "list_clients";

export const description =
  "List sample clients, optionally filtered to only those with at least one " +
  "licensing engagement in a given status.";

export const inputSchema = z.object({
  engagementStatus: z
    .enum(ENGAGEMENT_STATUSES)
    .optional()
    .describe(
      'Optional engagement-status filter, e.g. "gathering_documents". Omit to list every client.',
    ),
});

function summarize(client) {
  return {
    clientId: client.clientId,
    legalName: client.legalName,
    entityType: client.entityType,
    statesCurrentlyLicensed: client.businessProfile.statesCurrentlyLicensed,
    engagementStates: client.licensingEngagements.map((e) => e.state),
  };
}

export function listClients(rawInput = {}) {
  const { engagementStatus } = inputSchema.parse(rawInput);
  const { clients } = loadClientDataset();

  if (!engagementStatus) {
    return { clients: clients.map(summarize) };
  }

  const filtered = clients.filter((client) =>
    client.licensingEngagements.some((e) => e.status === engagementStatus),
  );

  return { clients: filtered.map(summarize), engagementStatus };
}
