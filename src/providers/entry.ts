import { readFileSync } from "node:fs";
import { createChatProvider } from "./chat.ts";
import { createOllamaProvider } from "./ollama.ts";
import { createOpenAIProvider, createResponsesProvider } from "./openai.ts";
import { ProviderRegistry, type Provider } from "./providers.ts";

/** Environment values used to connect models. This layer never writes them anywhere. */
export type ProviderEnv = Record<string, string | undefined>;

export type LlmProtocol = "ollama" | "responses" | "chat";

/** One LLM connection. `apiKey` is filled from the environment in memory and must not be serialized. */
export type LlmConnection = {
  id: string;
  protocol: LlmProtocol;
  defaultModel: string;
  model?: string;
  baseUrl?: string;
  host?: string;
  apiKey?: string;
  keyEnv?: string;
  stateless?: boolean;
};

export type ProviderLayer = {
  registry: ProviderRegistry;
  /** Ollama, because it is the only built-in connection that works without credentials. */
  defaultId: string;
};

export const DEFAULT_PROVIDER_ID = "ollama";

const FILE_LIMIT = 65_536;
const ALLOWED_FIELDS = new Set(["id", "protocol", "defaultModel", "model", "baseUrl", "host", "keyEnv", "stateless"]);
const SECRET_FIELDS = /^(api[-_]?key|token|secret|password|authorization|key)$/i;
const SECRET_VALUE = /^(sk-|sk_|rk-|xai-|AIza|ghp_|github_pat_)/;

/** Turns one connection record into a registry entry. */
export function connectProvider(connection: LlmConnection): Provider {
  const model = connection.model ?? connection.defaultModel;
  switch (connection.protocol) {
    case "ollama":
      return createOllamaProvider({ host: connection.host, model });
    case "responses":
      return createResponsesProvider({
        id: connection.id,
        keyEnv: connection.keyEnv ?? "API_KEY",
        apiKey: connection.apiKey,
        model: connection.model,
        defaultModel: connection.defaultModel,
        baseUrl: connection.baseUrl,
        stateless: connection.stateless,
      });
    case "chat":
      if (!connection.baseUrl) throw new Error(`Provider ${connection.id} requires an HTTPS baseUrl`);
      return createChatProvider({
        id: connection.id,
        keyEnv: connection.keyEnv ?? "API_KEY",
        apiKey: connection.apiKey,
        model: connection.model,
        defaultModel: connection.defaultModel,
        baseUrl: connection.baseUrl,
      });
    default:
      throw new Error(`Unknown provider protocol: ${connection.protocol}`);
  }
}

/** Parses a provider file. Rejects embedded secrets without repeating their values. */
export function parseProviderFile(text: string): LlmConnection[] {
  if (text.length > FILE_LIMIT) throw new Error("Provider file is too large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Provider file is not valid JSON");
  }
  assertNoSecrets(parsed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Provider file must be an object");
  const root = parsed as Record<string, unknown>;
  if (Object.keys(root).join() !== "providers" || !Array.isArray(root.providers)) {
    throw new Error("Provider file must contain only a providers array");
  }
  return root.providers.map(parseConnection);
}

/**
 * The only LLM entry used by the TUI and the benchmark bridge.
 * Pass an explicit env in tests so a developer shell cannot leak into them.
 */
export function createProviderLayer(env: ProviderEnv = process.env, extraPath = env.ATHENA_PROVIDERS): ProviderLayer {
  const registry = new ProviderRegistry();
  for (const connection of builtinConnections(env)) registry.register(connectProvider(connection));
  if (extraPath) {
    let text: string;
    try {
      text = readFileSync(extraPath, "utf8");
    } catch {
      throw new Error(`Cannot read provider file: ${extraPath}`);
    }
    for (const connection of parseProviderFile(text)) registry.register(connectProvider(withKey(connection, env)));
  }
  return { registry, defaultId: DEFAULT_PROVIDER_ID };
}

