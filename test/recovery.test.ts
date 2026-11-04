import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TURN_ABORTED_NOTICE } from "../src/agent/core.ts";
import type { JournalEvent } from "../src/session/journal.ts";
import { recoverPreviousSession } from "../src/session/recovery.ts";

function writeJournal(root: string, events: JournalEvent[]): void {
  mkdirSync(join(root, ".athena"), { recursive: true });
  writeFileSync(join(root, ".athena", "journal.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

const crashedEvents: JournalEvent[] = [
  { type: "conversation_start", provider: "test", model: "m", ts: 1 },
  { type: "turn_start", turnId: "t1", ts: 2 },
  { type: "user", turnId: "t1", text: "hi" },
];

function fakeModel() {
  const calls: { events: JournalEvent[]; notice: string }[] = [];
  return {
    calls,
    restore: async (events: JournalEvent[], notice: string) => { calls.push({ events, notice }); },
  };
}

test("an unfinished turn restores the session and prints the banner", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-recovery-"));
  writeJournal(root, crashedEvents);
  const model = fakeModel();
  let out = "";
  await recoverPreviousSession(root, model, (text) => { out += text; });
  assert.equal(model.calls.length, 1);
  assert.equal(model.calls[0].notice, TURN_ABORTED_NOTICE);
  assert.deepEqual(model.calls[0].events.map((e) => e.type), ["conversation_start", "turn_start", "user"]);
  assert.match(out, /Recovered session after an interruption/);
});

test("a finished session archives without a banner or restore", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-recovery-"));
  writeJournal(root, [...crashedEvents, { type: "turn_end", turnId: "t1", answer: "hi", ts: 3 }]);
  const model = fakeModel();
  let out = "";
  await recoverPreviousSession(root, model, (text) => { out += text; });
  assert.equal(model.calls.length, 0);
  assert.equal(out, "");
});

test("a restore failure degrades to a fresh session with a warning", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-recovery-"));
  writeJournal(root, crashedEvents);
  let out = "";
  await recoverPreviousSession(root, {
    restore: async () => { throw new Error("Journal has no response id to resume"); },
  }, (text) => { out += text; });
  assert.match(out, /Could not restore the previous session \(Journal has no response id to resume\); starting fresh\./);
});

test("an unreadable or unarchivable journal degrades instead of crashing startup", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-recovery-"));
  // journal.jsonl as a directory: load and archive both fail.
  mkdirSync(join(root, ".athena", "journal.jsonl"), { recursive: true });
  const model = fakeModel();
  let out = "";
  await recoverPreviousSession(root, model, (text) => { out += text; });
  assert.equal(model.calls.length, 0);
  assert.match(out, /Could not restore the previous session/);
});

test("a truncated last line warns and still restores", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-recovery-"));
  writeJournal(root, crashedEvents);
  appendFileSync(join(root, ".athena", "journal.jsonl"), '{"type":"assistant_s');
  const model = fakeModel();
  let out = "";
  await recoverPreviousSession(root, model, (text) => { out += text; });
  assert.match(out, /Skipped unreadable journal line/);
  assert.equal(model.calls.length, 1);
});
