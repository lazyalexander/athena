import assert from "node:assert/strict";
import { test } from "node:test";
import { runTurn, type ModelStep, type ToolResult, type ReActEvent } from "../src/core.ts";
import { ToolRegistry } from "../src/tools.ts";

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
  assert.deepEqual(events.map((event) => event.type), ["action", "observation", "action", "observation"]);
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