function builtinConnections(env: ProviderEnv): LlmConnection[] {
  return [
    { id: "ollama", protocol: "ollama", defaultModel: env.OLLAMA_MODEL || "qwen3:1.7b", host: env.OLLAMA_HOST },
    {
      id: "openai",
      protocol: "responses",
      defaultModel: env.OPENAI_MODEL || "gpt-6-astra",
      baseUrl: env.ATHENA_API_BASE_URL,
      keyEnv: "OPENAI_API_KEY",
      apiKey: env.OPENAI_API_KEY,
    },
    {
      id: "deepseek",
      protocol: "responses",
      defaultModel: env.DEEPSEEK_MODEL || "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      keyEnv: "DEEPSEEK_API_KEY",
      apiKey: env.DEEPSEEK_API_KEY,
      stateless: true,
    },
  ];
}

function withKey(connection: LlmConnection, env: ProviderEnv): LlmConnection {
  if (!connection.keyEnv) return connection;
  return { ...connection, apiKey: env[connection.keyEnv] };
}

function assertNoSecrets(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoSecrets(item);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_FIELDS.test(key)) {
        throw new Error(`Provider file field "${key}" is not allowed. Name the environment variable in keyEnv instead.`);
      }
      assertNoSecrets(child);
    }
    return;
  }
  if (typeof value === "string" && SECRET_VALUE.test(value)) {
    throw new Error("Provider file contains a secret value. Keep keys in the environment and reference them with keyEnv.");
  }
}

function parseConnection(value: unknown): LlmConnection {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Each provider entry must be an object");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_FIELDS.has(key)) throw new Error(`Unknown provider field: ${key}`);
  }
  const id = stringField(record, "id");
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(id)) throw new Error(`Invalid provider id: ${id}`);
  const protocol = stringField(record, "protocol");
  if (protocol !== "ollama" && protocol !== "responses" && protocol !== "chat") {
    throw new Error(`Unknown provider protocol: ${protocol}`);
  }
  const defaultModel = stringField(record, "defaultModel");
  const model = optionalString(record, "model");
  const baseUrl = optionalString(record, "baseUrl");
  const host = optionalString(record, "host");
  const keyEnv = optionalString(record, "keyEnv");
  if (keyEnv !== undefined && !/^[A-Z][A-Z0-9_]*$/.test(keyEnv)) throw new Error(`Invalid keyEnv for provider ${id}`);
  const stateless = record.stateless;
  if (stateless !== undefined && typeof stateless !== "boolean") throw new Error(`Provider ${id} stateless must be a boolean`);
  if (protocol === "ollama") {
    if (baseUrl) throw new Error(`Provider ${id} uses host, not baseUrl`);
    if (keyEnv || stateless !== undefined) throw new Error(`Provider ${id} does not use keyEnv or stateless`);
    if (host) assertLocalOllamaUrl(host);
  } else {
    if (!baseUrl) throw new Error(`Provider ${id} requires an HTTPS baseUrl`);
    assertHttps(baseUrl, id);
    if (!keyEnv) throw new Error(`Provider ${id} requires keyEnv`);
    if (host) throw new Error(`Provider ${id} uses baseUrl, not host`);
    if (protocol === "chat" && stateless === false) throw new Error(`Provider ${id} uses chat completions and is stateless`);
  }
  return { id, protocol, defaultModel, model, baseUrl, host, keyEnv, stateless };
}

function stringField(record: Record<string, unknown>, name: string): string {
  const value = record[name];
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) throw new Error(`Provider ${name} must be a non-empty string`);
  return value;
}

function optionalString(record: Record<string, unknown>, name: string): string | undefined {
  if (record[name] === undefined) return undefined;
  return stringField(record, name);
}

function assertHttps(baseUrl: string, id: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`Provider ${id} baseUrl is not a URL`);
  }
  if (url.protocol !== "https:") throw new Error(`Provider ${id} baseUrl must use HTTPS`);
}

function assertLocalOllamaUrl(host: string): void {
  let url: URL;
  try {
    url = new URL(host);
  } catch {
    throw new Error("Ollama URL must point to local HTTP service");
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Ollama URL must point to local HTTP service");
  }
}
