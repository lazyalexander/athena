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
- [权限系统](docs/permissions.zh.md)
