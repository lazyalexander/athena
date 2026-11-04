import type { ModelStep, ToolResult } from "./core.ts";
import { currentConversation, type JournalEvent } from "./journal.ts";
import type { Provider } from "./providers.ts";
import type { ToolSet } from "./tools.ts";
import type { Workspace } from "./workspace.ts";

type OllamaTags = { models?: Array<{ name?: string }> };

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_name?: string;
  tool_calls?: Array<{ type: "function"; function: { name: string; arguments: Record<string, unknown> } }>;
};

/** Rebuilds ollama chat history from journal events, dropping an incomplete trailing step. */
export function ollamaHistoryFromEvents(events: JournalEvent[]): { messages: ChatMessage[]; pending: Map<string, string> } {
  events = currentConversation(events);
  const answered = new Set<string>();
  for (const event of events) {
    if (event.type === "tool_result") answered.add(event.callId);
  }
  const droppedCalls = new Set<string>();
  for (const event of events) {
    if (event.type === "assistant_step" && event.calls.some((call) => !answered.has(call.callId))) {
      for (const call of event.calls) droppedCalls.add(call.callId);
    }
  }
  const messages: ChatMessage[] = [];
  for (const event of events) {
    if (event.type === "user") {
      messages.push({ role: "user", content: event.text });
    } else if (event.type === "assistant_step") {
      if (event.calls.some((call) => droppedCalls.has(call.callId))) continue;
      messages.push({
        role: "assistant",
        content: event.text,
        ...(event.calls.length ? { tool_calls: event.calls.map((call) => ({
          type: "function" as const,
          function: { name: call.name, arguments: JSON.parse(call.arguments) as Record<string, unknown> },
        })) } : {}),
      });
    } else if (event.type === "tool_result") {
      if (droppedCalls.has(event.callId)) continue;
      messages.push({ role: "tool", tool_name: nameOf(events, event.callId), content: event.output });
    }
  }
  return { messages, pending: new Map() };
}

function nameOf(events: JournalEvent[], callId: string): string {
  for (const event of events) {
    if (event.type === "assistant_step") {
      const call = event.calls.find((c) => c.callId === callId);
      if (call) return call.name;
    }
  }
  return "unknown";
}

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
  private readonly notice?: string;

  constructor(model: string, workspace?: Workspace, baseUrl = "http://127.0.0.1:11434",
    init?: { messages?: ChatMessage[]; pending?: Map<string, string>; notice?: string }) {
    this.model = model;
    this.workspace = workspace;
    this.baseUrl = baseUrl;
    this.notice = init?.notice;
    if (init?.messages) this.messages.push(...init.messages);
    if (init?.pending) for (const [id, name] of init.pending) this.pending.set(id, name);
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
        ...(this.notice ? [this.notice] : []),
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

export function createOllamaProvider(config: { host?: string; model?: string } = {}): Provider {
  const host = config.host ?? "http://127.0.0.1:11434";
  const listModels = async (): Promise<string[]> => {
    const response = await fetch(`${host.replace(/\/$/, "")}/api/tags`);
    if (!response.ok) throw new Error(`Ollama model list failed: HTTP ${response.status}`);
    const body = (await response.json()) as OllamaTags;
    return (body.models ?? []).flatMap((model) => model.name ? [model.name] : []).sort();
  };
  return {
    id: "ollama",
    defaultModel: config.model ?? "qwen3:1.7b",
    createClient: (model, workspace) => new OllamaClient(model, workspace, host),
    listModels,
    validateModel: async (name) => {
      const installed = await listModels();
      if (!installed.includes(name)) throw new Error(`Local model is not installed: ${name}`);
    },
    restore: (model, events, notice, workspace) => {
      const { messages, pending } = ollamaHistoryFromEvents(events);
      return new OllamaClient(model, workspace, host, { messages, pending, notice });
    },
  };
}
