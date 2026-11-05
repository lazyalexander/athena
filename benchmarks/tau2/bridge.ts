import { createInterface } from "node:readline";
import { OllamaClient } from "../../src/providers/ollama.ts";
import { OpenAIClient } from "../../src/providers/openai.ts";
import type { ToolSet } from "../../src/agent/tools.ts";

let client: OllamaClient | OpenAIClient | undefined;
for await (const line of createInterface({ input: process.stdin })) {
  try {
    const request = JSON.parse(line);
    client ??= process.env.ATHENA_BENCH_PROVIDER === "deepseek"
      ? new OpenAIClient(process.env.DEEPSEEK_API_KEY ?? "", process.env.ATHENA_BENCH_MODEL ?? "deepseek-chat",
        undefined, "https://api.deepseek.com", request.policy, true)
      : new OllamaClient(process.env.ATHENA_BENCH_MODEL ?? "qwen3:1.7b", undefined,
        process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434", { notice: request.policy });
    const tools: ToolSet = {
      definitions: request.tools,
      call: async () => { throw new Error("The benchmark owns tool execution"); },
    };
    const result = await client.generate(request.input, tools);
    process.stdout.write(JSON.stringify({ result }) + "\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + "\n");
  }
}
