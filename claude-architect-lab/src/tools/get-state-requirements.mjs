import { z } from "zod";
import { loadStateDataset } from "../lib/load-data.mjs";

export const name = "get_state_requirements";

export const description =
  "Look up money-transmitter-licensing requirements for one US state from the " +
  "sample dataset. A state not present in the dataset comes back as an explicit " +
  "unknown result — never a guess.";

export const inputSchema = z.object({
  state: z
    .string()
    .min(1)
    .describe('US state name, e.g. "California" (case-insensitive, whitespace-trimmed).'),
});

export function getStateRequirements(rawInput) {
  const { state } = inputSchema.parse(rawInput);
  const normalized = state.trim().toLowerCase();
  const { disclaimer, states } = loadStateDataset();
  const match = states.find((s) => s.state.toLowerCase() === normalized);

  if (!match) {
    return {
      found: false,
      state,
      message:
        "Unknown state — not in the sample dataset. This needs real research " +
        "against NMLS and the state regulator; do not guess.",
      disclaimer,
    };
  }

  return { found: true, ...match };
}
