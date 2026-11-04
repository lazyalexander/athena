import type { TextModel } from "../agent/core.ts";
import type { JournalEvent } from "../session/journal.ts";
import type { Workspace } from "../workspace/workspace.ts";

export interface Provider {
  readonly id: string;
  readonly defaultModel: string;
  createClient(model: string, workspace?: Workspace): TextModel;
  listModels?(): Promise<string[]>;
  validateModel?(name: string): Promise<void>;
  restore?(model: string, events: JournalEvent[], notice: string, workspace?: Workspace): TextModel;
}

export class ProviderRegistry {
  private readonly providers = new Map<string, Provider>();

  register(provider: Provider): void {
    if (this.providers.has(provider.id)) throw new Error(`Duplicate provider: ${provider.id}`);
    this.providers.set(provider.id, provider);
  }

  get(id: string): Provider {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`Unknown provider: ${id}. Available: ${this.ids().join(", ")}`);
    return provider;
  }

  ids(): string[] {
    return [...this.providers.keys()];
  }
}
