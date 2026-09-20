import { z } from "zod";
import { evaluateChecklist } from "../lib/checklist.mjs";
import { CHECKLIST_ITEM_STATUSES } from "../lib/constants.mjs";

export const name = "validate_expansion_checklist";

export const description =
  "Deterministically check a hypothetical expansion checklist (not tied to " +
  "any client) against the standard set of licensing checklist items, and " +
  "report exactly what's missing.";

export const inputSchema = z.object({
  checklist: z.array(
    z.object({
      item: z.string().min(1),
      status: z.enum(CHECKLIST_ITEM_STATUSES),
    }),
  ),
});

export function validateExpansionChecklist(rawInput) {
  const { checklist } = inputSchema.parse(rawInput);
  return evaluateChecklist(checklist);
}
