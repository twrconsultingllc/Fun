// The licensingEngagements.status enum from study/plan.html section 05.
export const ENGAGEMENT_STATUSES = [
  "not_started",
  "gathering_documents",
  "submitted",
  "under_regulator_review",
  "deficiency_response",
  "approved",
  "denied",
  "withdrawn",
  "renewal_due",
  "amendment_in_progress",
];

// A checklist item's own status, distinct from the engagement-level enum
// above — every sample checklist item is only ever "pending" or "done".
export const CHECKLIST_ITEM_STATUSES = ["pending", "done"];

// The standard four-item checklist used across every sample engagement in
// mcp-server/data/clients.json (see study/plan.html section 05's example).
export const STANDARD_CHECKLIST_ITEMS = [
  "Surety bond quote obtained",
  "Net worth statement prepared",
  "NMLS filing drafted",
  "Background checks for control persons",
];
