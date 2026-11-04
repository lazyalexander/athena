import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { runCore } from "./core.ts";
import { Journal } from "./journal.ts";
import { recoverPreviousSession } from "./recovery.ts";
import { McpTools, type McpServerConfig } from "./mcp.ts";
import { readFile } from "node:fs/promises";
import { ToolRegistry } from "./tools.ts";
import { Workspace } from "./workspace.ts";
import { registerFileTools } from "./file-tools.ts";
import { ModelManager } from "./model-manager.ts";
import { createOllamaProvider } from "./ollama.ts";
import { createOpenAIProvider, createResponsesProvider } from "./openai.ts";
import { ProviderRegistry } from "./providers.ts";

// ollama is the default only because it is the one provider that works without credentials.
const DEFAULT_PROVIDER = "ollama";
const providers = new ProviderRegistry();
providers.register(createOllamaProvider({ host: process.env.OLLAMA_HOST, model: process.env.OLLAMA_MODEL }));
providers.register(createOpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL,
  baseUrl: process.env.ATHENA_API_BASE_URL,
}));
providers.register(createResponsesProvider({
  id: "deepseek",
  keyEnv: "DEEPSEEK_API_KEY",
  apiKey: process.env.DEEPSEEK_API_KEY,
  model: process.env.DEEPSEEK_MODEL,
  baseUrl: "https://api.deepseek.com",
  defaultModel: "deepseek-chat",
}));
const tools = new McpTools();
const registry = new ToolRegistry();
const workspace = await Workspace.open(process.env.ATHENA_WORKSPACE ?? process.cwd());
registerFileTools(registry, workspace);
if (process.env.ATHENA_MCP_CONFIG) {
  const config = JSON.parse(await readFile(process.env.ATHENA_MCP_CONFIG, "utf8")) as { mcpServers: McpServerConfig };
  await tools.connect(config.mcpServers, registry, workspace.root);
}
const model = new ModelManager(providers, { provider: process.env.ATHENA_PROVIDER ?? DEFAULT_PROVIDER }, workspace);

await recoverPreviousSession(workspace.root, model, (text) => stdout.write(text));
const journal = Journal.open(workspace.root, (message) => stdout.write(`Journal warning: ${message}\n`));
const terminal = createInterface({ input: stdin, crlfDelay: Infinity });

try {
  await runCore(model, registry, {
    [Symbol.asyncIterator]: () => terminal[Symbol.asyncIterator](),
    write: (text) => stdout.write(text),
  }, workspace, model, journal);
} finally {
  terminal.close();
  await tools.close();
}
