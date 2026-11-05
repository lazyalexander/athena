import type { ModelStep, ToolResult } from "../agent/core.ts";
import { currentConversation, lastSafeResponseId, type JournalEvent } from "../session/journal.ts";
import type { Provider } from "./providers.ts";
import type { ToolSet } from "../agent/tools.ts";
import type { Workspace } from "../workspace/workspace.ts";

type ResponseBody = {
  id?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
    name?: string;
    call_id?: string;
    arguments?: string;
  }>;
  error?: { message?: string };
};

export class OpenAIClient {
  private previousResponseId?: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly workspace?: Workspace;
  private readonly baseUrl: string;
  private readonly notice?: string;
  private readonly stateless: boolean;
  private readonly history: Array<Record<string, unknown>>;

  constructor(apiKey: string, model: string, workspace?: Workspace, baseUrl = "https://api.openai.com/v1", notice?: string,
    stateless = false, history: Array<Record<string, unknown>> = []) {
    this.apiKey = apiKey;
    this.model = model;
    this.workspace = workspace;
    this.notice = notice;
    this.stateless = stateless;
    this.history = [...history];
    const url = new URL(baseUrl);
    if (url.protocol !== "https:") throw new Error("API base URL must use HTTPS");
    this.baseUrl = url.href.replace(/\/$/, "");
  }

  resume(responseId: string): void {
    this.previousResponseId = responseId;
  }

  async generate(input: string | ToolResult[], tools: ToolSet): Promise<ModelStep> {
    const inputItems: Array<Record<string, unknown>> = typeof input === "string"
      ? [{ role: "user", content: input }]
      : input.map((result) => ({ type: "function_call_output", call_id: result.callId, output: result.output }));
    const requestInput = this.stateless ? [...this.history, ...inputItems] : typeof input === "string" ? input : inputItems;
    const response = await fetch(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        instructions: [
          "Use tools when the user's request requires an external action or information. If application knowledge is available, look up relevant rules before deciding. Obtain changing facts from tools, not memory. Before a state-changing call, check the applicable rule against those facts; use elapsed_time for timestamp limits when available. Do not claim an action succeeded unless its tool result confirms it.",
          ...(this.workspace ? [`Current workspace: ${this.workspace.root}. This path is context only; use available tools for any file operation.`] : []),
          ...(this.notice ? [this.notice] : []),
        ].join("\n"),
        input: requestInput,
        ...(!this.stateless && this.previousResponseId ? { previous_response_id: this.previousResponseId } : {}),
        ...(tools.definitions.length ? {
          tools: tools.definitions.map((tool) => ({ type: "function", ...tool })),
        } : {}),
      }),
    });
    const body = (await response.json()) as ResponseBody;
    if (!response.ok) throw new Error(body.error?.message ?? `HTTP ${response.status}`);
    if (!body.id) throw new Error("OpenAI response has no id");
    const calls = (body.output ?? []).filter((item) => item.type === "function_call").map((item) => {
      if (!item.name || !item.call_id || item.arguments === undefined) {
        throw new Error("Malformed function call");
      }
      return { name: item.name, callId: item.call_id, arguments: item.arguments };
    });
    const text = (body.output ?? []).flatMap((item) => item.type === "message"
      ? (item.content ?? []).filter((part) => part.type === "output_text").map((part) => part.text ?? "")
      : []).join("");
    if (this.stateless) this.history.push(...inputItems, ...(body.output ?? []) as Record<string, unknown>[]);
    this.previousResponseId = body.id;
    return { text, calls, responseId: body.id };
  }
}

export function createResponsesProvider(config: {
  id: string;
  keyEnv: string;
  defaultModel: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  stateless?: boolean;
}): Provider {
  return {
    id: config.id,
    defaultModel: config.model ?? config.defaultModel,
    createClient: (model, workspace) => {
      if (!config.apiKey) throw new Error(`Set ${config.keyEnv} before selecting the ${config.id} provider`);
      return new OpenAIClient(config.apiKey, model, workspace, config.baseUrl, undefined, config.stateless);
    },
    restore: (model, events, notice, workspace) => {
      if (!config.apiKey) throw new Error(`Set ${config.keyEnv} before selecting the ${config.id} provider`);
      const responseId = config.stateless ? undefined : lastSafeResponseId(currentConversation(events));
      if (!config.stateless && !responseId) throw new Error("Journal has no response id to resume");
      const client = new OpenAIClient(config.apiKey, model, workspace, config.baseUrl, notice,
        config.stateless, config.stateless ? historyFromEvents(events) : []);
      if (responseId) client.resume(responseId);
      return client;
    },
  };
}

function historyFromEvents(events: JournalEvent[]): Array<Record<string, unknown>> {
  const history: Array<Record<string, unknown>> = [];
  events = currentConversation(events);
  const answered = new Set(events.filter((event) => event.type === "tool_result").map((event) => event.callId));
  const dropped = new Set(events.flatMap((event) => event.type === "assistant_step" && event.calls.some((call) => !answered.has(call.callId))
    ? event.calls.map((call) => call.callId) : []));
  for (const event of events) {
    if (event.type === "user") history.push({ role: "user", content: event.text });
    if (event.type === "assistant_step") {
      if (event.calls.some((call) => dropped.has(call.callId))) continue;
      if (event.text) history.push({ role: "assistant", content: event.text });
      for (const call of event.calls) history.push({ type: "function_call", call_id: call.callId, name: call.name, arguments: call.arguments });
    }
    if (event.type === "tool_result" && !dropped.has(event.callId)) history.push({ type: "function_call_output", call_id: event.callId, output: event.output });
  }
  return history;
}

export function createOpenAIProvider(config: { apiKey?: string; model?: string; baseUrl?: string } = {}): Provider {
  return createResponsesProvider({ id: "openai", keyEnv: "OPENAI_API_KEY", defaultModel: "gpt-6-astra", ...config });
}
