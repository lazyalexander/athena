import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { tmpdir } from "node:os";
import { ToolRegistry } from "../agent/tools.ts";
import { resolveSandboxExec, wrapSandboxed } from "../workspace/sandbox.ts";

export type McpServerConfig = Record<string, { command: string; args?: string[]; env?: Record<string, string>; sandbox?: boolean }>;
export class McpTools {
  private clients: Client[] = [];

  async connect(config: McpServerConfig, registry: ToolRegistry, cwd?: string): Promise<void> {
    try {
      const sandboxExec = await resolveSandboxExec();
      for (const [server, options] of Object.entries(config)) {
        if (!options.command || !Array.isArray(options.args ?? [])) throw new Error(`Invalid MCP server: ${server}`);
        const launch = options.sandbox === false || !cwd
          ? { command: options.command, args: options.args ?? [] }
          : wrapSandboxed(options.command, options.args ?? [], cwd, tmpdir(), sandboxExec);
        const client = new Client({ name: "athena", version: "0.1.0" });
        const transport = new StdioClientTransport({
          command: launch.command,
          args: launch.args,
          cwd,
          env: { ...process.env, ...options.env } as Record<string, string>,
        });
        await client.connect(transport);
        this.clients.push(client);
        const { tools } = await client.listTools();
        for (const tool of tools) {
          const name = `mcp_${server}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, "_");
          registry.register({
            definition: { name, description: tool.description, parameters: tool.inputSchema },
            execute: async (args) => JSON.stringify(await client.callTool({ name: tool.name, arguments: args })),
          });
        }
      }
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    await Promise.all(this.clients.map((client) => client.close()));
    this.clients = [];
  }
}
