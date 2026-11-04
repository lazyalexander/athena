import type { ToolSet } from "./tools.ts";
import type { Workspace } from "./workspace.ts";
import { Journal } from "./journal.ts";
import { TurnToolSet } from "./permissions.ts";
import { existsSync } from "node:fs";

export const TURN_ABORTED_NOTICE =
  '<turn_aborted reason="process_exit">The previous turn was interrupted before completion. ' +
  "Do not automatically continue or repeat its actions, especially side-effecting ones. " +
  "Summarize what completed and ask the user how to proceed.</turn_aborted>";

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
}

export type ReActEvent =
  | { type: "step"; step: number; text: string; calls: ToolRequest[]; responseId?: string }
  | { type: "action"; step: number; tool: string; callId: string }
  | { type: "observation"; step: number; tool: string; callId: string; ok: boolean; output: string };

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
}

/** Runs one conversation until input ends or the user exits. */
export async function runCore(model: TextModel, tools: ToolSet, io: TextIO, workspace?: Workspace, models?: ModelControl, journal?: Journal): Promise<void> {
  io.write("Athena\nType /exit to quit. Use /workspace or /model for settings.\n\n");
  io.write("you> ");

  let activeJournal = journal;
  let turnCount = 0;
  const startConversation = () => {
    if (!activeJournal) return;
    const [provider, name] = (models?.current ?? "unknown: unknown").split(": ");
    activeJournal.record({ type: "conversation_start", provider, model: name, ts: Date.now() });
  };
  const rotateJournal = () => {
    if (!activeJournal || !workspace) return;
    if (existsSync(activeJournal.path)) activeJournal.archive();
    activeJournal = Journal.open(workspace.root, (message) => io.write(`Journal warning: ${message}\n`));
    startConversation();
  };
  startConversation();

  const lines = io[Symbol.asyncIterator]();
  while (true) {
    const line = await lines.next();
    if (line.done) break;
    const input = line.value.trim();
    if (input === "/exit" || input === "/quit") break;

    if (input === "/new") {
      if (!models?.reset) {
        io.write("Starting a new conversation is unavailable.\n\n");
      } else {
        rotateJournal();
        models.reset();
        io.write("Started a new conversation.\n\n");
      }
      io.write("you> ");
      continue;
    }

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
            rotateJournal();
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
          if (path) {
            await workspace.switchTo(path);
            rotateJournal();
          }
          io.write(`Workspace: ${workspace.root}\n\n`);
        } catch (error) {
          io.write(`Workspace error: ${error instanceof Error ? error.message : String(error)}\n\n`);
        }
      }
      io.write("you> ");
      continue;
    }

    if (input) {
      const turnId = `turn-${++turnCount}`;
      activeJournal?.record({ type: "turn_start", turnId, ts: Date.now() });
      activeJournal?.record({ type: "user", turnId, text: input });
      const turnTools = new TurnToolSet(tools, async (request) => {
        io.write(`Allow ${request.tool} ${request.arguments} for this turn? [y/N] `);
        const decision = await lines.next();
        return !decision.done && /^(y|yes)$/i.test(decision.value.trim());
      });
      try {
        const answer = await runTurn(model, turnTools, input, {
          onEvent: (event) => {
            if (event.type === "action") io.write(`  → ${event.tool}\n`);
            else if (event.type === "observation") io.write(`  ← ${event.tool}: ${event.ok ? "ok" : "error"}\n`);
            if (event.type === "step") {
              activeJournal?.record({ type: "assistant_step", turnId, text: event.text, calls: event.calls, responseId: event.responseId });
            } else if (event.type === "observation") {
              activeJournal?.record({ type: "tool_result", turnId, callId: event.callId, ok: event.ok, output: event.output });
            }
          },
        });
        activeJournal?.record({ type: "turn_end", turnId, answer, ts: Date.now() });
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
