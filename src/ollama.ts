import type { ModelStep, ToolResult } from "./core.ts";
import type { ToolSet } from "./tools.ts";
import type { Workspace } from "./workspace.ts";

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_name?: string;
  tool_calls?: Array<{ type: "function"; function: { name: string; arguments: Record<string, unknown> } }>;
};

type ChatResponse = {
  message?: {
    content?: string;
    tool_calls?: Array<{ function?: { name?: string; arguments?: Record<string, unknown> } }>;
  };
  error?: string;
};

export class OllamaClient {
  private readonly messages: ChatMessage[] = [];
  private readonly pending = new Map<string, string>();
  private requestNumber = 0;
  private readonly model: string;
  private readonly workspace?: Workspace;
  private readonly baseUrl: string;

  constructor(model: string, workspace?: Workspace, baseUrl = "http://127.0.0.1:11434") {
    this.model = model;
    this.workspace = workspace;
    this.baseUrl = baseUrl;
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      throw new Error("Ollama URL must point to local HTTP service");
    }
  }

  async generate(input: string | ToolResult[], tools: ToolSet): Promise<ModelStep> {
    if (typeof input === "string") {
      if (this.pending.size) throw new Error("Pending tool results were not delivered");
      this.messages.push({ role: "user", content: input });
    } else {
      for (const result of input) {
        const name = this.pending.get(result.callId);
        if (!name) throw new Error(`Unknown Ollama tool call ID: ${result.callId}`);
        this.messages.push({ role: "tool", tool_name: name, content: result.output });
        this.pending.delete(result.callId);
      }
      if (this.pending.size) throw new Error("Missing Ollama tool results");
    }

    const system: ChatMessage = {
      role: "system",
      content: [
        "You are Athena. Use tools when needed. After a tool result, decide whether another tool is needed, then answer. Only claim an action succeeded when the tool result confirms it.",
        ...(this.workspace ? [`Current workspace: ${this.workspace.root}. Use file tools for file operations.`] : []),
      ].join("\n"),
    };
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        think: false,
        messages: [system, ...this.messages],
        tools: tools.definitions.map((tool) => ({
          type: "function",
          function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        })),
      }),
    });
    const body = (await response.json()) as ChatResponse;
    if (!response.ok) throw new Error(body.error ?? `Ollama HTTP ${response.status}`);
    if (!body.message) throw new Error("Ollama response has no message");
    const calls = (body.message.tool_calls ?? []).map((call, index) => {
      const name = call.function?.name;
      const args = call.function?.arguments;
      if (!name || !args || typeof args !== "object" || Array.isArray(args)) throw new Error("Malformed Ollama tool call");
      const callId = `ollama-${this.requestNumber}-${index}`;
      this.pending.set(callId, name);
      return { name, callId, arguments: JSON.stringify(args) };
    });
    this.requestNumber++;
    this.messages.push({
      role: "assistant",
      content: body.message.content ?? "",
      ...(calls.length ? { tool_calls: calls.map((call) => ({
        type: "function" as const,
        function: { name: call.name, arguments: JSON.parse(call.arguments) as Record<string, unknown> },
      })) } : {}),
    });
    return { text: body.message.content ?? "", calls };
  }
}
