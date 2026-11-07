import type { ModelStep, ToolResult } from "../agent/core.ts";
import { currentConversation, type JournalEvent } from "../session/journal.ts";
import type { Provider } from "./providers.ts";
import type { ToolSet } from "../agent/tools.ts";
import type { Workspace } from "../workspace/workspace.ts";

type ChatToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type ChatBody = {
  choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }> } }>;
  error?: { message?: string };
};

/** Rebuilds a chat-completions transcript, dropping an incomplete trailing tool step. */
export function chatHistoryFromEvents(events: JournalEvent[]): ChatMessage[] {
  events = currentConversation(events);
  const answered = new Set(events.filter((event) => event.type === "tool_result").map((event) => event.callId));
  const dropped = new Set(events.flatMap((event) => event.type === "assistant_step" && event.calls.some((call) => !answered.has(call.callId))
    ? event.calls.map((call) => call.callId) : []));
  const messages: ChatMessage[] = [];
  for (const event of events) {
    if (event.type === "user") messages.push({ role: "user", content: event.text });
    if (event.type === "assistant_step") {
      if (event.calls.some((call) => dropped.has(call.callId))) continue;
      messages.push({
        role: "assistant",
        content: event.text,
        ...(event.calls.length ? { tool_calls: event.calls.map((call) => ({
          id: call.callId,
          type: "function" as const,
          function: { name: call.name, arguments: call.arguments },
        })) } : {}),
      });
    }
    if (event.type === "tool_result" && !dropped.has(event.callId)) {
      messages.push({ role: "tool", tool_call_id: event.callId, content: event.output });
    }
  }
  return messages;
}

export class ChatClient {
  private readonly messages: ChatMessage[] = [];
  private readonly pending = new Set<string>();
  private readonly apiKey: string;
  private readonly model: string;
  private readonly workspace?: Workspace;
  private readonly baseUrl: string;
  private readonly notice?: string;

  constructor(apiKey: string, model: string, workspace?: Workspace, baseUrl?: string, notice?: string, history: ChatMessage[] = []) {
    this.apiKey = apiKey;
    this.model = model;
    this.workspace = workspace;
    this.notice = notice;
    this.messages.push(...history);
    const url = new URL(baseUrl ?? "https://api.openai.com/v1");
    if (url.protocol !== "https:") throw new Error("API base URL must use HTTPS");
    this.baseUrl = url.href.replace(/\/$/, "");
  }

  async generate(input: string | ToolResult[], tools: ToolSet): Promise<ModelStep> {
    if (typeof input === "string") {
      if (this.pending.size) throw new Error("Pending tool results were not delivered");
      this.messages.push({ role: "user", content: input });
    } else {
      for (const result of input) {
        if (!this.pending.has(result.callId)) throw new Error(`Unknown chat tool call ID: ${result.callId}`);
        this.messages.push({ role: "tool", tool_call_id: result.callId, content: result.output });
        this.pending.delete(result.callId);
      }
      if (this.pending.size) throw new Error("Missing chat tool results");
    }
    const system: ChatMessage = {
      role: "system",
      content: [
        "Use tools when the user's request requires an external action or information. If application knowledge is available, look up relevant rules before deciding. Obtain changing facts from tools, not memory. Before a state-changing call, check the applicable rule against those facts; use elapsed_time for timestamp limits when available. Do not claim an action succeeded unless its tool result confirms it.",
        ...(this.workspace ? [`Current workspace: ${this.workspace.root}. This path is context only; use available tools for any file operation.`] : []),
        ...(this.notice ? [this.notice] : []),
      ].join("\n"),
    };
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [system, ...this.messages],
        ...(tools.definitions.length ? {
          tools: tools.definitions.map((tool) => ({
            type: "function",
            function: { name: tool.name, description: tool.description, parameters: tool.parameters },
          })),
        } : {}),
      }),
    });
    const body = (await response.json()) as ChatBody;
    if (!response.ok) throw new Error(body.error?.message ?? `HTTP ${response.status}`);
    const message = body.choices?.[0]?.message;
    if (!message) throw new Error("Chat response has no message");
    const calls = (message.tool_calls ?? []).map((call) => {
      const name = call.function?.name;
      const callId = call.id;
      if (!name || !callId) throw new Error("Malformed chat tool call");
      const args = call.function?.arguments;
      const argumentsText = typeof args === "string" ? args
        : args && typeof args === "object" && !Array.isArray(args) ? JSON.stringify(args)
        : undefined;
      if (argumentsText === undefined) throw new Error("Malformed chat tool call");
      return { name, callId, arguments: argumentsText };
    });
    if (new Set(calls.map((call) => call.callId)).size !== calls.length) throw new Error("Malformed chat tool call");
    for (const call of calls) this.pending.add(call.callId);
    this.messages.push({
      role: "assistant",
      content: message.content ?? "",
      ...(calls.length ? { tool_calls: calls.map((call) => ({
        id: call.callId, type: "function" as const, function: { name: call.name, arguments: call.arguments },
      })) } : {}),
    });
    return { text: message.content ?? "", calls };
  }
}

export function createChatProvider(config: {
  id: string;
  keyEnv: string;
  defaultModel: string;
  apiKey?: string;
  model?: string;
  baseUrl: string;
}): Provider {
  const requireKey = (): string => {
    if (!config.apiKey) throw new Error(`Set ${config.keyEnv} before selecting the ${config.id} provider`);
    return config.apiKey;
  };
  return {
    id: config.id,
    defaultModel: config.model ?? config.defaultModel,
    createClient: (model, workspace, options) => new ChatClient(requireKey(), model, workspace, config.baseUrl, options?.notice),
    restore: (model, events, notice, workspace) => new ChatClient(
      requireKey(), model, workspace, config.baseUrl, notice, chatHistoryFromEvents(events),
    ),
  };
}
