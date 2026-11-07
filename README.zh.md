**[English](README.md)** | 中文

# Athena

一个使用 OpenAI Responses API 的 TypeScript 终端聊天客户端，可以通过 stdio 连接 MCP 工具服务器，工具调用受逐轮批准门控制。

## 运行

```sh
npm install
export OPENAI_API_KEY=your_key
npm start
```

本地模型用 Ollama：先 `ollama pull qwen3:1.7b`，无需 API key。输入 `/exit` 退出。

## 文档

- [使用说明：provider、工作区、文件工具、MCP、沙箱](docs/usage.zh.md)
- [协议：命令行和 TUI 都能做的操作](docs/protocol.zh.md)
- [权限系统](docs/permissions.zh.md)
- [应用知识与动作决策](docs/knowledge-design.zh.md)

## 源码目录

- `src/agent/`：ReAct 循环、工具注册和逐轮批准。
- `src/session/`：会话身份、日志与恢复。
- `src/workspace/`：工作区路径、文件工具和进程沙箱。
- `src/providers/`：LLM provider 层。所有模型连接都从 `createProviderLayer` 进入。
- `src/protocol/`：命令行和 TUI 共用的操作。
- `src/cli.ts`：一次性命令行。`src/tui.ts`：交互会话。两者都打开 `src/app.ts`。
- `src/mcp/`：MCP 客户端接入。
- `src/knowledge/`：可选的工作区文档检索。

