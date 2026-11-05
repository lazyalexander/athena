import assert from "node:assert/strict";
import { test } from "node:test";
import { requireBookingWithin24Hours } from "../examples/booking-window.ts";
import { runTurn, type ModelStep, type ToolResult } from "../src/agent/core.ts";
import { TurnToolSet } from "../src/agent/permissions.ts";
import { ToolPreconditionDenied, ToolPreconditionFailed, ToolRegistry } from "../src/agent/tools.ts";

test("precondition reads current state on every execution, including approved repeats", async () => {
  const tools = new ToolRegistry();
  let checks = 0;
  let executions = 0;
  let approvals = 0;
  tools.register({
    definition: { name: "change", parameters: { type: "object" } },
    beforeExecute: async () => ({ allowed: ++checks === 1, reason: "State changed" }),
    execute: async () => { executions++; return "changed"; },
  });
  const turn = new TurnToolSet(tools, async () => { approvals++; return true; });
  assert.equal(await turn.call("change", {}), "changed");
  await assert.rejects(turn.call("change", {}), ToolPreconditionDenied);
  assert.equal(approvals, 1);
  assert.equal(checks, 2);
  assert.equal(executions, 1);
});

test("business example rejects an ineligible cancellation before its tool runs", async () => {
  const tools = new ToolRegistry();
  let executions = 0;
  tools.register({
    definition: { name: "cancel_reservation", parameters: { type: "object" } },
    beforeExecute: requireBookingWithin24Hours(async () => "2024-05-14T09:52:38-05:00", () => new Date("2024-05-15T15:00:00-05:00")),
    execute: async () => { executions++; return "cancelled"; },
  });
  let observation = "";
  let step = 0;
  const model = { generate: async (input: string | ToolResult[]): Promise<ModelStep> => {
    if (step++ === 0) return { text: "", calls: [{ name: "cancel_reservation", callId: "c1", arguments: '{"reservationId":"Q69X3R"}' }] };
    observation = (input as ToolResult[])[0].output;
    return { text: "Cannot cancel", calls: [] };
  } };
  assert.equal(await runTurn(model, tools, "cancel"), "Cannot cancel");
  assert.match(observation, /older than 24 hours/);
  assert.equal(executions, 0);
});

test("precondition lookup failures fail closed and do not execute", async () => {
  const tools = new ToolRegistry();
  let executions = 0;
  tools.register({
    definition: { name: "cancel", parameters: { type: "object" } },
    beforeExecute: requireBookingWithin24Hours(async () => { throw new Error("Database unavailable"); }, () => new Date()),
    execute: async () => { executions++; return "cancelled"; },
  });
  await assert.rejects(tools.call("cancel", { reservationId: "x" }), ToolPreconditionFailed);
  assert.equal(executions, 0);
});

test("invalid precondition decisions fail closed", async () => {
  const tools = new ToolRegistry();
  let executions = 0;
  tools.register({
    definition: { name: "change", parameters: { type: "object" } },
    beforeExecute: async () => ({ allowed: false, reason: "" }),
    execute: async () => { executions++; return "changed"; },
  });
  await assert.rejects(tools.call("change", {}), ToolPreconditionFailed);
  assert.equal(executions, 0);
});
