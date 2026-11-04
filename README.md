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
- [Permission system](docs/permissions.md)
