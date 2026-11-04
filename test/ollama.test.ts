import assert from "node:assert/strict";
import { test } from "node:test";
import { OllamaClient } from "../src/providers/ollama.ts";
import { ToolRegistry } from "../src/agent/tools.ts";

test("Ollama adapter sends tool results back with the matching tool name", async () => {
  const original = globalThis.fetch;
  const requests: Array<{ messages: Array<{ role: string; tool_name?: string; content: string }> }> = [];
  try {
    globalThis.fetch = async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      const message = requests.length === 1
        ? { content: "", tool_calls: [{ function: { name: "echo", arguments: { text: "hi" } } }] }
        : { content: "done" };
      return new Response(JSON.stringify({ message }), { status: 200 });
    };
    const tools = new ToolRegistry();
    tools.register({ definition: { name: "echo", parameters: { type: "object" } }, execute: async () => "ok" });
    const client = new OllamaClient("test-model");
    const first = await client.generate("start", tools);
    assert.equal(first.calls[0]?.name, "echo");
    const second = await client.generate([{ callId: first.calls[0]!.callId, output: "ok" }], tools);
    assert.equal(second.text, "done");
    assert.equal(requests[1]?.messages.at(-2)?.role, "assistant");
    assert.deepEqual(requests[1]?.messages.at(-1), { role: "tool", tool_name: "echo", content: "ok" });
  } finally {
    globalThis.fetch = original;
  }
});
