import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runTurn, type ModelStep, type ToolResult } from "../src/core.ts";
import { registerFileTools } from "../src/file-tools.ts";
import { McpTools } from "../src/mcp.ts";
import { ToolRegistry } from "../src/tools.ts";
import { Workspace } from "../src/workspace.ts";

test("translated MCP result is written into the selected workspace", async () => {
  const base = await mkdtemp(join(tmpdir(), "athena-translation-"));
  const mcp = new McpTools();
  try {
    const project = join(base, "selected-workspace");
    await mkdir(project);
    const workspace = await Workspace.open(project);
    const tools = new ToolRegistry();
    registerFileTools(tools, workspace);
    await mcp.connect({ translation: {
      command: process.execPath,
      args: ["--experimental-strip-types", resolve("test/translation-server.ts")],
    } }, tools, workspace.root);

    let step = 0;
    const model = { generate: async (input: string | ToolResult[]): Promise<ModelStep> => {
      step++;
      if (step === 1) return { text: "", calls: [{ name: "mcp_translation_translate", callId: "translate-1", arguments: '{"text":"hello"}' }] };
      if (step === 2) {
        assert.ok(Array.isArray(input));
        const result = JSON.parse(input[0]!.output) as { content: Array<{ type: string; text: string }> };
        assert.equal(result.content[0]?.text, "bonjour");
        return { text: "", calls: [{ name: "write_file", callId: "write-1", arguments: JSON.stringify({ path: "translation.txt", content: result.content[0]!.text }) }] };
      }
      assert.ok(Array.isArray(input));
      assert.equal(input[0]?.callId, "write-1");
      assert.doesNotMatch(input[0]!.output, /^Tool error:/);
      return { text: "Saved translation.", calls: [] };
    } };

    assert.equal(await runTurn(model, tools, "Translate hello and save it."), "Saved translation.");
    assert.equal(step, 3);
    assert.equal(await readFile(join(project, "translation.txt"), "utf8"), "bonjour");
  } finally {
    await mcp.close();
    await rm(base, { recursive: true, force: true });
  }
});
