import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderRegistry, type Provider } from "../src/providers.ts";

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
