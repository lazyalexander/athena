import { ToolRegistry, type ToolSet } from "./tools.ts";
import type { Workspace } from "../workspace/workspace.ts";
import type { Journal, JournalEvent } from "../session/journal.ts";
import { TurnToolSet, type ApprovalPrompt } from "./permissions.ts";
import type { Sessions } from "../session/sessions.ts";
import { executeOperation, parseSlash, startConversation, submit, type ProtocolHost } from "../protocol/protocol.ts";

export { TURN_ABORTED_NOTICE } from "../protocol/protocol.ts";

export type ToolRequest = { name: string; callId: string; arguments: string };
export type ToolResult = { callId: string; output: string };
export type ModelStep = { text: string; calls: ToolRequest[]; responseId?: string };

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
  reset?(): void;
  restore?(events: JournalEvent[], notice: string): Promise<void>;
}

export type CoreContext = {
  sessions: Sessions;
  switchWorkspace?: (path: string) => Promise<void>;
};

export type ReActEvent =
  | { type: "step"; step: number; text: string; calls: ToolRequest[]; responseId?: string }
  | { type: "action"; step: number; tool: string; callId: string }
  | { type: "observation"; step: number; tool: string; callId: string; ok: boolean; output: string };

export type ReActOptions = {
  maxSteps?: number;
  onEvent?: (event: ReActEvent) => void;
  approve?: ApprovalPrompt;
};

/** Alternate model decisions and tool observations until a final answer. */
export async function runTurn(model: TextModel, registry: ToolRegistry, input: string, options: ReActOptions = {}): Promise<string> {
  if (!(registry instanceof ToolRegistry)) throw new Error("runTurn requires a ToolRegistry");
  const maxSteps = options.maxSteps ?? 16;
  if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new Error("maxSteps must be a positive integer");
  const tools = new TurnToolSet(registry, options.approve ?? (async () => false));
  try {
    let next: string | ToolResult[] = input;
    for (let step = 1; step <= maxSteps; step++) {
      const result = await model.generate(next, tools);
      options.onEvent?.({ type: "step", step, text: result.text, calls: result.calls, responseId: result.responseId });
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
        options.onEvent?.({ type: "observation", step, tool: call.name, callId: call.callId, ok, output });
      }
      next = observations;
    }
    throw new Error(`ReAct step limit reached (${maxSteps})`);
  } finally {
    tools.close();
  }
}

/** Runs one conversation until input ends or the user exits. Slash commands go through the protocol. */
export async function runCore(model: TextModel, tools: ToolRegistry, io: TextIO, workspace?: Workspace, models?: ModelControl, journal?: Journal, context?: CoreContext): Promise<void> {
  io.write("Athena\nType /exit to quit. Type /help for operations.\n\n");
  io.write("you> ");
  const lines = io[Symbol.asyncIterator]();
  const host: ProtocolHost = {
    surface: "tui",
    io,
    model,
    tools,
    workspace,
    models,
    journal,
    sessions: context?.sessions,
    switchWorkspace: context?.switchWorkspace,
    turnCount: { n: 0 },
    permissionMode: "untrusted",
    reviewLine: async () => {
      const decision = await lines.next();
      return decision.done ? undefined : decision.value;
    },
    runTurn: (input, options) => runTurn(model, tools, input, options),
  };
  startConversation(host);
  while (true) {
    const line = await lines.next();
    if (line.done) break;
    const input = line.value.trim();
    const command = parseSlash(input);
    if (command) {
      const status = await executeOperation(command.name, command.args, host, command.raw);
      if (status.effect === "exit") break;
      io.write("you> ");
      continue;
    }
    if (input) await submit(host, { type: "user_input", text: input });
    io.write("you> ");
  }
}
