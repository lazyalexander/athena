**[English](usage.md)** | 中文

# 使用说明

核心是一个有步数上限的 ReAct 循环：每一步模型要么返回最终答案，要么请求工具调用；工具结果会送回模型进行下一步。TUI 会显示工具名称和执行状态。每次工具调用前，会要求你对确切的工具名和参数进行批准。批准仅对当前用户轮次有效；参数变更或下一轮都需要重新批准。只有输入 `y` 或 `yes` 才允许执行；拒绝和 EOF 均按拒绝处理。

## Provider 与模型

用 `OPENAI_MODEL` 选择模型。

Ollama 是默认 provider，因为它是唯一无需 API key 即可工作的 provider。provider 由注册表管理（当前为 `ollama`、`openai` 和 `deepseek`）；启动时用 `ATHENA_PROVIDER` 选择。每个 provider 读自己的 key：OpenAI 用 `OPENAI_API_KEY`，DeepSeek 用 `DEEPSEEK_API_KEY`（用 `DEEPSEEK_MODEL` 选择模型，默认 `deepseek-chat`）。在 TUI 中，`/model` 显示当前模型并列出当前 provider 支持枚举的模型（Ollama 列出本地已安装模型；OpenAI 和 DeepSeek 不支持列出）。`/model <provider> <name>` 切换 provider 或模型，例如 `/model ollama <name>` 或 `/model deepseek <name>`。切换模型会开始新对话。用 `OLLAMA_HOST` 修改本地端点；仅接受回环 HTTP 地址。

对于其他兼容 Responses API 的服务，设置 `ATHENA_API_BASE_URL`，用 `OPENAI_MODEL` 选择模型，并把该服务的 key 放进 `OPENAI_API_KEY`。

## 工作区

Athena 以当前目录作为工作区启动。用 `ATHENA_WORKSPACE` 指定其他起始目录。在 TUI 中，`/workspace` 显示当前根目录，`/workspace <目录>` 切换；相对路径基于当前根目录解析。`Workspace.resolveExisting` 会解析符号链接并拒绝根目录之外的路径。`Workspace.resolvePath` 只做词法检查，不得在打开文件前用作授权依据。

工作区是其多个会话共享文件的边界。当前根目录会作为上下文随每次请求发送给模型。TUI 切换工作区时会在新目录重启 MCP 连接、替换工具，并打开该工作区的活动会话。在 macOS 上，启用沙箱的 MCP 服务器只能读取新工作区内的用户文件；配置 `sandbox: false` 或系统缺少 `sandbox-exec` 时没有这层进程隔离。轮次级批准门见 `permissions.md`（[中文](permissions.zh.md)）。

## 会话恢复

每个工作区可在 `.athena/sessions/<id>/` 下保存多个会话。每个会话目录包含 `session.json`（模型选择）和 `journal.jsonl`（对话事件）；`.athena/sessions/active` 指向该工作区默认打开的会话。`/sessions` 列出会话；`/session new`（或 `/new`）创建会话；`/session use <id>` 恢复会话。`/model <provider> <name>` 用所选模型创建新会话。`/workspace <目录>` 打开该工作区的活动会话，切回来仍可继续。正常退出和重启后会话也会保留。旧 `.athena/journal.jsonl` 及平铺会话文件会自动导入。

若进程在一轮中途退出，恢复该会话时会注入 `<turn_aborted>` 标记，提醒模型不要重复操作；工具副作用不会重放。恢复需要原 provider 的可用配置（API key 或可连接的 Ollama 服务）；失败时会报告错误并创建新会话。建议把 `.athena/` 加入项目的 `.gitignore`。

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
