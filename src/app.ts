import { stdout } from "node:process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { TURN_ABORTED_NOTICE } from "./protocol/protocol.ts";
import { Journal, findUnfinishedTurn } from "./session/journal.ts";
import { Sessions } from "./session/sessions.ts";
import { McpTools, type McpServerConfig } from "./mcp/mcp.ts";
import { ToolRegistry } from "./agent/tools.ts";
import { Workspace } from "./workspace/workspace.ts";
import { registerFileTools } from "./workspace/file-tools.ts";
import { registerKnowledgeTool } from "./knowledge/knowledge.ts";
import { registerTimeTools } from "./agent/time-tools.ts";
import { ModelManager } from "./providers/model-manager.ts";
import { createProviderLayer } from "./providers/entry.ts";

export type AthenaApp = {
  model: ModelManager;
  registry: ToolRegistry;
  workspace: Workspace;
  sessions: Sessions;
  journal: Journal;
  switchWorkspace(path: string): Promise<void>;
  close(): Promise<void>;
};

/** Opens the shared runtime used by the command line and the TUI. */
export async function openApp(): Promise<AthenaApp> {
  const { registry: providers, defaultId } = createProviderLayer();
  let tools = new McpTools();
  const registry = new ToolRegistry();
  const workspace = await Workspace.open(process.env.ATHENA_WORKSPACE ?? process.cwd());
  registerFileTools(registry, workspace);
  registerTimeTools(registry);
  if (process.env.ATHENA_KNOWLEDGE_DIR) registerKnowledgeTool(registry, workspace, process.env.ATHENA_KNOWLEDGE_DIR);
  let mcpConfig: McpServerConfig | undefined;
  if (process.env.ATHENA_MCP_CONFIG) {
    const config = JSON.parse(await readFile(process.env.ATHENA_MCP_CONFIG, "utf8")) as { mcpServers: McpServerConfig };
    mcpConfig = config.mcpServers;
    await tools.connect(mcpConfig, registry, workspace.root);
  }
  const model = new ModelManager(providers, { provider: process.env.ATHENA_PROVIDER ?? defaultId }, workspace);
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
  const switchWorkspace = async (path: string): Promise<void> => {
    const candidate = await Workspace.open(resolve(workspace.root, path));
    const nextRegistry = new ToolRegistry();
    registerFileTools(nextRegistry, workspace);
    registerTimeTools(nextRegistry);
    if (process.env.ATHENA_KNOWLEDGE_DIR) registerKnowledgeTool(nextRegistry, workspace, process.env.ATHENA_KNOWLEDGE_DIR);
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
  return {
    model,
    registry,
    workspace,
    sessions,
    journal: sessions.journal,
    switchWorkspace,
    close: () => tools.close(),
  };
}
