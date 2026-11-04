import assert from "node:assert/strict";
import { test } from "node:test";
import { runCore, type ModelStep, type ToolResult } from "../src/agent/core.ts";
import { TurnToolSet } from "../src/agent/permissions.ts";
import { ToolRegistry } from "../src/agent/tools.ts";

test("approval covers an exact call only within one user turn", async () => {
  const tools = new ToolRegistry();
  let executions = 0;
  tools.register({ definition: { name: "write_file", parameters: { type: "object" } }, execute: async () => { executions++; return "written"; } });
  const output: string[] = [];
  let userTurns = 0;
  let denied = false;
  const model = { generate: async (input: string | ToolResult[]): Promise<ModelStep> => {
    if (typeof input === "string") {
      userTurns++;
      return { text: "", calls: userTurns === 1
        ? [{ name: "write_file", callId: "a", arguments: '{"path":"a.txt"}' }, { name: "write_file", callId: "b", arguments: '{"path":"a.txt"}' }]
        : [{ name: "write_file", callId: "c", arguments: '{"path":"a.txt"}' }] };
    }
    if (userTurns === 2) denied = input[0]?.output.includes("Permission denied") ?? false;
    return { text: "done", calls: [] };
  } };
  const io = {
    async *[Symbol.asyncIterator]() { yield "first"; yield "y"; yield "second"; yield "n"; yield "/exit"; },
    write(text: string) { output.push(text); },
  };
  await runCore(model, tools, io);
  assert.equal(executions, 2);
  assert.equal(output.filter((text) => text.startsWith("Allow write_file")).length, 2);
  assert.equal(denied, true);
});

test("changed arguments need fresh approval and EOF denies", async () => {
  const tools = new ToolRegistry();
  let executions = 0;
  tools.register({ definition: { name: "echo", parameters: { type: "object" } }, execute: async () => { executions++; return "ok"; } });
  let prompts = 0;
  const guarded = new TurnToolSet(tools, async () => ++prompts === 1);
  assert.equal(await guarded.call("echo", { text: "a" }), "ok");
  assert.equal(await guarded.call("echo", { text: "a" }), "ok");
  await assert.rejects(guarded.call("echo", { text: "b" }), /Permission denied/);
  assert.equal(prompts, 2);
  assert.equal(executions, 2);
  guarded.close();

  let denied = false;
  const model = { generate: async (input: string | ToolResult[]): Promise<ModelStep> => {
    if (typeof input === "string") return { text: "", calls: [{ name: "echo", callId: "e", arguments: "{}" }] };
    denied = input[0]?.output.includes("Permission denied") ?? false;
    return { text: "done", calls: [] };
  } };
  await runCore(model, tools, {
    async *[Symbol.asyncIterator]() { yield "request"; },
    write() {},
  });
  assert.equal(denied, true);
  assert.equal(executions, 2);
});
