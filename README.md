# Athena

A TypeScript terminal chat client using the OpenAI Responses API. It can connect to MCP tool servers over stdio.

The core uses a bounded ReAct loop: each model step either returns a final answer or requests tools; tool observations are sent back for the next step. The TUI shows tool names and success status. Before a tool call, it asks for approval of the exact tool name and arguments. Approval lasts for the current user turn only; a changed call or the next turn requires fresh approval. Only `y` or `yes` allows execution; denial and EOF fail closed.

## Run

```sh
npm install
export OPENAI_API_KEY=your_key
npm start
```

Set `OPENAI_MODEL` to choose a model. Type `/exit` to quit.

For a compatible Responses API such as DeepSeek, set `ATHENA_API_BASE_URL=https://api.deepseek.com` and `OPENAI_MODEL=deepseek-flash` along with that provider's API key.

For local Ollama, run `ollama pull qwen3:1.7b` and then `npm start`. Ollama is the default provider and needs no API key. In the TUI, `/model` lists installed local models, `/model ollama <name>` switches local models, and `/model openai <name>` switches to an OpenAI or compatible Responses API model. OpenAI selection requires `OPENAI_API_KEY` in the environment. Switching models starts a new conversation. Set `OLLAMA_HOST` to change the local endpoint; only loopback HTTP addresses are accepted.

## Workspace

Athena starts with the current directory as its workspace. Set `ATHENA_WORKSPACE` to choose another starting directory. In the TUI, `/workspace` shows the current root and `/workspace <directory>` switches it; relative paths are resolved from the current root. `Workspace.resolveExisting` resolves symlinks and rejects paths outside the root. `Workspace.resolvePath` checks only the lexical path and must not be used as an authorization decision before opening a file.

The current root is sent to the model as context on each request. MCP servers start in the initial workspace directory. The workspace path is not a sandbox: existing MCP server processes are not restarted when the workspace changes and can still access paths allowed by the operating system. See `docs/permissions.md` for the current turn-level gate and remaining design work.

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
