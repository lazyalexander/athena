import type { ModelStep, TextModel, ToolResult } from "./core.ts";
import { OllamaClient } from "./ollama.ts";
import { OpenAIClient } from "./openai.ts";
import type { ToolSet } from "./tools.ts";
import type { Workspace } from "./workspace.ts";

export type ModelProvider = "ollama" | "openai";

export type ModelSettings = {
  provider?: ModelProvider;
  ollamaModel?: string;
  ollamaHost?: string;
  openaiModel?: string;
  apiKey?: string;
  apiBaseUrl?: string;
};

type OllamaTags = { models?: Array<{ name?: string }> };

export class ModelManager implements TextModel {
  private active: TextModel;
  private provider: ModelProvider;
  private name: string;
  private readonly ollamaHost: string;
  private readonly apiKey?: string;
  private readonly apiBaseUrl?: string;
  private readonly workspace?: Workspace;
  private readonly defaultOllamaModel: string;
  private readonly defaultOpenAIModel: string;

  constructor(settings: ModelSettings = {}, workspace?: Workspace) {
    this.workspace = workspace;
    this.ollamaHost = settings.ollamaHost ?? "http://127.0.0.1:11434";
    this.apiKey = settings.apiKey;
    this.apiBaseUrl = settings.apiBaseUrl;
    this.defaultOllamaModel = settings.ollamaModel ?? "qwen3:1.7b";
    this.defaultOpenAIModel = settings.openaiModel ?? "gpt-6-astra";
    this.provider = settings.provider ?? "ollama";
    this.name = this.provider === "ollama" ? this.defaultOllamaModel : this.defaultOpenAIModel;
    this.active = this.create(this.provider, this.name);
  }

  get current(): string {
    return `${this.provider}: ${this.name}`;
  }

  async generate(input: string | ToolResult[], tools: ToolSet): Promise<ModelStep> {
    return this.active.generate(input, tools);
  }

  async localModels(): Promise<string[]> {
    const response = await fetch(`${this.ollamaHost.replace(/\/$/, "")}/api/tags`);
    if (!response.ok) throw new Error(`Ollama model list failed: HTTP ${response.status}`);
    const body = (await response.json()) as OllamaTags;
    return (body.models ?? []).flatMap((model) => model.name ? [model.name] : []).sort();
  }

  async select(provider: ModelProvider, name?: string): Promise<string> {
    const chosen = name || (provider === "ollama" ? this.defaultOllamaModel : this.defaultOpenAIModel);
    if (provider === "ollama") {
      const installed = await this.localModels();
      if (!installed.includes(chosen)) throw new Error(`Local model is not installed: ${chosen}`);
    }
    const next = this.create(provider, chosen);
    this.active = next;
    this.provider = provider;
    this.name = chosen;
    return this.current;
  }

  private create(provider: ModelProvider, name: string): TextModel {
    if (provider === "ollama") return new OllamaClient(name, this.workspace, this.ollamaHost);
    if (!this.apiKey) throw new Error("Set OPENAI_API_KEY before selecting an OpenAI model");
    return new OpenAIClient(this.apiKey, name, this.workspace, this.apiBaseUrl);
  }
}
