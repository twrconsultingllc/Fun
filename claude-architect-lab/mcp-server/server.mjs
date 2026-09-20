import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import * as getStateRequirementsTool from "../src/tools/get-state-requirements.mjs";
import * as getClientTool from "../src/tools/get-client.mjs";
import * as listClientsTool from "../src/tools/list-clients.mjs";
import * as getClientProgressTool from "../src/tools/get-client-progress.mjs";
import * as gapAnalysisTool from "../src/tools/gap-analysis.mjs";
import * as clientGapAnalysisTool from "../src/tools/client-gap-analysis.mjs";
import * as updateChecklistItemTool from "../src/tools/update-checklist-item.mjs";

import { loadStateDataset, loadClientDataset } from "../src/lib/load-data.mjs";

// validate-expansion-checklist.mjs and validate-client-checklist.mjs are
// deliberately NOT registered below — study/plan.html section 07 and
// study/build-plan.html's Session 3 both call out that the deterministic
// "verify" tools stay internal, never exposed as MCP tools. evaluate-
// change-impact.mjs (the Session 8 stretch tool) doesn't exist yet.
const TOOLS = [
  {
    name: getStateRequirementsTool.name,
    description: getStateRequirementsTool.description,
    inputSchema: getStateRequirementsTool.inputSchema,
    handler: getStateRequirementsTool.getStateRequirements,
  },
  {
    name: getClientTool.name,
    description: getClientTool.description,
    inputSchema: getClientTool.inputSchema,
    handler: getClientTool.getClient,
  },
  {
    name: listClientsTool.name,
    description: listClientsTool.description,
    inputSchema: listClientsTool.inputSchema,
    handler: listClientsTool.listClients,
  },
  {
    name: getClientProgressTool.name,
    description: getClientProgressTool.description,
    inputSchema: getClientProgressTool.inputSchema,
    handler: getClientProgressTool.getClientProgress,
  },
  {
    name: gapAnalysisTool.name,
    description: gapAnalysisTool.description,
    inputSchema: gapAnalysisTool.inputSchema,
    handler: gapAnalysisTool.gapAnalysis,
  },
  {
    name: clientGapAnalysisTool.name,
    description: clientGapAnalysisTool.description,
    inputSchema: clientGapAnalysisTool.inputSchema,
    handler: clientGapAnalysisTool.clientGapAnalysis,
  },
  {
    name: updateChecklistItemTool.name,
    description: updateChecklistItemTool.description,
    inputSchema: updateChecklistItemTool.inputSchema,
    handler: updateChecklistItemTool.updateChecklistItem,
  },
];

function toolResult(result) {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

export function createServer() {
  const server = new McpServer({
    name: "claude-architect-lab-mcp-server",
    version: "0.1.0",
  });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (args) => toolResult(tool.handler(args)),
    );
  }

  // "Pull everything up front" resources — the counterpart to the "look up
  // or compute one thing" tools above (study/plan.html section 07).
  server.registerResource(
    "mtl-dataset",
    "mtl://dataset",
    {
      title: "MTL state requirements dataset",
      description:
        "The full sample money-transmitter-licensing requirements dataset " +
        "for every state, pulled up front rather than looked up one state " +
        "at a time.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(loadStateDataset(), null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    "mtl-client",
    new ResourceTemplate("mtl-clients://{clientId}", { list: undefined }),
    {
      title: "MTL client case file",
      description:
        "One client's full case file (profile, control persons, licensing " +
        "engagements), pulled up front by clientId rather than queried " +
        "field by field.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const { clients } = loadClientDataset();
      const client = clients.find((c) => c.clientId === variables.clientId);

      const body = client ?? {
        found: false,
        clientId: variables.clientId,
        message: `Unknown client id "${variables.clientId}" — not in the sample dataset.`,
      };

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(body, null, 2),
          },
        ],
      };
    },
  );

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("MTL MCP server failed to start:", error);
    process.exit(1);
  });
}
