import { existsSync } from "node:fs";
import type { ModelControl, ReActEvent, TextIO, TextModel } from "../agent/core.ts";
import type { ToolRegistry, ToolSet } from "../agent/tools.ts";
import { Journal, findUnfinishedTurn } from "../session/journal.ts";
import { Sessions } from "../session/sessions.ts";
import type { Workspace } from "../workspace/workspace.ts";
import {
  DEFAULT_PERMISSION_MODE,
  decidePermission,
  parsePermissionMode,
  renderEvent,
  reviewFromLine,
  type Event,
  type EventMsg,
  type Op,
  type PermissionMode,
  type ReviewDecision,
} from "./wire.ts";

export {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODES,
  decidePermission,
  parsePermissionMode,
  renderEvent,
  reviewFromLine,
  type Event,
  type EventMsg,
  type Op,
  type PermissionMode,
  type ReviewDecision,
  type Submission,
} from "./wire.ts";

export const TURN_ABORTED_NOTICE =
  '<turn_aborted reason="process_exit">The previous turn was interrupted before completion. ' +
  "Do not automatically continue or repeat its actions, especially side-effecting ones. " +
  "Summarize what completed and ask the user how to proceed.</turn_aborted>";

export type Surface = "cli" | "tui";

export type OperationName = "help" | "prompt" | "permissions" | "model" | "workspace" | "sessions" | "session" | "new" | "exit";

export type Operation = {
  name: OperationName;
  /** Usage with a leading slash. The command line prints it without the slash. */
  usage: string;
  summary: string;
  surfaces: readonly Surface[];
};

/** The host operations. `exit` is interactive only; every other operation is shared. */
export const OPERATIONS: readonly Operation[] = [
  { name: "help", usage: "/help", summary: "List operations.", surfaces: ["cli", "tui"] },
  {
    name: "prompt",
    usage: "/prompt is any line that does not start with /",
    summary: "Send one message. The active permission mode decides which tool calls ask, run, or get no prompt.",
    surfaces: ["cli", "tui"],
  },
  {
    name: "permissions",
    usage: "/permissions [untrusted|on-request|never]",
    summary: "Show or set the permission mode. untrusted asks before every tool. on-request allows read-only tools and asks for the rest. never does not ask and allows the call.",
    surfaces: ["cli", "tui"],
  },
  { name: "model", usage: "/model [<provider>] [name]", summary: "Show the current model, or switch provider and model. Switching starts a new conversation.", surfaces: ["cli", "tui"] },
  { name: "workspace", usage: "/workspace [directory]", summary: "Show the workspace root, or switch to a directory.", surfaces: ["cli", "tui"] },
  { name: "sessions", usage: "/sessions", summary: "List sessions in the current workspace.", surfaces: ["cli", "tui"] },
  { name: "session", usage: "/session new | /session use <id>", summary: "Create a session or resume one by id.", surfaces: ["cli", "tui"] },
  { name: "new", usage: "/new", summary: "Start a new conversation.", surfaces: ["cli", "tui"] },
  { name: "exit", usage: "/exit", summary: "Leave the interactive session. /quit is the same command.", surfaces: ["tui"] },
];

export type CommandStatus = { effect: "continue" | "exit"; ok: boolean };

export type ProtocolHost = {
  surface: Surface;
  io: TextIO;
  model: TextModel;
  tools: ToolRegistry;
  workspace?: Workspace;
  models?: ModelControl;
  journal?: Journal;
  sessions?: Sessions;
  switchWorkspace?: (path: string) => Promise<void>;
  turnCount: { n: number };
  /** Session default. An individual user_input op may override it for one turn. */
  permissionMode?: PermissionMode;
  /** Lines the TUI can read while a turn is waiting. Absent means an ask is denied. */
  reviewLine?: () => Promise<string | undefined>;
  onEvent?: (event: Event) => void;
  pendingApprovals?: Map<string, (decision: ReviewDecision) => void>;
  abortTurn?: boolean;
  turnActive?: boolean;
  eventSeq?: { n: number };
  approvalSeq?: { n: number };
  /** Names `on-request` may allow. Defaults to the built-in read-only tools. */
  readOnlyTools?: ReadonlySet<string>;
  /** Filled by `external_step` with the calls the outside executor should run. */
  externalResult?: { text: string; calls: { name: string; callId: string; arguments: string }[] };
  runTurn(input: string, options: { approve?: (request: { tool: string; arguments: string }) => Promise<boolean>; onEvent?: (event: ReActEvent) => void }): Promise<string>;
};

