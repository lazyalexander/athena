import { existsSync } from "node:fs";
import { join } from "node:path";
import { TURN_ABORTED_NOTICE } from "../agent/core.ts";
import { Journal, findUnfinishedTurn, type JournalEvent } from "./journal.ts";

export interface Restorable {
  restore(events: JournalEvent[], notice: string): Promise<void>;
}

/**
 * Startup recovery: archives any previous journal and, if it holds an unfinished turn,
 * restores the conversation into the model with the turn_aborted notice. Every failure
 * degrades to a fresh session with a warning — startup never crash-loops on the journal.
 */
export async function recoverPreviousSession(
  workspaceRoot: string,
  model: Restorable,
  write: (text: string) => void,
): Promise<void> {
  const previousJournal = join(workspaceRoot, ".athena", "journal.jsonl");
  if (!existsSync(previousJournal)) return;
  let events: JournalEvent[];
  try {
    const loaded = Journal.load(previousJournal);
    for (const warning of loaded.warnings) write(`Journal warning: ${warning}\n`);
    // Always archive the previous log first so the interrupted session is preserved.
    Journal.open(workspaceRoot).archive();
    events = loaded.events;
  } catch (error) {
    write(`Could not restore the previous session (${error instanceof Error ? error.message : String(error)}); starting fresh.\n\n`);
    return;
  }
  if (!findUnfinishedTurn(events)) return;
  try {
    await model.restore(events, TURN_ABORTED_NOTICE);
    write("Recovered session after an interruption. The last turn was aborted; the model has been told not to repeat it. /new starts fresh.\n\n");
  } catch (error) {
    write(`Could not restore the previous session (${error instanceof Error ? error.message : String(error)}); starting fresh.\n\n`);
  }
}
