import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { runCore } from "./core.ts";
import { OpenAIClient } from "./openai.ts";
import { McpTools, type McpServerConfig } from "./mcp.ts";
import { readFile } from "node:fs/promises";
import { ToolRegistry } from "./tools.ts";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("请先设置 OPENAI_API_KEY 环境变量。");
  process.exit(1);
}
const tools = new McpTools();
const registry = new ToolRegistry();
if (process.env.ATHENA_MCP_CONFIG) {
  const config = JSON.parse(await readFile(process.env.ATHENA_MCP_CONFIG, "utf8")) as { mcpServers: McpServerConfig };
  await tools.connect(config.mcpServers, registry);
}
const model = new OpenAIClient(apiKey, process.env.OPENAI_MODEL ?? "gpt-6-astra");
const terminal = createInterface({ input: stdin, crlfDelay: Infinity });

try {
  await runCore(model, registry, {
    [Symbol.asyncIterator]: () => terminal[Symbol.asyncIterator](),
    write: (text) => stdout.write(text),
  });
} finally {
  terminal.close();
  await tools.close();
}
