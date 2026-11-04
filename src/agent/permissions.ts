import type { ToolDefinition, ToolSet } from "./tools.ts";

export type PermissionRequest = {
  tool: string;
  arguments: string;
};

export type ApprovalPrompt = (request: PermissionRequest) => Promise<boolean>;

/** One instance represents one user turn. Grants and denials never outlive it. */
export class TurnToolSet implements ToolSet {
  private readonly decisions = new Map<string, boolean>();
  private readonly tools: ToolSet;
  private readonly approve: ApprovalPrompt;

  constructor(tools: ToolSet, approve: ApprovalPrompt) {
    this.tools = tools;
    this.approve = approve;
  }

  get definitions(): readonly ToolDefinition[] {
    return this.tools.definitions;
  }

  async call(name: string, args: unknown): Promise<string> {
    if (!this.tools.definitions.some((tool) => tool.name === name)) throw new Error(`Unknown tool: ${name}`);
    if (args === null || typeof args !== "object" || Array.isArray(args)) {
      throw new Error("Tool arguments must be an object");
    }
    const serialized = JSON.stringify(args);
    const key = JSON.stringify([name, serialized]);
    let allowed = this.decisions.get(key);
    if (allowed === undefined) {
      allowed = await this.approve({ tool: name, arguments: serialized });
      this.decisions.set(key, allowed);
    }
    if (!allowed) throw new Error(`Permission denied for ${name}`);
    return this.tools.call(name, args);
  }

  close(): void {
    this.decisions.clear();
  }
}
