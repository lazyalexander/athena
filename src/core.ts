import type { ToolSet } from "./tools.ts";

export type ToolRequest = { name: string; callId: string; arguments: string };
export type ToolResult = { callId: string; output: string };
export type ModelStep = { text: string; calls: ToolRequest[] };

export interface TextModel {
  generate(input: string | ToolResult[], tools: ToolSet): Promise<ModelStep>;
}

export interface TextIO extends AsyncIterable<string> {
  write(text: string): void;
}

/** Resolve model tool requests until it produces a final text response. */
export async function runTurn(model: TextModel, tools: ToolSet, input: string): Promise<string> {
  let next: string | ToolResult[] = input;
  for (let step = 0; step < 16; step++) {
    const result = await model.generate(next, tools);
    if (result.calls.length === 0) return result.text || "(No text response)";
    next = await Promise.all(result.calls.map(async (call) => {
      let output: string;
      try {
        output = await tools.call(call.name, JSON.parse(call.arguments));
      } catch (error) {
        output = `Tool error: ${error instanceof Error ? error.message : String(error)}`;
      }
      return { callId: call.callId, output };
    }));
  }
  throw new Error("Tool call limit reached (16)");
}

/** Runs one conversation until input ends or the user exits. */
export async function runCore(model: TextModel, tools: ToolSet, io: TextIO): Promise<void> {
  io.write("Athena\nType /exit to quit.\n\n");
  io.write("you> ");

  for await (const line of io) {
    const input = line.trim();
    if (input === "/exit" || input === "/quit") break;

    if (input) {
      try {
        io.write(`athena> ${await runTurn(model, tools, input)}\n\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        io.write(`Request failed: ${message}\n\n`);
      }
    }
    io.write("you> ");
  }
}