export function sharedOperations(): Operation[] {
  return OPERATIONS.filter((operation) => operation.surfaces.includes("cli") && operation.surfaces.includes("tui"));
}

export function operationsFor(surface: Surface): Operation[] {
  return OPERATIONS.filter((operation) => operation.surfaces.includes(surface));
}

export function renderHelp(surface: Surface): string {
  const lines = ["Operations available to both the command line and the TUI:"];
  for (const operation of sharedOperations()) {
    lines.push(`  ${usageFor(operation, surface)}`, `    ${operation.summary}`);
  }
  const only = OPERATIONS.filter((operation) => operation.surfaces.length === 1 && operation.surfaces[0] === surface);
  if (only.length) {
    lines.push("", `${surface === "tui" ? "TUI" : "Command line"} only:`);
    for (const operation of only) lines.push(`  ${usageFor(operation, surface)}`, `    ${operation.summary}`);
  }
  return lines.join("\n") + "\n";
}

/** Parses a TUI slash line. A normal message returns undefined. */
export function parseSlash(input: string): { name: string; args: string[]; raw: string } | undefined {
  if (!input.startsWith("/")) return undefined;
  const name = input.slice(1).split(/\s+/, 1)[0] ?? "";
  if (!name) return { name: "", args: [], raw: input };
  const rest = input.slice(1 + name.length).trim();
  return { name: name === "quit" ? "exit" : name, args: rest ? rest.split(/\s+/) : [], raw: input };
}

/** Parses CLI argv. `--yes` is the `never` permission mode. No arguments means help. */
export function parseArgv(argv: string[]): { name: string; args: string[]; permissionMode?: PermissionMode } {
  const rest: string[] = [];
  let permissionMode: PermissionMode | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--yes") {
      if (permissionMode && permissionMode !== "never") throw new Error("Use either --yes or --permission-mode");
      permissionMode = "never";
      continue;
    }
    if (arg === "--permission-mode") {
      const value = argv[++index];
      const mode = parsePermissionMode(value);
      if (!mode) throw new Error(`Unknown permission mode: ${value ?? ""}. Available: ${PERMISSION_MODE_LIST}`);
      if (permissionMode && permissionMode !== mode) throw new Error("Use either --yes or --permission-mode");
      permissionMode = mode;
      continue;
    }
    rest.push(arg);
  }
  if (!rest.length) return { name: "help", args: [], permissionMode };
  return { name: rest[0] === "quit" ? "exit" : rest[0], args: rest.slice(1), permissionMode };
}

const PERMISSION_MODE_LIST = "untrusted, on-request, never";

export async function executeOperation(name: string, args: string[], host: ProtocolHost, raw = ""): Promise<CommandStatus> {
  const operation = OPERATIONS.find((item) => item.name === name);
  if (!operation) {
    host.io.write(`Unknown operation: ${name || raw}.\n${renderHelp(host.surface)}\n`);
    return { effect: "continue", ok: false };
  }
  if (!operation.surfaces.includes(host.surface)) {
    host.io.write(`${name} is available in the ${operation.surfaces.join(" and ")} only.\n`);
    return { effect: "continue", ok: false };
  }
  switch (operation.name) {
    case "help":
      host.io.write(`${renderHelp(host.surface)}\n`);
      return { effect: "continue", ok: true };
    case "exit":
      return { effect: "exit", ok: true };
    case "prompt":
      return submit(host, { type: "user_input", text: args.join(" ").trim() });
    case "permissions":
      return runPermissions(host, args);
    case "new":
      return runNew(host);
    case "model":
      return runModel(host, args);
    case "workspace":
      return runWorkspace(host, workspacePath(raw, args));
    case "sessions":
    case "session":
      return runSession(host, operation.name, args);
    default:
      return { effect: "continue", ok: false };
  }
}

