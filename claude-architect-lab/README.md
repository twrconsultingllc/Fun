# Claude Architect Lab

An exam-prep project for the Claude Certified Architect (Foundations) exam,
built around one throughline scenario — a money-transmitter-licensing (MTL)
consulting firm managing client expansions — so every exam-tested concept
has somewhere real to live instead of a disconnected snippet. The full
design is in [`study/plan.html`](../study/plan.html); the ten-session build
log that tracks real progress against that design (including what's still
open) is [`study/build-plan.html`](../study/build-plan.html) — check that
page's session statuses before trusting anything below as finished.

All data in this project — every client, every state's requirements, every
dollar figure — is fictitious sample data, marked `(sample)` inline
throughout. None of it is legal or regulatory advice.

## Setup

```bash
cd claude-architect-lab
npm install
cp .env.example .env   # then fill in ANTHROPIC_API_KEY=...
npm test                # every suite passes with zero network calls
```

`.env` is loaded via Node's built-in `process.loadEnvFile()` — no `dotenv`
dependency. It's covered by the repo root `.gitignore`'s `.env`/`.env.*`
patterns, same as everywhere else in this repo.

## Running the lab sessions

`npm test` runs every stubbed/deterministic test in `tests/` — zero live
API calls, safe to run any time. The `lab:N` scripts below are the real,
manual runs against the live API; each needs `ANTHROPIC_API_KEY` set.

| Script | File | What it demonstrates |
| --- | --- | --- |
| `npm run lab:1` | `src/agent-loop.mjs` | The hand-rolled gather → act → verify loop, run against the Meridian CA/NY → TX/FL/IL scenario. |
| `npm run lab:2` | `src/structured-output.mjs` | The expansion checklist forced into validated structured JSON. |
| `npm run lab:3` | `src/review-loop.mjs` | Draft → self-critique → revise, checklist into a prose compliance memo. |
| `npm run lab:4` | `src/context-budget.mjs` | Compaction and prompt-caching before/after, measured over every state and client. |
| `npm run lab:5` | `src/orchestrator.mjs` | The research-worker/writing-worker split, merged into one memo. |
| `npm run lab:6` | `sdk-version/agent.mjs` | The same MCP server driven through the Claude Agent SDK instead of a hand-rolled loop. |

**`sdk-version/agent.mjs`'s true end-to-end behavior is manual-run-and-eyeball
only** — there is no `tests/sdk-version.test.mjs` that exercises a real SDK
session, only `tests/hooks.test.mjs`, which calls its `PreToolUse` hook
directly with fabricated input. Confirming that the hook actually fires
during a real session, and that the `mcp__mtl__*` tools are actually
reachable through it, requires running it and reading the output — the same
convention `battle-bots-v2.core.test.mjs` already uses elsewhere in this
repo for a file whose real behavior can't be verified from this sandbox.
Same caveat, lighter version, for `src/review-loop.mjs` and
`src/orchestrator.mjs`: both have real, passing logic tests for everything
that doesn't require a live model call, but neither has been read end to
end against real model output yet — see `study/build-plan.html` for exactly
which real runs are still outstanding.

## Exam-domain crib sheet

