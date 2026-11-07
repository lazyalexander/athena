/** Codex-style submission and event messages for one Athena session. */

export const PERMISSION_MODES = ["untrusted", "on-request", "never"] as const;

/** When a tool call may run without a person answering. Passed on an op or stored for the session. */
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const DEFAULT_PERMISSION_MODE: PermissionMode = "untrusted";

/** Read-only tools that `on-request` may run without asking. Everything else asks. */
export const READ_ONLY_TOOLS = new Set(["read_file", "search_knowledge", "elapsed_time"]);

export type ReviewDecision = "approved" | "denied" | "abort";

export type PermissionGate = "allow" | "ask";

export type Op =
  | { type: "user_input"; text: string; permissionMode?: PermissionMode }
  | { type: "exec_approval"; id: string; decision: ReviewDecision }
  | { type: "interrupt" }
  | { type: "configure_permission"; permissionMode: PermissionMode }
  | { type: "show_permission" }
  | { type: "help" }
  | { type: "model"; args: string[] }
  | { type: "workspace"; path: string }
  | { type: "sessions" }
  | { type: "session"; args: string[] }
  | { type: "new_conversation" }
  | { type: "shutdown" };

/** One client submission. `id` is copied onto every event it causes. */
export type Submission = { id: string; op: Op };

export type EventMsg =
  | { type: "error"; message: string }
  | { type: "session_configured"; permissionMode: PermissionMode }
  | { type: "turn_started"; turnId: string; permissionMode: PermissionMode }
  | { type: "agent_message"; message: string }
  | { type: "exec_approval_request"; approvalId: string; tool: string; arguments: string }
  | { type: "exec_command_begin"; callId: string; tool: string }
  | { type: "exec_command_end"; callId: string; tool: string; ok: boolean; output: string }
  | { type: "turn_complete"; turnId: string; message: string }
  | { type: "turn_aborted"; reason: "interrupt" };

/** One event-queue item. `id` is the submission that produced it. */
export type Event = { id: string; msg: EventMsg };

export function parsePermissionMode(value: string | undefined): PermissionMode | undefined {
  if (value === "untrusted" || value === "on-request" || value === "never") return value;
  return undefined;
}

/** `never` allows the call. `on-request` allows read-only tools. `untrusted` always asks. */
export function decidePermission(mode: PermissionMode, tool: string): PermissionGate {
  if (mode === "never") return "allow";
  if (mode === "on-request" && READ_ONLY_TOOLS.has(tool)) return "allow";
  return "ask";
}

/** A missing line, EOF, or any answer other than yes is a denial. `abort` stops the turn. */
export function reviewFromLine(line: string | undefined): ReviewDecision {
  if (line === undefined) return "denied";
  const text = line.trim().toLowerCase();
  if (text === "y" || text === "yes") return "approved";
  if (text === "abort") return "abort";
  return "denied";
}

/** Human text for the surfaces. Events with no line stay on the queue only. */
export function renderEvent(event: Event): string {
  const msg = event.msg;
  switch (msg.type) {
    case "exec_approval_request":
      return `Allow ${msg.tool} ${msg.arguments} for this turn? [y/N] `;
    case "exec_command_begin":
      return `  → ${msg.tool}\n`;
    case "exec_command_end":
      return `  ← ${msg.tool}: ${msg.ok ? "ok" : "error"}\n`;
    case "turn_complete":
      return `athena> ${msg.message}\n\n`;
    case "error":
      return `Request failed: ${msg.message}\n\n`;
    case "session_configured":
      return `Permission mode: ${msg.permissionMode}\n\n`;
    case "turn_aborted":
      return "Turn interrupted.\n\n";
    default:
      return "";
  }
}
