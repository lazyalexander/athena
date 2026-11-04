import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runTurn, type ReActEvent } from "../src/agent/core.ts";
import { registerFileTools } from "../src/workspace/file-tools.ts";
import { McpTools } from "../src/mcp/mcp.ts";
import { OpenAIClient } from "../src/providers/openai.ts";
import { OllamaClient } from "../src/providers/ollama.ts";
import { ToolRegistry } from "../src/agent/tools.ts";
import { Workspace } from "../src/workspace/workspace.ts";

const apiKey = process.env.OPENAI_API_KEY;
if (process.env.ATHENA_PROVIDER !== "ollama" && !apiKey) throw new Error("OPENAI_API_KEY is required");

const directory = await mkdtemp(join(tmpdir(), "athena-live-translation-"));
const mcp = new McpTools();
try {
  const workspace = await Workspace.open(directory);
  const tools = new ToolRegistry();
  registerFileTools(tools, workspace);
  await mcp.connect({ translation: {
    command: process.execPath,
    args: ["--experimental-strip-types", resolve("test/translation-server.ts")],
  } }, tools, workspace.root);
  const model = process.env.ATHENA_PROVIDER === "ollama"
    ? new OllamaClient(process.env.OLLAMA_MODEL ?? "qwen3:1.7b", workspace)
    : new OpenAIClient(apiKey!, process.env.OPENAI_MODEL ?? "gpt-6-astra", workspace, process.env.ATHENA_API_BASE_URL);
  const events: ReActEvent[] = [];
  const answer = await runTurn(model, tools,
    "Use the translation tool to translate 'hello' to French. Then use write_file to save exactly the translated word to translation.txt in the current workspace. Confirm after both tools succeed.",
    { onEvent: (event) => events.push(event) },
  );
  const content = await readFile(join(directory, "translation.txt"), "utf8");
  assert.equal(content, "bonjour");
  assert.ok(events.some((event) => event.type === "action" && event.tool === "mcp_translation_translate"));
  assert.ok(events.some((event) => event.type === "action" && event.tool === "write_file"));
  console.log(JSON.stringify({ ok: true, content, answer, actions: events.filter((event) => event.type === "action").map((event) => event.tool) }));
} finally {
  await mcp.close();
  await rm(directory, { recursive: true, force: true });
}
