import type { ModelStep, TextModel, ToolResult } from "./core.ts";
import type { ProviderRegistry } from "./providers.ts";
import type { ToolSet } from "./tools.ts";
import type { Workspace } from "./workspace.ts";

export type ModelSettings = {
  provider?: string;
  model?: string;
};

export class ModelManager implements TextModel {
  private active: TextModel;
  private providerId: string;
  private name: string;
  private readonly registry: ProviderRegistry;
  private readonly workspace?: Workspace;

  constructor(registry: ProviderRegistry, settings: ModelSettings = {}, workspace?: Workspace) {
    this.registry = registry;
    this.workspace = workspace;
    const provider = registry.get(settings.provider ?? registry.ids()[0]);
    this.providerId = provider.id;
    this.name = settings.model ?? provider.defaultModel;
    this.active = provider.createClient(this.name, workspace);
  }

  get current(): string {
    return `${this.providerId}: ${this.name}`;
  }

  providerIds(): string[] {
    return this.registry.ids();
  }

  async generate(input: string | ToolResult[], tools: ToolSet): Promise<ModelStep> {
    return this.active.generate(input, tools);
  }

  async listModels(): Promise<string[]> {
    const provider = this.registry.get(this.providerId);
    return provider.listModels?.() ?? [];
  }

  async select(providerId: string, name?: string): Promise<string> {
    const provider = this.registry.get(providerId);
    const chosen = name || provider.defaultModel;
    await provider.validateModel?.(chosen);
    const next = provider.createClient(chosen, this.workspace);
    this.active = next;
    this.providerId = provider.id;
    this.name = chosen;
    return this.current;
  }
}
