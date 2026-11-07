import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { runTurn } from "../src/agent/core.ts";
import { McpTools } from "../src/mcp/mcp.ts";
import { ToolRegistry } from "../src/agent/tools.ts";

test("translation MCP tool is discovered and called by the core loop", async () => {
  const mcp = new McpTools();
  const registry = new ToolRegistry();
  try {
    await mcp.connect({ translation: {
      command: process.execPath,
      args: ["--experimental-strip-types", resolve("test/translation-server.ts")],
    } }, registry);
    assert.equal(registry.definitions[0]?.name, "mcp_translation_translate");
    let requests = 0;
    const model = { generate: async (input: string | { callId: string; output: string }[]) => {
      if (++requests === 1) return { text: "", calls: [{ name: "mcp_translation_translate", callId: "call_1", arguments: '{"text":"hello"}' }] };
      assert.equal(typeof input, "object");
      return { text: input[0]!.output, calls: [] };
    } };
    const output = await runTurn(model, registry, "translate hello", { approve: async () => true });
    assert.match(output, /bonjour/);
    assert.equal(requests, 2);
  } finally {
    await mcp.close();
  }
});
