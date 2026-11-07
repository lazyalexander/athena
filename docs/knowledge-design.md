**English** | [中文](knowledge-design.zh.md)

# Application knowledge and action decisions

## Goal and boundaries

Athena is a general agent harness. The workspace is the shared file and permission boundary; sessions keep independent conversation and model state. Applications own their policies and changing business data. Athena supplies reusable mechanisms for finding relevant text, obtaining tool observations, calculating time intervals, and checking a tool call immediately before execution. No airline rule belongs in `src/agent/` or the benchmark adapter.

## Three layers

| Layer | Owner | Current mechanism | Limit |
| --- | --- | --- | --- |
| Knowledge | Application or plugin | Opt-in `ATHENA_KNOWLEDGE_DIR` and `search_knowledge(query)` return excerpts, filename, and SHA-256 document revision | Lexical matching; the model must choose to search and interpret the passage |
| Facts | Application or plugin tools | Existing `ToolRegistry` and MCP tools return live observations | Tool owners determine freshness and authority |
| Decision and execution | Model, then tool owner | Generic model instruction asks for rule and fact checks; `elapsed_time` computes exact intervals; optional `beforeExecute` blocks an invalid call | Prompting does not guarantee correct reasoning; a check can only enforce rules its owner implements |

The TUI's turn approval remains separate from business eligibility. Approval does not bypass `beforeExecute`, which runs on every `ToolRegistry.call`. A denied or failed check prevents `execute`. Applications must use authoritative state and an appropriate clock for their own checks; `examples/booking-window.ts` illustrates only one condition, not a complete cancellation policy.

## Data flow

1. The application puts version-controlled Markdown in a directory inside the active workspace and sets `ATHENA_KNOWLEDGE_DIR` to that directory. This is optional; no domain knowledge is loaded by default.
2. The model searches relevant text and obtains changing facts with domain tools. Knowledge results are source text, not executable instructions or proof that a current fact is true. Its source revision lets a trace identify the text returned.
3. Before a state-changing action, the model checks the applicable rule against observed facts and uses `elapsed_time` for timestamp limits when available. The tool owner may perform an authoritative `beforeExecute` check immediately before its operation. The model sees a tool error on denial and can explain or take another path.

`elapsed_time` requires ISO 8601 timestamps with explicit UTC offsets and returns elapsed seconds and hours. It makes no eligibility decision. The 2024-05-14 09:52:38−05:00 to 2024-05-15 15:00:00−05:00 case is 104,842 seconds, about 29.12 hours.

## Evaluation and delivery plan

- **Implemented:** generic pre-execution hook, workspace knowledge search, time calculation, model guidance, and tests for repeat approval, denied/failed checks, source boundaries, and offset-aware arithmetic. `runTurn` now creates a fresh authorization gate for every entry path and denies tool calls by default unless its host supplies approval.
- **Next:** attach real application policies and data tools in the application/plugin package; test both allowed and denied transitions against its authoritative state. Add trace-level evaluation of whether the model found the right passage and used the right facts. Do not claim that the current unit tests prove model behavior.
- **Benchmark:** keep the official τ-bench adapter free of workspace knowledge and business checks for raw-model diagnostics. If a guarded system is evaluated, report it separately with its tools, prompts, rule implementation, task set, and result files. A one-task smoke run is not a leaderboard result.

## Known limits

Lexical search can miss paraphrases or retrieve irrelevant paragraphs. A SHA-256 revision identifies document content, not policy correctness. `beforeExecute` is a hook, not an atomic transaction with an external business database; the application must handle concurrent changes and final server-side validation. No live model run has yet established that the new knowledge and time tools are used reliably.
