export type ToolDefinition = {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
};

export interface Tool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>): Promise<string>;
}

export interface ToolSet {
  readonly definitions: readonly ToolDefinition[];
  call(name: string, args: unknown): Promise<string>;
}

export class ToolRegistry implements ToolSet {
  private readonly tools = new Map<string, Tool>();

  get definitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  register(tool: Tool): void {
    const name = tool.definition.name;
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`Invalid tool name: ${name}`);
    if (this.tools.has(name)) throw new Error(`Duplicate tool: ${name}`);
    this.tools.set(name, tool);
  }

  async call(name: string, args: unknown): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    if (args === null || typeof args !== "object" || Array.isArray(args)) {
      throw new Error("Tool arguments must be an object");
    }
    return tool.execute(args as Record<string, unknown>);
  }
}
