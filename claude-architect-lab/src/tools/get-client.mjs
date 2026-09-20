import { z } from "zod";
import { loadClientDataset } from "../lib/load-data.mjs";

export const name = "get_client";

export const description =
  "Look up one client's full case file by clientId from the sample dataset.";

export const inputSchema = z.object({
  clientId: z.string().min(1).describe('Client id, e.g. "meridian-payments".'),
});

export function getClient(rawInput) {
  const { clientId } = inputSchema.parse(rawInput);
  const { clients } = loadClientDataset();
  const match = clients.find((c) => c.clientId === clientId);

  if (!match) {
    return {
      found: false,
      clientId,
      message: `Unknown client id "${clientId}" — not in the sample dataset.`,
    };
  }

  return { found: true, client: match };
}
