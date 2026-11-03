# Athena

一个 TypeScript 终端对话入口，使用 OpenAI Responses API，并可通过 stdio 连接 MCP 工具服务器。

## 运行

```sh
npm install
export OPENAI_API_KEY=your_key
npm start
```

可用 `OPENAI_MODEL` 指定模型。输入 `/exit` 退出。

## MCP 工具

将 `ATHENA_MCP_CONFIG` 设为 JSON 配置文件路径：

```json
{
  "mcpServers": {
    "example": { "command": "node", "args": ["/path/to/server.js"] }
  }
}
```

启动时会发现服务器工具并注册为 `mcp_<server>_<tool>`。模型发起工具调用后，Athena 核心循环执行工具并把结果传回模型。服务器命令由配置决定，应只配置可信程序。