/** Accepts one op and emits the event messages it causes. */
export async function submit(host: ProtocolHost, op: Op): Promise<CommandStatus> {
  const id = nextSubmissionId(host);
  const emit = (msg: EventMsg): void => {
    const event: Event = { id, msg };
    host.onEvent?.(event);
    const text = renderEvent(event);
    if (text) host.io.write(text);
  };
  switch (op.type) {
    case "user_input":
      return runUserInput(host, op, emit);
    case "external_step":
      return runExternalStep(host, op, emit);
    case "exec_approval":
      return resolveApproval(host, op, emit);
    case "interrupt":
      return interrupt(host, emit);
    case "configure_permission":
      host.permissionMode = op.permissionMode;
      emit({ type: "session_configured", permissionMode: op.permissionMode });
      return { effect: "continue", ok: true };
    case "show_permission":
      host.io.write(`Permission mode: ${currentMode(host)}\n\n`);
      return { effect: "continue", ok: true };
    case "help":
      host.io.write(`${renderHelp(host.surface)}\n`);
      return { effect: "continue", ok: true };
    case "shutdown":
      return { effect: "exit", ok: true };
    case "model":
      return runModel(host, op.args);
    case "workspace":
      return runWorkspace(host, op.path);
    case "sessions":
      return runSession(host, "sessions", []);
    case "session":
      return runSession(host, "session", op.args);
    case "new_conversation":
      return runNew(host);
    default:
      return { effect: "continue", ok: false };
  }
}

function runPermissions(host: ProtocolHost, args: string[]): Promise<CommandStatus> | CommandStatus {
  if (args.length === 0) return submit(host, { type: "show_permission" });
  const mode = parsePermissionMode(args[0]);
  if (!mode || args.length !== 1) {
    host.io.write(`Usage: ${slash(host.surface)}permissions [${PERMISSION_MODE_LIST}]\n\n`);
    return { effect: "continue", ok: false };
  }
  return submit(host, { type: "configure_permission", permissionMode: mode });
}

async function runUserInput(host: ProtocolHost, op: Extract<Op, { type: "user_input" }>, emit: (msg: EventMsg) => void): Promise<CommandStatus> {
  const text = op.text.trim();
  if (!text) {
    host.io.write(`Usage: ${usageFor(OPERATIONS.find((operation) => operation.name === "prompt")!, host.surface)}\n`);
    return { effect: "continue", ok: false };
  }
  const permissionMode = op.permissionMode ?? currentMode(host);
  const turnId = `turn-${++host.turnCount.n}`;
  host.turnActive = true;
  host.journal?.record({ type: "turn_start", turnId, ts: Date.now() });
  host.journal?.record({ type: "user", turnId, text });
  emit({ type: "turn_started", turnId, permissionMode });
  try {
    const answer = await host.runTurn(text, {
      approve: (request) => approveTool(host, permissionMode, request, emit),
      onEvent: (event) => {
        if (host.abortTurn) throw new Error("Turn interrupted");
        if (event.type === "action") emit({ type: "exec_command_begin", callId: event.callId, tool: event.tool });
        else if (event.type === "observation") emit({ type: "exec_command_end", callId: event.callId, tool: event.tool, ok: event.ok, output: event.output });
        if (event.type === "step") {
          host.journal?.record({ type: "assistant_step", turnId, text: event.text, calls: event.calls, responseId: event.responseId });
        } else if (event.type === "observation") {
          host.journal?.record({ type: "tool_result", turnId, callId: event.callId, ok: event.ok, output: event.output });
        }
      },
    });
    if (host.abortTurn) throw new Error("Turn interrupted");
    host.journal?.record({ type: "turn_end", turnId, answer, ts: Date.now() });
    emit({ type: "agent_message", message: answer });
    emit({ type: "turn_complete", turnId, message: answer });
    return { effect: "continue", ok: true };
  } catch (error) {
    if (host.abortTurn) {
      host.abortTurn = false;
      emit({ type: "turn_aborted", reason: "interrupt" });
      return { effect: "continue", ok: false };
    }
    emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
    return { effect: "continue", ok: false };
  } finally {
    host.turnActive = false;
  }
}

