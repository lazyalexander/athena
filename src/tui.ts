import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { runCore } from "./core.ts";
import { McpTools, type McpServerConfig } from "./mcp.ts";
import { readFile } from "node:fs/promises";
import { ToolRegistry } from "./tools.ts";
import { Workspace } from "./workspace.ts";
import { registerFileTools } from "./file-tools.ts";
import { ModelManager, type ModelProvider } from "./model-manager.ts";

const provider = (process.env.ATHENA_PROVIDER ?? "ollama") as ModelProvider;
if (provider !== "ollama" && provider !== "openai") throw new Error(`Unknown provider: ${provider}`);
const tools = new McpTools();
const registry = new ToolRegistry();
const workspace = await Workspace.open(process.env.ATHENA_WORKSPACE ?? process.cwd());
registerFileTools(registry, workspace);
if (process.env.ATHENA_MCP_CONFIG) {
  const config = JSON.parse(await readFile(process.env.ATHENA_MCP_CONFIG, "utf8")) as { mcpServers: McpServerConfig };
  await tools.connect(config.mcpServers, registry, workspace.root);
}
const model = new ModelManager({
  provider,
  ollamaModel: process.env.OLLAMA_MODEL,
  ollamaHost: process.env.OLLAMA_HOST,
  openaiModel: process.env.OPENAI_MODEL,
  apiKey: process.env.OPENAI_API_KEY,
  apiBaseUrl: process.env.ATHENA_API_BASE_URL,
}, workspace);
const terminal = createInterface({ input: stdin, crlfDelay: Infinity });

try {
  await runCore(model, registry, {
    [Symbol.asyncIterator]: () => terminal[Symbol.asyncIterator](),
    write: (text) => stdout.write(text),
  }, workspace, model);
} finally {
  terminal.close();
  await tools.close();
}
