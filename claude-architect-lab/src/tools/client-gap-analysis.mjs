import { z } from "zod";
import { getClient } from "./get-client.mjs";
import { getStateRequirements } from "./get-state-requirements.mjs";
import { computeGap, parseUsd } from "../lib/gap.mjs";

export const name = "client_gap_analysis";

export const description =
  "Client-aware gap analysis: diffs one real client's actual net worth and " +
  "posted surety bond for a given state against the sample MTL requirements " +
  "dataset — not a generic hypothetical gap.";

export const inputSchema = z.object({
  clientId: z.string().min(1),
  state: z.string().min(1),
});

export function clientGapAnalysis(rawInput) {
  const { clientId, state } = inputSchema.parse(rawInput);

  const clientResult = getClient({ clientId });
  if (!clientResult.found) return clientResult;

  const stateResult = getStateRequirements({ state });
  if (!stateResult.found) return stateResult;

  const netWorthUsd = parseUsd(clientResult.client.businessProfile.currentNetWorthUsd);
  const postedRaw = clientResult.client.businessProfile.suretyBondsPostedUsd[stateResult.state];
  const suretyBondPostedUsd = postedRaw != null ? parseUsd(postedRaw) : null;

  const gap = computeGap({ netWorthUsd, suretyBondPostedUsd, stateRequirements: stateResult });

  return { found: true, clientId, state: stateResult.state, gap };
}
