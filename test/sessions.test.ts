import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runCore, type TextIO } from "../src/agent/core.ts";
import { Journal, type JournalEvent } from "../src/session/journal.ts";
import { Sessions } from "../src/session/sessions.ts";
import { ToolRegistry } from "../src/agent/tools.ts";
import { Workspace } from "../src/workspace/workspace.ts";

function memoryIO(lines: string[]): { io: TextIO; output: () => string } {
  let text = "";
  return { io: { write: (s) => { text += s; }, [Symbol.asyncIterator]: async function* () { yield* lines; } }, output: () => text };
}

test("one workspace retains independent sessions and active selection", () => {
  const root = mkdtempSync(join(tmpdir(), "athena-sessions-"));
  const sessions = Sessions.open(root, "ollama", "a");
  const first = sessions.active;
  sessions.journal.record({ type: "conversation_start", provider: "ollama", model: "a", ts: 1 });
  const second = sessions.create("openai", "b");
  sessions.journal.record({ type: "conversation_start", provider: "openai", model: "b", ts: 2 });
  assert.equal(sessions.list().length, 2);
  sessions.activate(first.id);
  assert.equal(Sessions.open(root, "ignored", "ignored").active.id, first.id);
  assert.equal(Journal.load(sessions.journal.path).events.length, 1);
  assert.equal(Journal.load(sessions.journalPath(second.id)).events.length, 1);
  assert.ok(existsSync(join(root, ".athena", "sessions", first.id, "session.json")));
  assert.ok(existsSync(join(root, ".athena", "sessions", first.id, "journal.jsonl")));
  assert.throws(() => sessions.activate("../escape"), /Invalid session ID/);
});

test("flat multi-session files migrate into per-session folders", () => {
  const root = mkdtempSync(join(tmpdir(), "athena-sessions-"));
  const dir = join(root, ".athena", "sessions");
  mkdirSync(dir, { recursive: true });
  const id = "11111111-1111-4111-8111-111111111111";
  writeFileSync(join(dir, "active"), id + "\n");
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({ id, provider: "ollama", model: "old", createdAt: 1 }));
  writeFileSync(join(dir, `${id}.jsonl`), '{"type":"conversation_start","provider":"ollama","model":"old","ts":1}\n');
  const sessions = Sessions.open(root, "openai", "new");
  assert.equal(sessions.active.id, id);
  assert.equal(Journal.load(sessions.journal.path).events.length, 1);
  assert.ok(existsSync(join(dir, id, "session.json")));
});

test("legacy workspace journal becomes the first session", () => {
  const root = mkdtempSync(join(tmpdir(), "athena-sessions-"));
  mkdirSync(join(root, ".athena"));
  const event: JournalEvent = { type: "conversation_start", provider: "ollama", model: "old", ts: 1 };
  writeFileSync(join(root, ".athena", "journal.jsonl"), JSON.stringify(event) + "\n");
  const sessions = Sessions.open(root, "openai", "new");
  assert.equal(sessions.active.model, "old");
  assert.deepEqual(Journal.load(sessions.journal.path).events, [event]);
});

test("TUI switches sessions and restores each conversation", async () => {
  const workspace = await Workspace.open(mkdtempSync(join(tmpdir(), "athena-sessions-")));
  const sessions = Sessions.open(workspace.root, "ollama", "a");
  const first = sessions.active.id;
  const second = sessions.create("ollama", "b").id;
  sessions.journal.record({ type: "conversation_start", provider: "ollama", model: "b", ts: 1 });
  sessions.activate(first);
  const restored: string[] = [];
  const model = { generate: async () => ({ text: "ok", calls: [] }) };
  const models = {
    current: "ollama: a", listModels: async () => [], providerIds: () => ["ollama"],
    async select(provider: string, name?: string) { this.current = `${provider}: ${name}`; return this.current; },
    reset() {},
    async restore(events: JournalEvent[]) { restored.push((events.find((e) => e.type === "conversation_start") as { model: string }).model); },
  };
  const { io, output } = memoryIO(["hello", `/session use ${second}`, "world", `/session use ${first}`, "/sessions", "/exit"]);
  await runCore(model, new ToolRegistry(), io, workspace, models, sessions.journal, { sessions });
  assert.deepEqual(restored, ["b", "a"]);
  assert.equal(Journal.load(sessions.journalPath(first)).events.filter((e) => e.type === "user").length, 1);
  assert.equal(Journal.load(sessions.journalPath(second)).events.filter((e) => e.type === "user").length, 1);
  assert.match(output(), new RegExp(`\\* ${first}`));
});

test("workspace switch opens that workspace's active session", async () => {
  const firstRoot = mkdtempSync(join(tmpdir(), "athena-workspace-a-"));
  const secondRoot = mkdtempSync(join(tmpdir(), "athena-workspace-b-"));
  const workspace = await Workspace.open(firstRoot);
  const firstSessions = Sessions.open(firstRoot, "ollama", "a");
  const firstId = firstSessions.active.id;
  const secondSessions = Sessions.open(secondRoot, "ollama", "b");
  const secondId = secondSessions.active.id;
  const selected: string[] = [];
  const models = {
    current: "ollama: a", listModels: async () => [], providerIds: () => ["ollama"],
    async select(provider: string, name?: string) { this.current = `${provider}: ${name}`; selected.push(this.current); return this.current; },
    reset() {},
    async restore() {},
  };
  const { io } = memoryIO(["one", `/workspace ${secondRoot}`, "two", `/workspace ${firstRoot}`, "three", "/exit"]);
  await runCore({ generate: async () => ({ text: "ok", calls: [] }) }, new ToolRegistry(), io,
    workspace, models, firstSessions.journal, {
      sessions: firstSessions,
      switchWorkspace: async (path) => { await workspace.switchTo(path); },
    });
  assert.deepEqual(selected, ["ollama: b"]);
  assert.equal(Sessions.open(firstRoot, "x", "x").active.id, firstId);
  assert.equal(Sessions.open(secondRoot, "x", "x").active.id, secondId);
  assert.equal(Journal.load(firstSessions.journalPath(firstId)).events.filter((e) => e.type === "user").length, 2);
  assert.equal(Journal.load(secondSessions.journalPath(secondId)).events.filter((e) => e.type === "user").length, 1);
});
