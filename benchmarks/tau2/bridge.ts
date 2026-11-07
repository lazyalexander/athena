import { createInterface } from "node:readline";
import { createProviderLayer } from "../../src/providers/entry.ts";
import type { TextModel } from "../../src/agent/core.ts";
import type { ToolSet } from "../../src/agent/tools.ts";

const providers = createProviderLayer();
let client: TextModel | undefined;
for await (const line of createInterface({ input: process.stdin })) {
  try {
    const request = JSON.parse(line);
    const provider = providers.registry.get(process.env.ATHENA_BENCH_PROVIDER ?? providers.defaultId);
    client ??= provider.createClient(process.env.ATHENA_BENCH_MODEL ?? provider.defaultModel, undefined, { notice: request.policy });
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
