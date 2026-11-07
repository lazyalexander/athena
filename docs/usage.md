**English** | [中文](usage.zh.md)

# Usage

The core uses a bounded ReAct loop: each model step either returns a final answer or requests tools; tool observations are sent back for the next step. Every `runTurn` creates a fresh authorization gate and denies tool calls by default. The TUI supplies an interactive approval callback and shows tool names and success status. Approval lasts for the current user turn only; a changed call or the next turn requires fresh approval. Only `y` or `yes` allows execution; denial and EOF fail closed.

## Providers and models

Set `OPENAI_MODEL` to choose a model.

Ollama is the default provider because it is the one provider that works without an API key. Providers live in a registry (currently `ollama`, `openai`, and `deepseek`); `ATHENA_PROVIDER` picks one at startup. Each provider reads its own key: `OPENAI_API_KEY` for OpenAI, `DEEPSEEK_API_KEY` for DeepSeek (with `DEEPSEEK_MODEL` to choose its model, default `deepseek-chat`). In the TUI, `/model` shows the current model and lists the models the current provider can enumerate (Ollama lists installed local models; OpenAI and DeepSeek do not support listing). `/model <provider> <name>` switches providers or models — for example `/model ollama <name>` or `/model deepseek <name>`. Switching models starts a new conversation. Set `OLLAMA_HOST` to change the local endpoint; only loopback HTTP addresses are accepted.

DeepSeek's Responses API is stateless, so Athena sends the full conversation and tool history on every request. OpenAI uses response IDs to continue its server-side conversation.

For another compatible Responses API, set `ATHENA_API_BASE_URL` and pick the model with `OPENAI_MODEL` along with that provider's key in `OPENAI_API_KEY`.

## Workspace

Athena starts with the current directory as its workspace. Set `ATHENA_WORKSPACE` to choose another starting directory. In the TUI, `/workspace` shows the current root and `/workspace <directory>` switches it; relative paths are resolved from the current root. `Workspace.resolveExisting` resolves symlinks and rejects paths outside the root. `Workspace.resolvePath` checks only the lexical path and must not be used as an authorization decision before opening a file.

The workspace is the shared file boundary for its sessions. The current root is sent to the model on each request. When the TUI changes workspaces, it starts a fresh MCP connection in the selected root, replaces the available MCP tools, and opens that workspace's active session. On macOS, sandboxed MCP servers can read user files only inside that root. A server configured with `sandbox: false`, or a platform without `sandbox-exec`, is not confined by this process sandbox. See `permissions.md` for the turn-level approval gate.

## Session recovery

Each workspace can hold multiple sessions under `.athena/sessions/<id>/`. Each session folder contains `session.json` (model selection) and `journal.jsonl` (conversation events); `.athena/sessions/active` selects that workspace's default session. `/sessions` lists them, `/session new` (or `/new`) creates one, and `/session use <id>` resumes one. `/model <provider> <name>` starts a new session with that model. `/workspace <directory>` opens that workspace's active session; switching back resumes it. Sessions survive normal exits and restarts. An old `.athena/journal.jsonl` or flat session layout is imported automatically.

If a process dies mid-turn, resuming that session injects a `<turn_aborted>` notice telling the model not to repeat actions. Side effects are not replayed. Restoration needs the same provider configuration (API key or reachable Ollama host); on failure Athena reports the error and starts a new session. Add `.athena/` to the project's `.gitignore` so journals stay out of version control.

## Built-in file tools

Athena registers `read_file`, `write_file`, and `edit_file` for UTF-8 files in the current workspace. `write_file` creates a new file by default; replacing an existing file requires the `sha256` returned by `read_file` as `expectedSha256`. `edit_file` replaces exactly one occurrence of `oldText` with `newText`. Each operation is limited to 1 MiB. Tool calls from the TUI pass through the turn-level approval gate.

## Application knowledge and facts

Set `ATHENA_KNOWLEDGE_DIR` to a directory inside the workspace containing application-owned Markdown documents, for example `knowledge`. Athena then registers `search_knowledge(query)`, which returns matching excerpts with their source filename and SHA-256 revision. It searches at most 32 Markdown files of up to 128 KiB each and returns up to five excerpts. The directory is resolved within the active workspace on each call, so switching workspaces also switches the knowledge source. The application owns document content and version control; Athena does not encode its rules.

The model is instructed to look up relevant rules, get changing facts through tools, and check them before state-changing calls. The built-in `elapsed_time(start, end)` tool calculates exact time differences from ISO 8601 timestamps with explicit offsets; it does not decide business eligibility. This is decision guidance, not an enforcement guarantee. A tool owner can attach `beforeExecute` for authoritative pre-execution checks; see `permissions.md`. Benchmark adapters remain separate and do not use workspace knowledge or business checks by default.

## MCP tools

Set `ATHENA_MCP_CONFIG` to the path of a JSON configuration file:

```json
{
  "mcpServers": {
    "example": { "command": "node", "args": ["/path/to/server.js"] }
  }
}
```

At startup, Athena discovers server tools and registers them as `mcp_<server>_<tool>`. When the model requests a tool, the core loop executes it and passes the result back to the model. Configure only trusted server commands.

## MCP sandbox

On macOS, each MCP server process is launched under a Seatbelt profile (`sandbox-exec`): no network access, writes confined to the workspace and temp directories, and no reads of user files outside the workspace (system paths needed to run interpreters stay readable). If `sandbox-exec` is unavailable the server starts unsandboxed. A server that genuinely needs more access can opt out per entry:

```json
{ "mcpServers": { "example": { "command": "node", "args": ["server.js"], "sandbox": false } } }
```

The sandbox is a second layer next to the tool approval gate: the gate controls what the model may request, the sandbox limits what a running server process can do on its own.
