import { STANDARD_CHECKLIST_ITEMS } from "./constants.mjs";

// Shared by validate-expansion-checklist.mjs (a hypothetical checklist) and
// validate-client-checklist.mjs (a real client+state engagement) — both
// need the same "is this complete against the standard items" logic.
export function evaluateChecklist(checklist) {
  const doneItems = checklist.filter((c) => c.status === "done").map((c) => c.item);
  const missingItems = STANDARD_CHECKLIST_ITEMS.filter((item) => !doneItems.includes(item));
  const unexpectedItems = checklist
    .map((c) => c.item)
    .filter((item) => !STANDARD_CHECKLIST_ITEMS.includes(item));

  return {
    complete: missingItems.length === 0,
    totalStandardItems: STANDARD_CHECKLIST_ITEMS.length,
    doneCount: STANDARD_CHECKLIST_ITEMS.length - missingItems.length,
    missingItems,
    unexpectedItems,
  };
}
