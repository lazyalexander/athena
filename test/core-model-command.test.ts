import assert from "node:assert/strict";
import { test } from "node:test";
import { runCore, type ModelControl, type TextIO } from "../src/agent/core.ts";
import { ToolRegistry } from "../src/agent/tools.ts";

function memoryIO(lines: string[]): { io: TextIO; output: () => string } {
  let text = "";
  const io: TextIO = {
    write: (chunk) => { text += chunk; },
    [Symbol.asyncIterator]: async function* () { yield* lines; },
  };
  return { io, output: () => text };
}

test("/model command lists providers from the registry and rejects unknown ids", async () => {
  const models: ModelControl = {
    current: "a: x-model",
    listModels: async () => [],
    select: async (provider, name) => `${provider}: ${name}`,
    providerIds: () => ["a", "b"],
  };
  const { io, output } = memoryIO(["/model", "/model a x", "/model zzz", "/exit"]);
  const model = { generate: async () => ({ text: "", calls: [] }) };
  await runCore(model, new ToolRegistry(), io, undefined, models);
  const text = output();
  assert.match(text, /Current model: a: x-model/);
  assert.match(text, /\(provider does not support listing\)/);
  assert.match(text, /Switch with \/model <provider> <name>\. Providers: a, b/);
  assert.match(text, /Model: a: x \(new conversation\)/);
  assert.match(text, /Unknown provider: zzz\. Available: a, b/);
  assert.match(text, /Usage: \/model \[<provider>\] \[name\]/);
});