async function approveTool(host: ProtocolHost, mode: PermissionMode, request: { tool: string; arguments: string }, emit: (msg: EventMsg) => void): Promise<boolean> {
  if (host.abortTurn) throw new Error("Turn interrupted");
  if (decidePermission(mode, request.tool, host.readOnlyTools) === "allow") return true;
  if (!host.reviewLine) return false;
  const approvalId = `approval-${++(host.approvalSeq ??= { n: 0 }).n}`;
  emit({ type: "exec_approval_request", approvalId, tool: request.tool, arguments: request.arguments });
  const decision = await new Promise<ReviewDecision>((resolve) => {
    approvals(host).set(approvalId, resolve);
    void host.reviewLine!().then(
      (line) => { void submit(host, { type: "exec_approval", id: approvalId, decision: reviewFromLine(line) }); },
      () => { void submit(host, { type: "exec_approval", id: approvalId, decision: "denied" }); },
    );
  });
  if (decision === "abort" || host.abortTurn) throw new Error("Turn interrupted");
  return decision === "approved";
}

async function runExternalStep(host: ProtocolHost, op: Extract<Op, { type: "external_step" }>, emit: (msg: EventMsg) => void): Promise<CommandStatus> {
  if (typeof op.input === "string" && !op.input.trim()) {
    emit({ type: "error", message: "external_step requires input" });
    return { effect: "continue", ok: false };
  }
  host.externalResult = undefined;
  const permissionMode = op.permissionMode ?? currentMode(host);
  const tools: ToolSet = {
    definitions: op.tools,
    call: async () => { throw new Error("The benchmark owns tool execution"); },
  };
  const turnId = `turn-${++host.turnCount.n}`;
  host.turnActive = true;
  emit({ type: "turn_started", turnId, permissionMode });
  try {
    let next: string | { callId: string; output: string }[] = op.input;
    let text = "";
    const approved: { name: string; callId: string; arguments: string }[] = [];
    for (let step = 0; step < 4 && approved.length === 0; step++) {
      const result = await host.model.generate(next, tools);
      text = result.text;
      const denied: { callId: string; output: string }[] = [];
      const seen = new Set<string>();
      for (const call of result.calls) {
        if (!call.callId || seen.has(call.callId)) throw new Error("Duplicate or missing tool call ID");
        seen.add(call.callId);
        const allowed = await approveTool(host, permissionMode, { tool: call.name, arguments: call.arguments }, emit);
        if (!allowed) {
          const output = `Permission denied for ${call.name}`;
          denied.push({ callId: call.callId, output });
          emit({ type: "exec_command_end", callId: call.callId, tool: call.name, ok: false, output });
          continue;
        }
        emit({ type: "exec_command_begin", callId: call.callId, tool: call.name });
        approved.push(call);
      }
      if (approved.length > 0 || denied.length === 0) break;
      next = denied;
    }
    host.externalResult = { text, calls: approved };
    if (approved.length === 0) {
      emit({ type: "agent_message", message: text });
      emit({ type: "turn_complete", turnId, message: text });
    }
    return { effect: "continue", ok: true };
  } catch (error) {
    if (host.abortTurn) {
      host.abortTurn = false;
      emit({ type: "turn_aborted", reason: "interrupt" });
      return { effect: "continue", ok: false };
    }
    emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
    return { effect: "continue", ok: false };
  } finally {
    host.turnActive = false;
  }
}

