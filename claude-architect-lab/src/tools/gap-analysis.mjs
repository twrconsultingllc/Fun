import { z } from "zod";
import { getStateRequirements } from "./get-state-requirements.mjs";
import { computeGap } from "../lib/gap.mjs";

export const name = "gap_analysis";

export const description =
  "Generic, client-free diff: given a hypothetical business's net worth and " +
  "posted surety bond, check them against one state's sample MTL requirements.";

export const inputSchema = z.object({
  state: z.string().min(1),
  netWorthUsd: z.number().nonnegative(),
  suretyBondPostedUsd: z.number().nonnegative().optional(),
});

export function gapAnalysis(rawInput) {
  const { state, netWorthUsd, suretyBondPostedUsd } = inputSchema.parse(rawInput);
  const stateResult = getStateRequirements({ state });
  if (!stateResult.found) return stateResult;

  const gap = computeGap({
    netWorthUsd,
    suretyBondPostedUsd: suretyBondPostedUsd ?? null,
    stateRequirements: stateResult,
  });

  return { found: true, state: stateResult.state, gap };
}
