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

For local Ollama, run `ollama pull qwen3:1.7b` and then `npm start`. Ollama is the default provider because it is the one provider that works without an API key. Providers live in a registry (currently `ollama` and `openai`); `ATHENA_PROVIDER` picks one at startup. In the TUI, `/model` shows the current model and lists the models the current provider can enumerate (Ollama lists installed local models; OpenAI does not support listing). `/model <provider> <name>` switches providers or models — for example `/model ollama <name>` or `/model openai <name>`. OpenAI selection requires `OPENAI_API_KEY` in the environment. Switching models starts a new conversation. Set `OLLAMA_HOST` to change the local endpoint; only loopback HTTP addresses are accepted.

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

---

# Athena（中文）

一个使用 OpenAI Responses API 的 TypeScript 终端聊天客户端，可以通过 stdio 连接 MCP 工具服务器。

核心是一个有步数上限的 ReAct 循环：每一步模型要么返回最终答案，要么请求工具调用；工具结果会送回模型进行下一步。TUI 会显示工具名称和执行状态。每次工具调用前，会要求你对确切的工具名和参数进行批准。批准仅对当前用户轮次有效；参数变更或下一轮都需要重新批准。只有输入 `y` 或 `yes` 才允许执行；拒绝和 EOF 均按拒绝处理。

## 运行

```sh
npm install
export OPENAI_API_KEY=your_key
npm start
```

用 `OPENAI_MODEL` 选择模型。输入 `/exit` 退出。

对于 DeepSeek 等兼容 Responses API 的服务，设置 `ATHENA_API_BASE_URL=https://api.deepseek.com`、`OPENAI_MODEL=deepseek-flash` 以及对应的 API key。

本地 Ollama：先 `ollama pull qwen3:1.7b`，再 `npm start`。Ollama 是默认 provider，因为它是唯一无需 API key 即可工作的 provider。provider 由注册表管理（当前为 `ollama` 和 `openai`）；启动时用 `ATHENA_PROVIDER` 选择。在 TUI 中，`/model` 显示当前模型并列出当前 provider 支持枚举的模型（Ollama 列出本地已安装模型；OpenAI 不支持列出）。`/model <provider> <name>` 切换 provider 或模型，例如 `/model ollama <name>` 或 `/model openai <name>`。选择 OpenAI 需要环境变量 `OPENAI_API_KEY`。切换模型会开始新对话。用 `OLLAMA_HOST` 修改本地端点；仅接受回环 HTTP 地址。

## 工作区

Athena 以当前目录作为工作区启动。用 `ATHENA_WORKSPACE` 指定其他起始目录。在 TUI 中，`/workspace` 显示当前根目录，`/workspace <目录>` 切换；相对路径基于当前根目录解析。`Workspace.resolveExisting` 会解析符号链接并拒绝根目录之外的路径。`Workspace.resolvePath` 只做词法检查，不得在打开文件前用作授权依据。

当前根目录会作为上下文随每次请求发送给模型。MCP 服务器在初始工作区目录中启动。工作区路径不是沙箱：切换工作区时已有的 MCP 服务器进程不会重启，仍可访问操作系统允许的路径。当前的轮次级批准门和后续设计见 `docs/permissions.md`。

## 内置文件工具

Athena 为当前工作区内的 UTF-8 文件注册 `read_file`、`write_file` 和 `edit_file`。`write_file` 默认创建新文件；替换已有文件需要提供 `read_file` 返回的 `sha256` 作为 `expectedSha256`。`edit_file` 精确替换一处 `oldText` 为 `newText`。每次操作上限 1 MiB。来自 TUI 的工具调用都要经过轮次级批准门。

## MCP 工具

将 `ATHENA_MCP_CONFIG` 设为 JSON 配置文件路径：

```json
{
  "mcpServers": {
    "example": { "command": "node", "args": ["/path/to/server.js"] }
  }
}
```

启动时 Athena 会发现服务器工具并注册为 `mcp_<server>_<tool>`。模型请求工具时，核心循环执行并把结果送回模型。请只配置可信的服务器命令。

## MCP 沙箱

在 macOS 上，每个 MCP 服务器进程都在 Seatbelt profile（`sandbox-exec`）下启动：无网络访问，写入仅限于工作区和临时目录，不能读取工作区外的用户文件（运行解释器所需的系统路径保持可读）。如果 `sandbox-exec` 不可用，服务器将以非沙箱方式启动。确实需要更多权限的服务器可以逐项声明退出沙箱：

```json
{ "mcpServers": { "example": { "command": "node", "args": ["server.js"], "sandbox": false } } }
```

沙箱是工具批准门之外的第二层防护：批准门控制模型可以请求什么，沙箱限制运行中的服务器进程自身能做什么。
