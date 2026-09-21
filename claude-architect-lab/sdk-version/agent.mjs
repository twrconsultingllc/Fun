import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";

const SERVER_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "mcp-server",
  "server.mjs",
);

// Only the read-only lookup tools, plus Task so the model can delegate to
// the .claude/agents/mtl-compliance-reviewer.md subagent — no mutating
// tool (update_checklist_item, evaluate_change_impact) is exposed here.
// Naming a tool here is what auto-allows it without a permission prompt
// (study/build-plan.html Session 9), so permissionMode can stay 'default'.
export const ALLOWED_TOOLS = [
  "Task",
  "mcp__mtl__get_client",
  "mcp__mtl__get_state_requirements",
  "mcp__mtl__get_client_progress",
  "mcp__mtl__client_gap_analysis",
];

export const DEFAULT_PROMPT =
  "Using the mtl MCP server's tools, look up Meridian Payments' current " +
  "profile and its gap analysis for expanding into Texas. Draft a short " +
  "checklist from what you find, then delegate to the " +
  "mtl-compliance-reviewer subagent to review that checklist before " +
  "giving me your final answer.";

// Exported as a factory (not just the bound hook) so tests/hooks.test.mjs
// can call it directly with fabricated input and a fake logger — no live
// call, per study/plan.html section 11.
export function createPreToolUseHook({ log = (message) => console.error(message) } = {}) {
  return async function preToolUseHook(input, toolUseId) {
    log(`[PreToolUse] ${input.tool_name} (${toolUseId ?? "no-id"}): ${JSON.stringify(input.tool_input)}`);

    if (input.tool_name?.startsWith("mcp__mtl__")) {
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: `Auto-allowed: ${input.tool_name} is one of this lab's read-only MTL lookup tools.`,
        },
      };
    }

    return { continue: true };
  };
}

export const preToolUseHook = createPreToolUseHook();

export function buildQueryOptions({ hooks = [preToolUseHook] } = {}) {
  return {
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append:
        "You also have the mtl MCP server's money-transmitter-licensing " +
        "lookup tools available. Every figure they return is sample data " +
        "only — never present it as real regulatory guidance.",
    },
    allowedTools: ALLOWED_TOOLS,
    permissionMode: "default",
    mcpServers: {
      mtl: { type: "stdio", command: "node", args: [SERVER_PATH] },
    },
    hooks: { PreToolUse: [{ hooks }] },
  };
}

export async function runSdkAgent({ prompt = DEFAULT_PROMPT } = {}) {
  const messages = [];
  for await (const message of query({ prompt, options: buildQueryOptions() })) {
    messages.push(message);
  }
  return messages;
}

async function main() {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file is fine as long as ANTHROPIC_API_KEY is set some other way.
  }

  const messages = await runSdkAgent();
  for (const message of messages) {
    console.log(JSON.stringify(message).slice(0, 500));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("sdk-version/agent.mjs run failed:", error);
    process.exit(1);
  });
}
