import type { ToolSet } from "./tools.ts";
import type { Workspace } from "./workspace.ts";
import { TurnToolSet } from "./permissions.ts";

export type ToolRequest = { name: string; callId: string; arguments: string };
export type ToolResult = { callId: string; output: string };
export type ModelStep = { text: string; calls: ToolRequest[] };

export interface TextModel {
  generate(input: string | ToolResult[], tools: ToolSet): Promise<ModelStep>;
}

export interface TextIO extends AsyncIterable<string> {
  write(text: string): void;
}

export interface ModelControl {
  readonly current: string;
  listModels(): Promise<string[]>;
  select(provider: string, name?: string): Promise<string>;
  providerIds(): string[];
}

export type ReActEvent =
  | { type: "action"; step: number; tool: string; callId: string }
  | { type: "observation"; step: number; tool: string; callId: string; ok: boolean };

export type ReActOptions = {
  maxSteps?: number;
  onEvent?: (event: ReActEvent) => void;
};

/** Alternate model decisions and tool observations until a final answer. */
export async function runTurn(model: TextModel, tools: ToolSet, input: string, options: ReActOptions = {}): Promise<string> {
  const maxSteps = options.maxSteps ?? 16;
  if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new Error("maxSteps must be a positive integer");
  let next: string | ToolResult[] = input;
  for (let step = 1; step <= maxSteps; step++) {
    const result = await model.generate(next, tools);
    if (result.calls.length === 0) return result.text || "(No text response)";
    const seen = new Set<string>();
    const observations: ToolResult[] = [];
    for (const call of result.calls) {
      if (!call.callId || seen.has(call.callId)) throw new Error("Duplicate or missing tool call ID");
      seen.add(call.callId);
      options.onEvent?.({ type: "action", step, tool: call.name, callId: call.callId });
      let output: string;
      let ok = true;
      try {
        output = await tools.call(call.name, JSON.parse(call.arguments));
      } catch (error) {
        ok = false;
        output = `Tool error: ${error instanceof Error ? error.message : String(error)}`;
      }
      observations.push({ callId: call.callId, output });
      options.onEvent?.({ type: "observation", step, tool: call.name, callId: call.callId, ok });
    }
    next = observations;
  }
  throw new Error(`ReAct step limit reached (${maxSteps})`);
}

/** Runs one conversation until input ends or the user exits. */
export async function runCore(model: TextModel, tools: ToolSet, io: TextIO, workspace?: Workspace, models?: ModelControl): Promise<void> {
  io.write("Athena\nType /exit to quit. Use /workspace or /model for settings.\n\n");
  io.write("you> ");

  const lines = io[Symbol.asyncIterator]();
  while (true) {
    const line = await lines.next();
    if (line.done) break;
    const input = line.value.trim();
    if (input === "/exit" || input === "/quit") break;

    if (input === "/model" || input.startsWith("/model ")) {
      if (!models) {
        io.write("Model selection is unavailable.\n\n");
      } else {
        const parts = input.split(/\s+/);
        const ids = models.providerIds();
        try {
          if (parts.length === 1) {
            io.write(`Current model: ${models.current}\n`);
            const available = await models.listModels();
            io.write(available.length
              ? `Available models: ${available.join(", ")}\n`
              : "(provider does not support listing)\n");
            io.write(`Switch with /model <provider> <name>. Providers: ${ids.join(", ")}.\n\n`);
          } else if (ids.includes(parts[1]) && parts.length <= 3) {
            const selected = await models.select(parts[1], parts[2]);
            io.write(`Model: ${selected} (new conversation)\n\n`);
          } else {
            const unknown = parts.length > 1 && !ids.includes(parts[1])
              ? `Unknown provider: ${parts[1]}. Available: ${ids.join(", ")}\n` : "";
            io.write(`${unknown}Usage: /model [<provider>] [name]\n\n`);
          }
        } catch (error) {
          io.write(`Model error: ${error instanceof Error ? error.message : String(error)}\n\n`);
        }
      }
      io.write("you> ");
      continue;
    }

    if (input === "/workspace" || input.startsWith("/workspace ")) {
      if (!workspace) {
        io.write("No workspace is configured.\n\n");
      } else {
        const path = input.slice("/workspace".length).trim();
        try {
          if (path) await workspace.switchTo(path);
          io.write(`Workspace: ${workspace.root}\n\n`);
        } catch (error) {
          io.write(`Workspace error: ${error instanceof Error ? error.message : String(error)}\n\n`);
        }
      }
      io.write("you> ");
      continue;
    }

    if (input) {
      const turnTools = new TurnToolSet(tools, async (request) => {
        io.write(`Allow ${request.tool} ${request.arguments} for this turn? [y/N] `);
        const decision = await lines.next();
        return !decision.done && /^(y|yes)$/i.test(decision.value.trim());
      });
      try {
        const answer = await runTurn(model, turnTools, input, {
          onEvent: (event) => {
            if (event.type === "action") io.write(`  → ${event.tool}\n`);
            else io.write(`  ← ${event.tool}: ${event.ok ? "ok" : "error"}\n`);
          },
        });
        io.write(`athena> ${answer}\n\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        io.write(`Request failed: ${message}\n\n`);
      } finally {
        turnTools.close();
      }
    }
    io.write("you> ");
  }
}
