# Athena

A TypeScript terminal chat client using the OpenAI Responses API. It can connect to MCP tool servers over stdio.

## Run

```sh
npm install
export OPENAI_API_KEY=your_key
npm start
```

Set `OPENAI_MODEL` to choose a model. Type `/exit` to quit.

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