function resolveApproval(host: ProtocolHost, op: Extract<Op, { type: "exec_approval" }>, emit: (msg: EventMsg) => void): CommandStatus {
  const resolve = approvals(host).get(op.id);
  if (!resolve) {
    emit({ type: "error", message: `No pending approval: ${op.id}` });
    return { effect: "continue", ok: false };
  }
  approvals(host).delete(op.id);
  resolve(op.decision);
  return { effect: "continue", ok: true };
}

function interrupt(host: ProtocolHost, emit: (msg: EventMsg) => void): CommandStatus {
  host.abortTurn = true;
  const waiting = approvals(host).size > 0;
  for (const [id, resolve] of approvals(host)) {
    approvals(host).delete(id);
    resolve("abort");
  }
  if (!waiting && !host.turnActive) {
    host.abortTurn = false;
    emit({ type: "turn_aborted", reason: "interrupt" });
  }
  return { effect: "continue", ok: true };
}

function currentMode(host: ProtocolHost): PermissionMode {
  return host.permissionMode ?? DEFAULT_PERMISSION_MODE;
}

function approvals(host: ProtocolHost): Map<string, (decision: ReviewDecision) => void> {
  return host.pendingApprovals ??= new Map();
}

function nextSubmissionId(host: ProtocolHost): string {
  const seq = host.eventSeq ??= { n: 0 };
  return `sub-${++seq.n}`;
}

export function startConversation(host: ProtocolHost): void {
  if (!host.journal) return;
  if (host.sessions && existsSync(host.journal.path) && Journal.load(host.journal.path).events.length) return;
  const [provider, name] = (host.models?.current ?? "unknown: unknown").split(": ");
  host.journal.record({ type: "conversation_start", provider, model: name, ts: Date.now() });
}

function rotateJournal(host: ProtocolHost): void {
  if (host.sessions && host.models && host.workspace) {
    const [provider, name] = host.models.current.split(": ");
    host.sessions.create(provider, name);
    host.journal = host.sessions.journal;
    startConversation(host);
    return;
  }
  if (!host.journal || !host.workspace) return;
  if (existsSync(host.journal.path)) host.journal.archive();
  host.journal = Journal.open(host.workspace.root, (message) => host.io.write(`Journal warning: ${message}\n`));
  startConversation(host);
}

async function restoreSession(host: ProtocolHost, id: string): Promise<void> {
  if (!host.sessions || !host.models?.restore) throw new Error("Session switching is unavailable");
  const info = host.sessions.get(id);
  const events = Journal.load(host.sessions.journalPath(id)).events;
  if (events.length) await host.models.restore(events, findUnfinishedTurn(events) ? TURN_ABORTED_NOTICE : "");
  else await host.models.select(info.provider, info.model);
  host.sessions.activate(id);
  host.journal = host.sessions.journal;
  startConversation(host);
}

function runNew(host: ProtocolHost): CommandStatus {
  const models = host.models;
  if (!models?.reset) {
    host.io.write("Starting a new conversation is unavailable.\n\n");
    return { effect: "continue", ok: false };
  }
  rotateJournal(host);
  models.reset();
  host.io.write("Started a new conversation.\n\n");
  return { effect: "continue", ok: true };
}

async function runModel(host: ProtocolHost, args: string[]): Promise<CommandStatus> {
  if (!host.models) {
    host.io.write("Model selection is unavailable.\n\n");
    return { effect: "continue", ok: false };
  }
  const ids = host.models.providerIds();
  const usage = `Usage: ${slash(host.surface)}model [<provider>] [name]\n\n`;
  try {
    if (args.length === 0) {
      host.io.write(`Current model: ${host.models.current}\n`);
      const available = await host.models.listModels();
      host.io.write(available.length ? `Available models: ${available.join(", ")}\n` : "(provider does not support listing)\n");
      host.io.write(`Switch with ${slash(host.surface)}model <provider> <name>. Providers: ${ids.join(", ")}.\n\n`);
      return { effect: "continue", ok: true };
    }
    if (ids.includes(args[0]) && args.length <= 2) {
      const selected = await host.models.select(args[0], args[1]);
      rotateJournal(host);
      host.io.write(`Model: ${selected} (new conversation)\n\n`);
      return { effect: "continue", ok: true };
    }
    const unknown = !ids.includes(args[0]) ? `Unknown provider: ${args[0]}. Available: ${ids.join(", ")}\n` : "";
    host.io.write(`${unknown}${usage}`);
    return { effect: "continue", ok: false };
  } catch (error) {
    host.io.write(`Model error: ${error instanceof Error ? error.message : String(error)}\n\n`);
    return { effect: "continue", ok: false };
  }
}

