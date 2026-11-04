**English** | [中文](permissions.zh.md)

# Permission system

Status: the TUI has a turn-scoped, exact-call approval gate. The rest of this document records possible extensions. MCP servers do not enforce these host permissions.

## Implemented turn scope

Each user message creates a fresh `TurnToolSet`. Before dispatch, it prompts for the exact tool name and JSON arguments. Only `y` or `yes` approves. The same call may repeat within that turn without another prompt. A changed argument, another tool, or the next user message requires a new decision. Denials are cached for that turn. EOF denies. Unknown tools are rejected before prompting. The gate is cleared when the turn finishes or fails. The model receives a tool error on denial and may continue without that tool.

This gate applies to calls through the TUI's `runCore` path. Direct library use of `runTurn` with a raw `ToolRegistry` does not automatically apply it. Approval is in memory only; there are no persistent grants, audit receipts, or mid-call cancellation yet.

## Boundary and owner

The Athena host owns grants and decisions. The model may request a tool call, but may not grant itself access or interpret a denial as permission to retry with broader arguments. MCP tool descriptions and results are untrusted input. A server's process can still act outside Athena's tool gate, so launching a server and passing it environment variables require a separate trust decision.

The current gate covers calls made through the TUI's wrapped `ToolRegistry`. It does not cover model requests, local terminal input, or actions a running MCP server performs independently.

## Future permission identity

Do not authorize by the model-facing name alone. A permission target has a stable identity: `{serverId, toolName, capability, resource}`. `serverId` comes from the host configuration, not the tool description. `capability` is one of `read`, `write`, `execute`, `network`, or `unknown`; the host assigns it in configuration. `resource` is a canonical path, origin, or other host-defined scope when the tool supports one. An unclassified tool is `unknown` and requires per-call approval.

Each grant records `grantId`, target, scope, issuer, creation time, expiry, and a monotonically increasing policy revision. Scope is one of:

| Scope | Lifetime | Use |
| --- | --- | --- |
| `once` | One matching invocation | Default interactive approval |
| `session` | Current Athena process | Repeated calls in one conversation |
| `persistent` | Until expiry or revocation | Explicitly trusted, narrowly scoped work |

Grants never implicitly include a different server, tool, capability, or broader resource. `read` does not imply `write`. A new tool name or changed server identity needs a new decision.

## Decision flow

1. The model returns a tool request. Athena parses and validates its JSON arguments.
2. The host resolves the request to a registered tool identity and canonical resource. Resolution failure denies the call.
3. The permission gate evaluates explicit deny rules first, then active grants. An expired or revoked grant is unavailable.
4. If no grant matches, pause that call and show the user the server, tool, capability, concrete arguments, resource, and proposed scope. The default choice is deny. Do not send a tool result until the user decides.
5. If approved, mint a grant and execute only the request that was reviewed. For `once`, consume the grant atomically before execution.
6. Record a receipt with request ID, grant ID or denial reason, policy revision, start/end time, and outcome. Return a concise tool result or denial to the model.

The gate runs immediately before `Tool.execute`, even when the model has already seen a tool definition. A cached model response or changed arguments never bypasses this check. Parallel tool requests are evaluated independently.

## Grant, escalation, and revocation

**Grant:** The user may approve `once`, `session`, or `persistent` for the exact target and resource shown. Persistent grants require an explicit expiry and are stored in a user-owned local policy file with restricted access. No model text or MCP response can create a grant.

**Escalation:** A call outside the current grant is a new request. Show the old and proposed capability/resource scope, the reason the existing grant does not match, and the exact pending call. Approval creates a new grant; it never edits the old grant in place. For a first implementation, allow escalation only from `once` to `session` for the same exact target; defer broader resources and persistent escalation until resource canonicalization exists.

**Revocation:** The user can revoke a grant by ID, target, or all grants for a server. Increment the policy revision immediately. New calls fail closed. Queued calls must recheck immediately before execution. Calls already running cannot generally be undone; abort them when the tool supports cancellation and report otherwise. Revocation does not erase receipts or guarantee rollback of external effects.

## Proposed interfaces

```ts
type Decision =
  | { kind: "allow"; grantId: string; policyRevision: number }
  | { kind: "deny"; reason: string }
  | { kind: "ask"; request: PermissionRequest };

interface PermissionGate {
  evaluate(request: PermissionRequest): Promise<Decision>;
  authorize(request: PermissionRequest, decision: Decision): Promise<void>;
  grant(request: PermissionRequest, scope: "once" | "session" | "persistent", expiresAt?: string): Promise<Grant>;
  revoke(grantId: string): Promise<void>;
}
```

`PermissionRequest` should carry a unique call ID, stable tool identity, parsed arguments, canonical resource, and a digest of the exact call. `authorize` rechecks the digest and current policy revision directly before execution. The host should own a `GuardedToolSet` wrapper around `ToolRegistry`; neither the OpenAI adapter nor MCP adapter should contain approval logic.

## TUI behavior

The approval prompt is a host control, separate from chat input. It displays the exact pending call and accepts `deny`, `once`, or `session`; later, `persistent` becomes available for supported resource scopes. The TUI should expose `/permissions` to list grants and `/revoke <grantId>` to revoke one. A denial is returned to the model as a tool result so it can continue without that capability. No approval is inferred from silence, EOF, or a model message.

## Delivery order and acceptance

1. Add identity and host-assigned capability metadata to tools. Unknown capability remains per-call only.
2. Add `GuardedToolSet` with deny by default, one-time grants, exact-call digest checks, and receipts. Test that a changed argument or unknown tool cannot reuse a grant.
3. Add a TUI approval prompt and session grants. Test two parallel calls with different arguments and deny/EOF behavior.
4. Add persistent grants and revocation after canonical resource scopes and file permissions are specified. Test expiry, queued-call rechecks, and server-wide revocation.

The first milestone is complete when an unapproved MCP tool call cannot reach `client.callTool`, an approved exact call can, and a denied call returns a clear result to the model.
