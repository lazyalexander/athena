import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { ToolRequest } from "./core.ts";

export type JournalEvent =
  | { type: "conversation_start"; provider: string; model: string; ts: number }
  | { type: "turn_start"; turnId: string; ts: number }
  | { type: "user"; turnId: string; text: string }
  | { type: "assistant_step"; turnId: string; text: string; calls: ToolRequest[]; responseId?: string }
  | { type: "tool_result"; turnId: string; callId: string; ok: boolean; output: string }
  | { type: "turn_end"; turnId: string; answer: string; ts: number };

export class Journal {
  readonly path: string;
  private readonly onError?: (message: string) => void;
  private failed = false;

  private constructor(path: string, onError?: (message: string) => void) {
    this.path = path;
    this.onError = onError;
  }

  static open(workspaceRoot: string, onError?: (message: string) => void): Journal {
    const dir = join(workspaceRoot, ".athena");
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // record() reports the failure through onError.
    }
    return new Journal(join(dir, "journal.jsonl"), onError);
  }

  record(event: JournalEvent): void {
    try {
      appendFileSync(this.path, JSON.stringify(event) + "\n");
    } catch (error) {
      if (!this.failed) {
        this.failed = true;
        this.onError?.(`Session journal is not being recorded: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  archive(): string {
    const archived = join(this.path, "..", `journal-${Date.now()}.jsonl`);
    renameSync(this.path, archived);
    return archived;
  }

  static load(path: string): { events: JournalEvent[]; warnings: string[] } {
    const events: JournalEvent[] = [];
    const warnings: string[] = [];
    if (!existsSync(path)) return { events, warnings };
    const lines = readFileSync(path, "utf8").split("\n");
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as JournalEvent);
      } catch {
        warnings.push(`Skipped unreadable journal line ${index + 1}`);
      }
    }
    return { events, warnings };
  }
}

export function findUnfinishedTurn(events: JournalEvent[]): string | undefined {
  let unfinished: string | undefined;
  for (const event of events) {
    if (event.type === "turn_start") unfinished = event.turnId;
    else if (event.type === "turn_end" && event.turnId === unfinished) unfinished = undefined;
  }
  return unfinished;
}

export function conversationStart(events: JournalEvent[]): { provider: string; model: string } | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === "conversation_start") return { provider: event.provider, model: event.model };
  }
  return undefined;
}
