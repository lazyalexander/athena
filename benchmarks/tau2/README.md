**English** | [中文](README.zh.md)

# τ-bench adapter

This adapter runs Athena's model clients under the official τ-bench orchestrator. The evaluator owns domain tools, user simulation, and scoring. `bridge.ts` submits an `external_step` op and returns the events from that submission plus the calls the evaluator should run. It does not execute tools. `ATHENA_PERMISSION_MODE` selects `untrusted`, `on-request`, or `never` for that process. The default is `never`, so every proposed call is returned. `on-request` allows `get_*`, `search_*`, and the built-in read-only tools, and denies the rest because the bridge has no prompt. `untrusted` denies every call. Domain policy is passed as system instructions, with a short write checklist appended. The checklist does not block a tool call. Keys stay in the environment.

Install the official `sierra-research/tau2-bench` checkout and its Python dependencies, then run from that checkout:

```sh
ATHENA_NODE=/path/to/node \
ATHENA_BENCH_PROVIDER=deepseek \
ATHENA_PERMISSION_MODE=never \
DEEPSEEK_API_KEY=... \
.venv/bin/python /path/to/athena/benchmarks/tau2/run.py run \
  --domain airline --agent athena \
  --agent-llm deepseek/deepseek-chat --user-llm deepseek/deepseek-chat \
  --task-ids 1 --num-trials 1 \
  --communicate-scorer substring --max-steps 30 \
  --save-to athena-airline-task1
```

For local Ollama, omit `ATHENA_BENCH_PROVIDER` and `DEEPSEEK_API_KEY`; set `ATHENA_BENCH_MODEL` and optionally `OLLAMA_HOST`. Use `--dry-run` to check CLI registration without making model calls. Scores from a small task sample are diagnostic only and should not be presented as a leaderboard score. Record the benchmark revision, task set, agent model, user simulator, scoring configuration, and raw results with each run.
