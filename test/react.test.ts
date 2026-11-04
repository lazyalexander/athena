import assert from "node:assert/strict";
import { test } from "node:test";
import { runTurn, type ModelStep, type ToolResult, type ReActEvent } from "../src/agent/core.ts";
import { ToolRegistry } from "../src/agent/tools.ts";

test("ReAct executes actions in order and feeds observations back to the model", async () => {
  const tools = new ToolRegistry();
  const order: string[] = [];
  tools.register({ definition: { name: "first", parameters: { type: "object" } }, execute: async () => { order.push("first"); return "A"; } });
  tools.register({ definition: { name: "second", parameters: { type: "object" } }, execute: async () => { order.push("second"); return "B"; } });
  const events: ReActEvent[] = [];
  let step = 0;
  const model = { generate: async (input: string | ToolResult[]): Promise<ModelStep> => {
    step++;
    if (step === 1) return { text: "", calls: [{ name: "first", callId: "a", arguments: "{}" }] };
    if (step === 2) {
      assert.deepEqual(input, [{ callId: "a", output: "A" }]);
      return { text: "", calls: [{ name: "second", callId: "b", arguments: "{}" }] };
    }
    assert.deepEqual(input, [{ callId: "b", output: "B" }]);
    return { text: "AB", calls: [] };
  } };
  assert.equal(await runTurn(model, tools, "start", { onEvent: (event) => events.push(event) }), "AB");
  assert.deepEqual(order, ["first", "second"]);
  assert.deepEqual(events.map((event) => event.type), ["step", "action", "observation", "step", "action", "observation", "step"]);
});

test("ReAct returns tool errors as observations and enforces step limit", async () => {
  const tools = new ToolRegistry();
  let seenError = false;
  const model = { generate: async (input: string | ToolResult[]): Promise<ModelStep> => {
    if (typeof input !== "string" && input[0]?.output.startsWith("Tool error:")) seenError = true;
    return { text: "", calls: [{ name: "missing", callId: `c${Number(seenError)}`, arguments: "{}" }] };
  } };
  await assert.rejects(runTurn(model, tools, "start", { maxSteps: 2 }), /step limit/);
  assert.equal(seenError, true);
});

test("runTurn emits a step event after each model call, carrying responseId", async () => {
  const tools = new ToolRegistry();
  tools.register({ definition: { name: "noop", parameters: { type: "object" } }, execute: async () => "ok" });
  const events: ReActEvent[] = [];
  let step = 0;
  const model = { generate: async (): Promise<ModelStep> => {
    step++;
    if (step === 1) return { text: "", calls: [{ name: "noop", callId: "c1", arguments: "{}" }], responseId: "r1" };
    return { text: "done", calls: [] };
  } };
  await runTurn(model, tools, "start", { onEvent: (event) => events.push(event) });
  assert.equal(events[0].type, "step");
  assert.deepEqual(events[0], { type: "step", step: 1, text: "", calls: [{ name: "noop", callId: "c1", arguments: "{}" }], responseId: "r1" });
  const last = events[events.length - 1];
  assert.deepEqual(last, { type: "step", step: 2, text: "done", calls: [], responseId: undefined });
});
