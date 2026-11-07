import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runCore, runTurn, type TextIO } from "../src/agent/core.ts";
import { ToolRegistry } from "../src/agent/tools.ts";
import { executeOperation, operationsFor, parseArgv, parseSlash, renderHelp, sharedOperations, submit, type ProtocolHost } from "../src/protocol/protocol.ts";
import { decidePermission } from "../src/protocol/wire.ts";
import { Workspace } from "../src/workspace/workspace.ts";

function memoryIO(lines: string[]): { io: TextIO; output: () => string } {
  let text = "";
  const io: TextIO = {
    write: (chunk) => { text += chunk; },
    [Symbol.asyncIterator]: async function* () { yield* lines; },
  };
  return { io, output: () => text };
}

test("the command line and the TUI share every operation except exit", () => {
  assert.deepEqual(sharedOperations().map((operation) => operation.name), ["help", "prompt", "permissions", "model", "workspace", "sessions", "session", "new"]);
  assert.deepEqual(operationsFor("cli").map((operation) => operation.name), sharedOperations().map((operation) => operation.name));
  assert.deepEqual(operationsFor("tui").map((operation) => operation.name), [...sharedOperations().map((operation) => operation.name), "exit"]);
  assert.match(renderHelp("tui"), /both the command line and the TUI/);
  assert.match(renderHelp("tui"), /\/exit/);
  assert.equal(renderHelp("cli").includes("/exit"), false);
  assert.match(renderHelp("cli"), /prompt \[--permission-mode <mode>\] \[--yes\] <text>/);
});

test("slash and argv parsers agree on command names", () => {
  assert.equal(parseSlash("hello"), undefined);
  assert.deepEqual(parseSlash("/quit"), { name: "exit", args: [], raw: "/quit" });
  assert.deepEqual(parseSlash("/model a x"), { name: "model", args: ["a", "x"], raw: "/model a x" });
  assert.deepEqual(parseArgv([]), { name: "help", args: [], permissionMode: undefined });
  assert.deepEqual(parseArgv(["prompt", "--yes", "hello", "there"]), { name: "prompt", args: ["hello", "there"], permissionMode: "never" });
  assert.deepEqual(parseArgv(["--permission-mode", "on-request", "prompt", "hello"]), { name: "prompt", args: ["hello"], permissionMode: "on-request" });
  assert.throws(() => parseArgv(["--permission-mode", "yolo"]), /Unknown permission mode: yolo/);
  assert.equal(parseArgv(["exit"]).name, "exit");
});

test("a workspace path keeps its spaces", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-protocol-"));
  const nested = mkdtempSync(join(root, "my dir-"));
  const workspace = await Workspace.open(root);
  const { io, output } = memoryIO([`/workspace ${nested}`, "/exit"]);
  await runCore({ generate: async () => ({ text: "", calls: [] }) }, new ToolRegistry(), io, workspace, {
    current: "a: m", listModels: async () => [], providerIds: () => ["a"], reset() {},
    async select() { return this.current; },
  });
  assert.match(output(), /Workspace: .*my dir-/);
});

test("an unknown slash command is not sent to the model", async () => {
  let calls = 0;
  const { io, output } = memoryIO(["/nope", "/exit"]);
  await runCore({ generate: async () => { calls++; return { text: "", calls: [] }; } }, new ToolRegistry(), io);
  assert.equal(calls, 0);
  assert.match(output(), /Unknown operation: nope/);
  assert.match(output(), /both the command line and the TUI/);
});

test("the command line can show the model through the same operation", async () => {
  let text = "";
  const host: ProtocolHost = {
    surface: "cli",
    io: { write: (chunk) => { text += chunk; }, [Symbol.asyncIterator]: async function* () {} },
    model: { generate: async () => ({ text: "", calls: [] }) },
    tools: new ToolRegistry(),
    models: { current: "ollama: qwen3:1.7b", listModels: async () => ["qwen3:1.7b"], providerIds: () => ["ollama"], async select() { return this.current; } },
    turnCount: { n: 0 },
    runTurn: async () => "",
  };
  const status = await executeOperation("model", [], host);
  assert.equal(status.ok, true);
  assert.match(text, /Current model: ollama: qwen3:1.7b/);
  assert.match(text, /Available models: qwen3:1.7b/);
  assert.match(text, /Switch with model <provider> <name>/);
  const denied = await executeOperation("exit", [], host);
  assert.equal(denied.ok, false);
  assert.match(text, /exit is available in the tui only/);
});

