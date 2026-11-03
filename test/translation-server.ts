import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "translation-test", version: "0.1.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "translate",
    description: "Translate a small test phrase to Chinese",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  }],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [{ type: "text", text: request.params.arguments?.text === "hello" ? "bonjour" : "unknown phrase" }],
}));
await server.connect(new StdioServerTransport());
