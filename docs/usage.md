**English** | [中文](usage.zh.md)

# Usage

The core uses a bounded ReAct loop: each model step either returns a final answer or requests tools; tool observations are sent back for the next step. The TUI shows tool names and success status. Before a tool call, it asks for approval of the exact tool name and arguments. Approval lasts for the current user turn only; a changed call or the next turn requires fresh approval. Only `y` or `yes` allows execution; denial and EOF fail closed.

## Providers and models

Set `OPENAI_MODEL` to choose a model.

Ollama is the default provider because it is the one provider that works without an API key. Providers live in a registry (currently `ollama`, `openai`, and `deepseek`); `ATHENA_PROVIDER` picks one at startup. Each provider reads its own key: `OPENAI_API_KEY` for OpenAI, `DEEPSEEK_API_KEY` for DeepSeek (with `DEEPSEEK_MODEL` to choose its model, default `deepseek-chat`). In the TUI, `/model` shows the current model and lists the models the current provider can enumerate (Ollama lists installed local models; OpenAI and DeepSeek do not support listing). `/model <provider> <name>` switches providers or models — for example `/model ollama <name>` or `/model deepseek <name>`. Switching models starts a new conversation. Set `OLLAMA_HOST` to change the local endpoint; only loopback HTTP addresses are accepted.

For another compatible Responses API, set `ATHENA_API_BASE_URL` and pick the model with `OPENAI_MODEL` along with that provider's key in `OPENAI_API_KEY`.

## Workspace

Athena starts with the current directory as its workspace. Set `ATHENA_WORKSPACE` to choose another starting directory. In the TUI, `/workspace` shows the current root and `/workspace <directory>` switches it; relative paths are resolved from the current root. `Workspace.resolveExisting` resolves symlinks and rejects paths outside the root. `Workspace.resolvePath` checks only the lexical path and must not be used as an authorization decision before opening a file.

The current root is sent to the model as context on each request. MCP servers start in the initial workspace directory. The workspace path is not a sandbox: existing MCP server processes are not restarted when the workspace changes and can still access paths allowed by the operating system. See `permissions.md` for the current turn-level gate and remaining design work.

## Session recovery

Athena appends session events (turns, model steps, tool results) to `.athena/journal.jsonl` in the workspace. If the process dies mid-turn, the next startup archives the old log, restores the conversation into the model, and injects a `<turn_aborted>` notice telling the model the last turn was interrupted and must not be repeated — side effects like pushes or file writes are not replayed. Restoration needs the same provider configuration as before the crash (API key, reachable Ollama host); if it fails, Athena prints the reason and starts fresh. `/new` discards the current session and starts a new conversation; switching models or workspaces does the same. Add `.athena/` to your project's `.gitignore` so session logs stay out of version control.

## Built-in file tools

Athena registers `read_file`, `write_file`, and `edit_file` for UTF-8 files in the current workspace. `write_file` creates a new file by default; replacing an existing file requires the `sha256` returned by `read_file` as `expectedSha256`. `edit_file` replaces exactly one occurrence of `oldText` with `newText`. Each operation is limited to 1 MiB. Tool calls from the TUI pass through the turn-level approval gate.

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
