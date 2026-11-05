export type ToolDefinition = {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
};

export interface Tool {
  definition: ToolDefinition;
  /** Optional tool-owned check immediately before execution; rejection skips execute. */
  beforeExecute?: (args: Record<string, unknown>) => Promise<PreconditionDecision> | PreconditionDecision;
  execute(args: Record<string, unknown>): Promise<string>;
}

export type PreconditionDecision = { allowed: true } | { allowed: false; reason: string };

export class ToolPreconditionDenied extends Error {
  constructor(tool: string, reason: string) {
    super(`Tool precondition denied for ${tool}: ${reason}`);
    this.name = "ToolPreconditionDenied";
  }
}

export class ToolPreconditionFailed extends Error {
  constructor(tool: string, cause: unknown) {
    super(`Tool precondition failed for ${tool}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ToolPreconditionFailed";
    this.cause = cause;
  }
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

  replaceFrom(other: ToolRegistry): void {
    this.tools.clear();
    for (const [name, tool] of other.tools) this.tools.set(name, tool);
  }

  async call(name: string, args: unknown): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    if (args === null || typeof args !== "object" || Array.isArray(args)) {
      throw new Error("Tool arguments must be an object");
    }
    const parsed = args as Record<string, unknown>;
    if (tool.beforeExecute) {
      let decision: PreconditionDecision;
      try {
        decision = await tool.beforeExecute(parsed);
      } catch (error) {
        throw new ToolPreconditionFailed(name, error);
      }
      if (decision?.allowed === false && typeof decision.reason === "string" && decision.reason) {
        throw new ToolPreconditionDenied(name, decision.reason);
      }
      if (decision?.allowed !== true) throw new ToolPreconditionFailed(name, new Error("Invalid precondition decision"));
    }
    return tool.execute(parsed);
  }
}
