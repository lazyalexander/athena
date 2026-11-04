**[English](usage.md)** | 中文

# 使用说明

核心是一个有步数上限的 ReAct 循环：每一步模型要么返回最终答案，要么请求工具调用；工具结果会送回模型进行下一步。TUI 会显示工具名称和执行状态。每次工具调用前，会要求你对确切的工具名和参数进行批准。批准仅对当前用户轮次有效；参数变更或下一轮都需要重新批准。只有输入 `y` 或 `yes` 才允许执行；拒绝和 EOF 均按拒绝处理。

## Provider 与模型

用 `OPENAI_MODEL` 选择模型。

对于 DeepSeek 等兼容 Responses API 的服务，设置 `ATHENA_API_BASE_URL=https://api.deepseek.com`、`OPENAI_MODEL=deepseek-flash` 以及对应的 API key。

Ollama 是默认 provider，因为它是唯一无需 API key 即可工作的 provider。provider 由注册表管理（当前为 `ollama` 和 `openai`）；启动时用 `ATHENA_PROVIDER` 选择。在 TUI 中，`/model` 显示当前模型并列出当前 provider 支持枚举的模型（Ollama 列出本地已安装模型；OpenAI 不支持列出）。`/model <provider> <name>` 切换 provider 或模型，例如 `/model ollama <name>` 或 `/model openai <name>`。选择 OpenAI 需要环境变量 `OPENAI_API_KEY`。切换模型会开始新对话。用 `OLLAMA_HOST` 修改本地端点；仅接受回环 HTTP 地址。

## 工作区

Athena 以当前目录作为工作区启动。用 `ATHENA_WORKSPACE` 指定其他起始目录。在 TUI 中，`/workspace` 显示当前根目录，`/workspace <目录>` 切换；相对路径基于当前根目录解析。`Workspace.resolveExisting` 会解析符号链接并拒绝根目录之外的路径。`Workspace.resolvePath` 只做词法检查，不得在打开文件前用作授权依据。

当前根目录会作为上下文随每次请求发送给模型。MCP 服务器在初始工作区目录中启动。工作区路径不是沙箱：切换工作区时已有的 MCP 服务器进程不会重启，仍可访问操作系统允许的路径。当前的轮次级批准门和后续设计见 `permissions.md`（[中文](permissions.zh.md)）。

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
