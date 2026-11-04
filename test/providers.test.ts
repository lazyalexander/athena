import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderRegistry, type Provider } from "../src/providers.ts";
import { createOllamaProvider } from "../src/ollama.ts";

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
