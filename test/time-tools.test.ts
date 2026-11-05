import assert from "node:assert/strict";
import { test } from "node:test";
import { registerTimeTools } from "../src/agent/time-tools.ts";
import { ToolRegistry } from "../src/agent/tools.ts";

test("elapsed_time calculates offset-aware intervals without policy judgment", async () => {
  const tools = new ToolRegistry();
  registerTimeTools(tools);
  const result = JSON.parse(await tools.call("elapsed_time", {
    start: "2024-05-14T09:52:38-05:00",
    end: "2024-05-15T15:00:00-05:00",
  })) as { elapsedSeconds: number; elapsedHours: number };
  assert.equal(result.elapsedSeconds, 104842);
  assert.ok(result.elapsedHours > 29 && result.elapsedHours < 30);
  await assert.rejects(tools.call("elapsed_time", { start: "2024-05-14T09:52:38", end: "2024-05-15T15:00:00-05:00" }), /offsets/);
});
