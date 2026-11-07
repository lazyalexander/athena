import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderRegistry, type Provider } from "../src/providers/providers.ts";
import { createOllamaProvider } from "../src/providers/ollama.ts";

function fakeProvider(id: string): Provider {
  return {
    id,
    defaultModel: `${id}-default`,
    createClient: () => ({ generate: async () => ({ text: "", calls: [] }) }),
  };
}

test("registry returns providers in registration order and rejects unknown ids", () => {
  const registry = new ProviderRegistry();
  const a = fakeProvider("a");
  registry.register(a);
  registry.register(fakeProvider("b"));
  assert.deepEqual(registry.ids(), ["a", "b"]);
  assert.equal(registry.get("a"), a);
  assert.throws(() => registry.get("zzz"), /^Error: Unknown provider: zzz\. Available: a, b$/);
});

test("ollama provider lists and validates installed local models", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ models: [{ name: "qwen3:1.7b" }] }), { status: 200 });
    const provider = createOllamaProvider();
    assert.equal(provider.id, "ollama");
    assert.equal(provider.defaultModel, "qwen3:1.7b");
    assert.deepEqual(await provider.listModels!(), ["qwen3:1.7b"]);
    await assert.rejects(provider.validateModel!("missing"), /not installed/);
    await provider.validateModel!("qwen3:1.7b");
  } finally {
    globalThis.fetch = original;
  }
});

test("openai provider requires an API key and does not list models", async () => {
  const { createOpenAIProvider } = await import("../src/providers/openai.ts");
  const { OpenAIClient } = await import("../src/providers/openai.ts");
  const provider = createOpenAIProvider();
  assert.equal(provider.id, "openai");
  assert.equal(provider.defaultModel, "gpt-6-astra");
  assert.throws(() => provider.createClient("gpt-6-astra"), /OPENAI_API_KEY/);
  const withKey = createOpenAIProvider({ apiKey: "test-key" });
  assert.ok(withKey.createClient("gpt-6-astra") instanceof OpenAIClient);
  assert.equal(provider.listModels, undefined);
  assert.equal(provider.validateModel, undefined);
});

test("responses client retries an empty body and does not retry a 400", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) return new Response("null", { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({
        id: "r1",
        output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }],
      }), { status: 200 });
    };
    const { createOpenAIProvider } = await import("../src/providers/openai.ts");
    const client = createOpenAIProvider({ apiKey: "test-key" }).createClient("gpt-6-astra");
    assert.equal((await client.generate("hi", { definitions: [], call: async () => "" })).text, "ok");
    assert.equal(calls, 2);
    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 });
    };
    await assert.rejects(client.generate("hi", { definitions: [], call: async () => "" }), /bad request/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("deepseek provider uses its own key env var and base URL", async () => {
  const { createResponsesProvider } = await import("../src/providers/openai.ts");
  const provider = createResponsesProvider({
    id: "deepseek",
    keyEnv: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-chat",
    baseUrl: "https://api.deepseek.com",
  });
  assert.equal(provider.id, "deepseek");
  assert.equal(provider.defaultModel, "deepseek-chat");
  assert.throws(() => provider.createClient("deepseek-chat"), /DEEPSEEK_API_KEY/);
  const withKey = createResponsesProvider({
    id: "deepseek",
    keyEnv: "DEEPSEEK_API_KEY",
    apiKey: "test-key",
    defaultModel: "deepseek-chat",
    baseUrl: "https://api.deepseek.com",
  });
  assert.ok(withKey.createClient("deepseek-chat"));
});