test("permission mode is passed on a user_input op and gates tool approval", async () => {
  assert.equal(decidePermission("untrusted", "read_file"), "ask");
  assert.equal(decidePermission("on-request", "read_file"), "allow");
  assert.equal(decidePermission("on-request", "write_file"), "ask");
  assert.equal(decidePermission("on-request", "mcp_box_write"), "ask");
  assert.equal(decidePermission("never", "write_file"), "allow");

  const tools = new ToolRegistry();
  let executions = 0;
  tools.register({ definition: { name: "read_file", parameters: { type: "object" } }, execute: async () => { executions++; return "contents"; } });
  const events: string[] = [];
  const host: ProtocolHost = {
    surface: "cli",
    io: { write() {}, [Symbol.asyncIterator]: async function* () {} },
    model: { generate: async () => ({ text: "", calls: [] }) },
    tools,
    turnCount: { n: 0 },
    permissionMode: "untrusted",
    onEvent: (event) => events.push(event.msg.type),
    runTurn: (input, options) => runTurn({
      generate: async (value) => typeof value === "string"
        ? { text: "", calls: [{ name: "read_file", callId: "c1", arguments: "{}" }] }
        : { text: "done", calls: [] },
    }, tools, input, options),
  };
  const asked = await submit(host, { type: "user_input", text: "read it", permissionMode: "untrusted" });
  assert.equal(asked.ok, true);
  assert.equal(executions, 0);
  assert.deepEqual(events, ["turn_started", "exec_command_begin", "exec_command_end", "agent_message", "turn_complete"]);

  events.length = 0;
  let prompted = "";
  host.io.write = (chunk) => { prompted += chunk; };
  host.reviewLine = async () => "n";
  const interactive = await submit(host, { type: "user_input", text: "read it", permissionMode: "untrusted" });
  assert.equal(interactive.ok, true);
  assert.match(prompted, /Allow read_file \{\} for this turn\? \[y\/N\] /);
  assert.equal(executions, 0);
  assert.ok(events.includes("exec_approval_request"));

  events.length = 0;
  const allowed = await submit(host, { type: "user_input", text: "read it", permissionMode: "on-request" });
  assert.equal(allowed.ok, true);
  assert.equal(executions, 1);
  assert.equal(events.includes("exec_approval_request"), false);
  assert.ok(events.includes("turn_complete"));

  const configured = await submit(host, { type: "configure_permission", permissionMode: "never" });
  assert.equal(configured.ok, true);
  assert.equal(host.permissionMode, "never");
  const idle = await submit(host, { type: "interrupt" });
  assert.equal(idle.ok, true);
  assert.ok(events.includes("turn_aborted"));
});

test("external_step returns allowed calls and denies the rest without executing them", async () => {
  const events: string[] = [];
  let steps = 0;
  const host: ProtocolHost = {
    surface: "cli",
    io: { write() {}, [Symbol.asyncIterator]: async function* () {} },
    model: {
      generate: async (input) => {
        steps += 1;
        if (typeof input === "string") {
          return { text: "", calls: [
            { name: "get_user_details", callId: "r1", arguments: "{}" },
            { name: "book_reservation", callId: "w1", arguments: "{}" },
          ] };
        }
        return { text: "denied", calls: [] };
      },
    },
    tools: new ToolRegistry(),
    turnCount: { n: 0 },
    permissionMode: "on-request",
    readOnlyTools: new Set(["get_user_details", "read_file"]),
    onEvent: (event) => events.push(event.msg.type),
    runTurn: async () => { throw new Error("runTurn should not run"); },
  };
  const allowed = await submit(host, {
    type: "external_step",
    input: "book it",
    tools: [
      { name: "get_user_details", parameters: { type: "object" } },
      { name: "book_reservation", parameters: { type: "object" } },
    ],
    permissionMode: "never",
  });
  assert.equal(allowed.ok, true);
  assert.deepEqual(host.externalResult?.calls.map((call) => call.name), ["get_user_details", "book_reservation"]);
  assert.equal(steps, 1);
  assert.ok(events.includes("turn_started"));
  assert.equal(events.filter((type) => type === "exec_command_begin").length, 2);

  events.length = 0;
  steps = 0;
  const gated = await submit(host, {
    type: "external_step",
    input: "book it",
    tools: [
      { name: "get_user_details", parameters: { type: "object" } },
      { name: "book_reservation", parameters: { type: "object" } },
    ],
  });
  assert.equal(gated.ok, true);
  assert.deepEqual(host.externalResult?.calls.map((call) => call.name), ["get_user_details"]);
  assert.equal(steps, 1);
  assert.ok(events.includes("exec_command_end"));
  assert.equal(events.includes("turn_complete"), false);
});
