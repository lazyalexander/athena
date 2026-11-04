import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Journal, conversationStart, findUnfinishedTurn, type JournalEvent } from "../src/session/journal.ts";

function dir(): string {
  return mkdtempSync(join(tmpdir(), "athena-journal-"));
}

test("journal round-trips all event types", () => {
  const journal = Journal.open(dir());
  const events: JournalEvent[] = [
    { type: "conversation_start", provider: "ollama", model: "qwen3:1.7b", ts: 1 },
    { type: "turn_start", turnId: "turn-1", ts: 2 },
    { type: "user", turnId: "turn-1", text: "hi" },
    { type: "assistant_step", turnId: "turn-1", text: "", calls: [{ name: "read_file", callId: "c1", arguments: "{}" }], responseId: "r1" },
    { type: "tool_result", turnId: "turn-1", callId: "c1", ok: true, output: "content" },
    { type: "turn_end", turnId: "turn-1", answer: "done", ts: 3 },
  ];
  for (const event of events) journal.record(event);
  const loaded = Journal.load(journal.path);
  assert.deepEqual(loaded.events, events);
  assert.deepEqual(loaded.warnings, []);
});

test("load tolerates a truncated trailing line", () => {
  const root = dir();
  const path = join(root, "journal.jsonl");
  writeFileSync(path, '{"type":"turn_start","turnId":"t1","ts":1}\n{"type":"user","turnId":"t1","text":"hi"}\n{"type":"turn_sta');
  const loaded = Journal.load(path);
  assert.equal(loaded.events.length, 2);
  assert.equal(loaded.warnings.length, 1);
});

test("load of a missing file is empty", () => {
  const loaded = Journal.load(join(dir(), "nope.jsonl"));
  assert.deepEqual(loaded.events, []);
  assert.deepEqual(loaded.warnings, []);
});

test("findUnfinishedTurn and conversationStart inspect the event tail", () => {
  const complete: JournalEvent[] = [
    { type: "turn_start", turnId: "t1", ts: 1 },
    { type: "turn_end", turnId: "t1", answer: "ok", ts: 2 },
  ];
  assert.equal(findUnfinishedTurn(complete), undefined);
  const crashed: JournalEvent[] = [...complete, { type: "turn_start", turnId: "t2", ts: 3 }];
  assert.equal(findUnfinishedTurn(crashed), "t2");
  const starts: JournalEvent[] = [
    { type: "conversation_start", provider: "ollama", model: "a", ts: 1 },
    { type: "conversation_start", provider: "openai", model: "b", ts: 2 },
  ];
  assert.deepEqual(conversationStart(starts), { provider: "openai", model: "b" });
  assert.equal(conversationStart(complete), undefined);
});

test("record failures report once through onError and never throw", () => {
  const root = dir();
  writeFileSync(join(root, ".athena"), "not a directory");
  const errors: string[] = [];
  const journal = Journal.open(root, (message) => errors.push(message));
  journal.record({ type: "turn_start", turnId: "t1", ts: 1 });
  journal.record({ type: "turn_start", turnId: "t2", ts: 2 });
  assert.equal(errors.length, 1);
});

test("archive renames the journal and keeps its content", () => {
  const journal = Journal.open(dir());
  journal.record({ type: "turn_start", turnId: "t1", ts: 1 });
  const content = readFileSync(journal.path, "utf8");
  const archived = journal.archive();
  assert.match(archived, /journal-\d+\.jsonl$/);
  assert.equal(existsSync(journal.path), false);
  assert.equal(readFileSync(archived, "utf8"), content);
  assert.ok(readdirSync(join(archived, "..")).includes(archived.split("/").pop()!));
});
