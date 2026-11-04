import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runCore, type ModelControl, type TextIO } from "../src/agent/core.ts";
import { Journal } from "../src/session/journal.ts";
import { ToolRegistry } from "../src/agent/tools.ts";
import { Workspace } from "../src/workspace/workspace.ts";

function memoryIO(lines: string[]): { io: TextIO; output: () => string } {
  let text = "";
  const io: TextIO = {
    write: (chunk) => { text += chunk; },
    [Symbol.asyncIterator]: async function* () { yield* lines; },
  };
  return { io, output: () => text };
}

function fakeModels(initial = "ollama: qwen3:1.7b"): ModelControl & { resets: number } {
  return {
    current: initial,
    resets: 0,
    listModels: async () => [],
    async select(provider, name) { this.current = `${provider}: ${name}`; return this.current; },
    providerIds: () => ["a", "b"],
    reset() { this.resets++; },
  };
}

function eventsAt(root: string) {
  return Journal.load(join(root, ".athena", "journal.jsonl")).events.map((e) => e.type);
}

test("runCore records a full turn into the journal", async () => {
  const workspace = await Workspace.open(mkdtempSync(join(tmpdir(), "athena-core-")));
  const journal = Journal.open(workspace.root);
  const model = { generate: async () => ({ text: "hi", calls: [] }) };
  const { io } = memoryIO(["hello", "/exit"]);
  await runCore(model, new ToolRegistry(), io, workspace, fakeModels(), journal);
  assert.deepEqual(eventsAt(workspace.root), ["conversation_start", "turn_start", "user", "assistant_step", "turn_end"]);
});

test("a failed turn leaves turn_start without turn_end", async () => {
  const workspace = await Workspace.open(mkdtempSync(join(tmpdir(), "athena-core-")));
  const journal = Journal.open(workspace.root);
  const model = { generate: async () => { throw new Error("boom"); } };
  const { io } = memoryIO(["hello", "/exit"]);
  await runCore(model, new ToolRegistry(), io, workspace, fakeModels(), journal);
  assert.deepEqual(eventsAt(workspace.root), ["conversation_start", "turn_start", "user"]);
});

test("/new archives the journal and resets the conversation", async () => {
  const workspace = await Workspace.open(mkdtempSync(join(tmpdir(), "athena-core-")));
  const journal = Journal.open(workspace.root);
  const model = { generate: async () => ({ text: "hi", calls: [] }) };
  const models = fakeModels();
  const { io, output } = memoryIO(["hello", "/new", "/exit"]);
  await runCore(model, new ToolRegistry(), io, workspace, models, journal);
  const files = readdirSync(join(workspace.root, ".athena")).sort();
  assert.equal(files.filter((f) => /^journal-\d+\.jsonl$/.test(f)).length, 1);
  assert.deepEqual(eventsAt(workspace.root), ["conversation_start"]);
  assert.equal(models.resets, 1);
  assert.match(output(), /Started a new conversation\./);
});

test("/model and /workspace switches archive the journal and start a new one", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-core-"));
  const other = mkdtempSync(join(tmpdir(), "athena-other-"));
  const workspace = await Workspace.open(root);
  const journal = Journal.open(root);
  const model = { generate: async () => ({ text: "hi", calls: [] }) };
  const { io } = memoryIO(["hello", "/model a x", `/workspace ${other}`, "/exit"]);
  await runCore(model, new ToolRegistry(), io, workspace, fakeModels(), journal);
  const rootFiles = readdirSync(join(root, ".athena")).sort();
  const archives = rootFiles.filter((f) => /^journal-\d+(-\d+)?\.jsonl$/.test(f));
  assert.equal(archives.length, 2);
  let sawProviderA = false;
  for (const file of archives) {
    for (const event of Journal.load(join(root, ".athena", file)).events) {
      if (event.type === "conversation_start" && event.provider === "a") sawProviderA = true;
    }
  }
  assert.ok(sawProviderA, "one archived journal starts a conversation with provider a");
  assert.equal(eventsAt(other)[0], "conversation_start");
});
