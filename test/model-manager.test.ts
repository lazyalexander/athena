import assert from "node:assert/strict";
import { test } from "node:test";
import { ModelManager } from "../src/model-manager.ts";

test("model manager lists local models and switches providers without changing state on failure", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ models: [{ name: "qwen3:1.7b" }] }), { status: 200 });
    const manager = new ModelManager({ apiKey: "test-key" });
    assert.equal(manager.current, "ollama: qwen3:1.7b");
    assert.deepEqual(await manager.localModels(), ["qwen3:1.7b"]);
    await assert.rejects(manager.select("ollama", "missing"), /not installed/);
    assert.equal(manager.current, "ollama: qwen3:1.7b");
    assert.equal(await manager.select("openai", "gpt-6-astra"), "openai: gpt-6-astra");
    assert.equal(await manager.select("ollama", "qwen3:1.7b"), "ollama: qwen3:1.7b");
  } finally {
    globalThis.fetch = original;
  }
});
