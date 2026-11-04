import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { runCore, TURN_ABORTED_NOTICE } from "./agent/core.ts";
import { Journal, findUnfinishedTurn } from "./session/journal.ts";
import { Sessions } from "./session/sessions.ts";
import { McpTools, type McpServerConfig } from "./mcp/mcp.ts";
import { readFile } from "node:fs/promises";
import { ToolRegistry } from "./agent/tools.ts";
import { Workspace } from "./workspace/workspace.ts";
import { registerFileTools } from "./workspace/file-tools.ts";
import { ModelManager } from "./providers/model-manager.ts";
import { createOllamaProvider } from "./providers/ollama.ts";
import { createOpenAIProvider, createResponsesProvider } from "./providers/openai.ts";
import { ProviderRegistry } from "./providers/providers.ts";

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
let tools = new McpTools();
const registry = new ToolRegistry();
const workspace = await Workspace.open(process.env.ATHENA_WORKSPACE ?? process.cwd());
registerFileTools(registry, workspace);
let mcpConfig: McpServerConfig | undefined;
if (process.env.ATHENA_MCP_CONFIG) {
  const config = JSON.parse(await readFile(process.env.ATHENA_MCP_CONFIG, "utf8")) as { mcpServers: McpServerConfig };
  mcpConfig = config.mcpServers;
  await tools.connect(mcpConfig, registry, workspace.root);
}
const model = new ModelManager(providers, { provider: process.env.ATHENA_PROVIDER ?? DEFAULT_PROVIDER }, workspace);
const [initialProvider, initialName] = model.current.split(": ");
const sessions = Sessions.open(workspace.root, initialProvider, initialName);
const previous = Journal.load(sessions.journal.path);
for (const warning of previous.warnings) stdout.write(`Journal warning: ${warning}\n`);
if (previous.events.length) {
  try {
    const interrupted = !!findUnfinishedTurn(previous.events);
    await model.restore(previous.events, interrupted ? TURN_ABORTED_NOTICE : "");
    stdout.write(interrupted ? "Recovered interrupted session. Side effects were not replayed.\n" : "Resumed session.\n");
  } catch (error) {
    stdout.write(`Session restore failed: ${error instanceof Error ? error.message : String(error)}. Starting a new session.\n`);
    sessions.create(initialProvider, initialName);
    model.reset();
  }
} else if (sessions.active.provider !== initialProvider || sessions.active.model !== initialName) {
  await model.select(sessions.active.provider, sessions.active.model);
}
const journal = sessions.journal;
const switchWorkspace = async (path: string): Promise<void> => {
  const candidate = await Workspace.open((await import("node:path")).resolve(workspace.root, path));
  const nextRegistry = new ToolRegistry();
  registerFileTools(nextRegistry, workspace);
  const nextTools = new McpTools();
  try {
    if (mcpConfig) await nextTools.connect(mcpConfig, nextRegistry, candidate.root);
  } catch (error) { await nextTools.close(); throw error; }
  const oldTools = tools;
  await workspace.switchTo(candidate.root);
  registry.replaceFrom(nextRegistry);
  tools = nextTools;
  await oldTools.close().catch((error: unknown) => {
    stdout.write(`Previous MCP connection close warning: ${error instanceof Error ? error.message : String(error)}\n`);
  });
};
const terminal = createInterface({ input: stdin, crlfDelay: Infinity });

try {
  await runCore(model, registry, {
    [Symbol.asyncIterator]: () => terminal[Symbol.asyncIterator](),
    write: (text) => stdout.write(text),
  }, workspace, model, journal, { sessions, switchWorkspace });
} finally {
  terminal.close();
  await tools.close();
}