| Domain (weight) | Files | Verified? |
| --- | --- | --- |
| Agentic Architecture & Orchestration (27%) | `src/agent-loop.mjs` (explicit gather/act/verify with a hard per-phase turn cap and code-based, not model-based, verification), `src/orchestrator.mjs` (research worker + writing worker, merged) | `agent-loop.mjs` has 7 passing tests (`tests/agent-loop.test.mjs`) covering turn-cap enforcement and verify-phase branching; `orchestrator.mjs`'s wiring was smoke-checked once, uncommitted, since it has no dedicated test file by design. Neither has been read end to end against real model output yet. |
| Claude Code Configuration & Workflows (20%) | `sdk-version/agent.mjs` (Agent SDK `query()` config: `systemPrompt`, `allowedTools`, `permissionMode`, `mcpServers`, one `PreToolUse` hook), `.claude/agents/mtl-compliance-reviewer.md` | The hook has a real, non-trivial logic test (`tests/hooks.test.mjs`). The "authentication" half of this domain isn't separately demonstrated — this file relies on the same `ANTHROPIC_API_KEY` env var every other file in this project does, not an alternate auth flow. Manual-run-and-eyeball only for the rest; see the caveat above. |
| Prompt Engineering & Context Management (20%) | `src/structured-output.mjs` (`output_config.format` + bounded retry on invalid output), `src/review-loop.mjs` (draft → critique → revise prompt chain) | `structured-output.mjs`'s retry logic is fully tested (`tests/structured-output.test.mjs`, 4 tests: first-try success, retry-then-success, exhausting every attempt, and the default attempt count). `review-loop.mjs` has no dedicated test file by design (see divergences below) — its chaining was smoke-checked once, uncommitted. |
| Tool Design & MCP (18%) | `src/tools/*.mjs` (all ten tools — schema design and real "not found" paths on every lookup, `update-checklist-item.mjs` as the one side-effecting, idempotent tool, `evaluate-change-impact.mjs` as the deliberately "thin," judgment-not-lookup stretch tool), `mcp-server/server.mjs` (eight registered tools plus the `mtl://dataset` and `mtl-clients://{clientId}` resources), `sdk-version/agent.mjs`'s `mcpServers` wiring | The most thoroughly verified domain — every tool has direct unit tests, and every registered MCP tool plus both resources has a real `Client`↔`Server` protocol round-trip test (`tests/mcp-server.test.mjs`). `sdk-version/agent.mjs`'s `mcpServers` wiring itself is still manual-run-and-eyeball only. |
| Context Management (15%) | `src/context-budget.mjs` (compaction trigger + before/after token counts; one `cache_control` breakpoint over the full state dataset; `estimateCost()` against Anthropic's published pricing) | The compaction-threshold math and cache accounting are fully tested against a stubbed client (`tests/context-budget.test.mjs`, 10 tests). The *real* measured token counts this file exists to produce — the actual source of the cost-model numbers below — haven't been measured yet; see the next section. |

## Cost model: measured vs. estimated

[`study/plan.html` section 10](../study/plan.html#cost) built a cost model
from Anthropic's published per-token pricing as a prediction, before any of
this project's code existed. Re-checked live against
[`platform.claude.com/docs/en/about-claude/pricing`](https://platform.claude.com/docs/en/about-claude/pricing)
on 2026-09-21:

| Model | Input / MTok | Output / MTok | 5-min cache write | Cache read |
| --- | --- | --- | --- | --- |
| Claude Haiku 4.5 | $1.00 | $5.00 | 1.25x input | 0.1x input |
| Claude Sonnet 5 | $2.00 | $10.00 | 1.25x input | 0.1x input |
| Claude Opus 5 | $5.00 | $25.00 | 1.25x input | 0.1x input |

**Zero drift.** Every number in plan.html section 10 — including the 1.25x
(5-minute) cache-write multiplier and the 0.1x cache-read multiplier that
`context-budget.mjs`'s `estimateCost()` hardcodes — still matches
Anthropic's current published pricing exactly. One thing worth flagging
even though it didn't end up mattering here: the current pricing page notes
that Claude Sonnet 5's $2/$10 pricing was introductory through August 31,
2026, with a scheduled increase to $3/$15 that was ultimately **not**
applied — the $2/$10 rate is now the standard, permanent price. Had that
increase gone through instead, every dollar figure in plan.html section 10
and every default in `context-budget.mjs`'s `PRICING_USD_PER_MTOK` table
would have needed a real update, not just a re-verification. This is
exactly the kind of drift the "verified, not recalled" habit from plan.html
section 02 exists to catch before it goes unnoticed.

**The real measured numbers are still pending.** `context-budget.mjs`'s
whole reason to exist is to replace section 10's *estimated* per-query cost
(~$0.009–$0.02 uncached, ~$0.005–$0.017 with caching, at this lab's small
scale) with real, measured before/after token counts for both compaction
and prompt caching. That real run needs `ANTHROPIC_API_KEY` and hasn't
happened yet — see `study/build-plan.html` Session 7's notes for exactly
what's built and tested versus what's still outstanding. This section gets
a real "predicted vs. measured, and where they agreed or disagreed"
comparison once that run happens; recording a placeholder here rather than
inventing numbers is deliberate, not an oversight.

## Known divergences from the plan

`study/plan.html` is the source of truth; where the actual build differs,
here's what changed and why:

- **A small shared `src/lib/` layer** (`load-data.mjs`, `constants.mjs`,
  `gap.mjs`, `checklist.mjs`) exists alongside the tools plan.html's
  directory layout names — needed because several tools share the same
  dataset loaders, status enums, dollar-string parsing, and checklist
  logic. Not a redesign, just an implementation detail the plan didn't
  itemize.
- **`zod`'s version wasn't pinned in plan.html**; a live check in Session 1
  found 4.6.5 (a major version ahead of the 3.x a recalled guess would have
  produced) and that's what got pinned. Later, `src/agent-loop.mjs` and
  `src/structured-output.mjs` both convert tool schemas to JSON Schema via
  zod 4's own built-in `z.toJSONSchema()` — no separate
  `zod-to-json-schema` package needed, which plan.html's "minimal
  dependencies" list didn't anticipate one way or the other.
- **`tests/client-tools.test.mjs` absorbed four tools' worth of tests**
  (`gap-analysis`, `validate-expansion-checklist`, `validate-client-checklist`,
  and later `evaluate-change-impact`) that plan.html's own test-file list
  never assigned a home to individually, rather than spinning up a new file
  for a handful of small tool tests each time.
- **`review-loop.mjs` and `orchestrator.mjs` deliberately have no dedicated
  unit test file** — plan.html's own `tests/` list never assigns either one
  a test file, the same precedent `sdk-version/agent.mjs` sets for a file
  whose true behavior is manual-run-and-eyeball only. Each was smoke-checked
  once against a throwaway stubbed client before moving on, not committed.
- **`evaluate-change-impact.mjs` got registered as the MCP server's eighth
  tool, with matching protocol-test coverage added to
  `tests/mcp-server.test.mjs`**, even though Session 8's own task list in
  build-plan.html never named that step explicitly — plan.html section 07's
  directory layout already documented `server.mjs` as exposing it, and every
  other registered tool already had that coverage, so leaving it out would
  have been a real gap for this session to catch, not a deliberate scope
  boundary.
- **`context-budget.mjs`'s compaction threshold (6,000 tokens) and
  `orchestrator.mjs`'s default 5-target-state list** (`Texas, Florida,
  Illinois, Washington, Georgia`) are both judgment calls plan.html didn't
  pin down: the threshold is deliberately low so it can actually fire
  against this lab's small dataset, and the last two target states aren't
  ones Meridian has an existing `licensingEngagements` entry for yet —
  fine, since `client_gap_analysis` only needs a client's financials and a
  state's requirements, not a pre-existing engagement.
- **`sdk-version/agent.mjs` needed `"Task"` in `allowedTools`**, not just
  the four read-only `mcp__mtl__*` lookup tools plan.html's task list named
  — confirmed by reading the installed `@anthropic-ai/claude-agent-sdk`
  SDK's own types rather than assumed, since subagent delegation to
  `.claude/agents/mtl-compliance-reviewer.md` happens through the `Task`
  tool.
