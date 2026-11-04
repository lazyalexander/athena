import type { ModelStep, ToolResult } from "./core.ts";
import type { Provider } from "./providers.ts";
import type { ToolSet } from "./tools.ts";
import type { Workspace } from "./workspace.ts";

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

  constructor(apiKey: string, model: string, workspace?: Workspace, baseUrl = "https://api.openai.com/v1") {
    this.apiKey = apiKey;
    this.model = model;
    this.workspace = workspace;
    const url = new URL(baseUrl);
    if (url.protocol !== "https:") throw new Error("API base URL must use HTTPS");
    this.baseUrl = url.href.replace(/\/$/, "");
  }

  async generate(input: string | ToolResult[], tools: ToolSet): Promise<ModelStep> {
    const response = await fetch(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        instructions: [
          "Use tools when the user's request requires an external action or information. After each tool result, decide whether another tool call is needed, then provide a final answer. Do not claim an action succeeded unless its tool result confirms it.",
          ...(this.workspace ? [`Current workspace: ${this.workspace.root}. This path is context only; use available tools for any file operation.`] : []),
        ].join("\n"),
        input: typeof input === "string" ? input : input.map((result) => ({
          type: "function_call_output",
          call_id: result.callId,
          output: result.output,
        })),
        ...(this.previousResponseId ? { previous_response_id: this.previousResponseId } : {}),
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
    this.previousResponseId = body.id;
    return { text, calls };
  }
}

export function createOpenAIProvider(config: { apiKey?: string; model?: string; baseUrl?: string } = {}): Provider {
  return {
    id: "openai",
    defaultModel: config.model ?? "gpt-6-astra",
    createClient: (model, workspace) => {
      if (!config.apiKey) throw new Error("Set OPENAI_API_KEY before selecting an OpenAI model");
      return new OpenAIClient(config.apiKey, model, workspace, config.baseUrl);
    },
  };
}