async function runWorkspace(host: ProtocolHost, path: string): Promise<CommandStatus> {
  if (!host.workspace) {
    host.io.write("No workspace is configured.\n\n");
    return { effect: "continue", ok: false };
  }
  try {
    if (path) {
      if (host.switchWorkspace) {
        await host.switchWorkspace(path);
        const [provider, name] = (host.models?.current ?? "unknown: unknown").split(": ");
        host.sessions = Sessions.open(host.workspace.root, provider, name);
        try {
          if (host.models?.restore) await restoreSession(host, host.sessions.active.id);
          else {
            host.models?.reset?.();
            host.journal = host.sessions.journal;
            startConversation(host);
          }
        } catch (error) {
          host.io.write(`Could not resume workspace session: ${error instanceof Error ? error.message : String(error)}. Started a new session.\n`);
          host.models?.reset?.();
          host.sessions.create(provider, name);
          host.journal = host.sessions.journal;
          startConversation(host);
        }
      } else {
        await host.workspace.switchTo(path);
        host.models?.reset?.();
        rotateJournal(host);
      }
    }
    host.io.write(`Workspace: ${host.workspace.root}\n\n`);
    return { effect: "continue", ok: true };
  } catch (error) {
    host.io.write(`Workspace error: ${error instanceof Error ? error.message : String(error)}\n\n`);
    return { effect: "continue", ok: false };
  }
}

async function runSession(host: ProtocolHost, name: "sessions" | "session", args: string[]): Promise<CommandStatus> {
  const usage = `Usage: ${slash(host.surface)}sessions | ${slash(host.surface)}session new | ${slash(host.surface)}session use <id>\n`;
  let ok = true;
  try {
    const sessions = host.sessions;
    if (!sessions) throw new Error("Sessions are unavailable");
    if (name === "sessions" && args.length > 0) {
      host.io.write(usage);
      ok = false;
    } else if (name === "sessions" || args.length === 0) {
      for (const info of sessions.list()) {
        host.io.write(`${info.id === sessions.active.id ? "*" : " "} ${info.id} ${info.provider}: ${info.model}\n`);
      }
    } else if (args[0] === "new" && args.length === 1) {
      host.models?.reset?.();
      rotateJournal(host);
      host.io.write(`Session: ${sessions.active.id}\n`);
    } else if (args[0] === "use" && args.length === 2) {
      await restoreSession(host, args[1]);
      host.io.write(`Session: ${sessions.active.id}\n`);
    } else {
      host.io.write(usage);
      ok = false;
    }
  } catch (error) {
    host.io.write(`Session error: ${error instanceof Error ? error.message : String(error)}\n`);
    ok = false;
  }
  host.io.write("\n");
  return { effect: "continue", ok };
}

function workspacePath(raw: string, args: string[]): string {
  if (raw.startsWith("/workspace")) return raw.slice("/workspace".length).trim();
  return args.join(" ");
}

function slash(surface: Surface): string {
  return surface === "tui" ? "/" : "";
}

function usageFor(operation: Operation, surface: Surface): string {
  if (operation.name === "prompt" && surface === "cli") return "prompt [--permission-mode <mode>] [--yes] <text>";
  if (operation.name === "prompt") return "(a line that does not start with /)";
  return surface === "tui" ? operation.usage : operation.usage.replaceAll("/", "");
}
