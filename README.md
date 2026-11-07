**English** | [中文](README.zh.md)

# Athena

A TypeScript terminal chat client using the OpenAI Responses API. It can connect to MCP tool servers over stdio and keeps tool use under a per-turn approval gate.

## Run

```sh
npm install
export OPENAI_API_KEY=your_key
npm start
```

For local models with Ollama, run `ollama pull qwen3:1.7b` first — no API key needed. Type `/exit` to quit.

## Documentation

- [Usage: providers, workspace, file tools, MCP, sandbox](docs/usage.md)
- [Protocol: operations shared by the command line and the TUI](docs/protocol.md)
- [Permission system](docs/permissions.md)
- [Application knowledge and action decisions](docs/knowledge-design.md)

## Source layout

- `src/agent/`: ReAct loop, tool registry, and turn approval.
- `src/session/`: session identity, journal, and recovery.
- `src/workspace/`: workspace paths, file tools, and process sandbox.
- `src/providers/`: LLM provider layer. Every model connection enters through `createProviderLayer`.
- `src/protocol/`: operations shared by the command line and the TUI.
- `src/cli.ts`: one-shot command line. `src/tui.ts`: interactive session. Both open `src/app.ts`.
- `src/mcp/`: MCP client integration.
- `src/knowledge/`: optional workspace document search.

