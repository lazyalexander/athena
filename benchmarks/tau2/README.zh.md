**[English](README.md)** | 中文

# τ-bench 适配器

这个适配器在官方 τ-bench 编排器下运行 Athena 的模型客户端。评测方拥有领域工具、用户模拟和打分。`bridge.ts` 通过 `createProviderLayer` 取得客户端，转发工具定义，并返回模型的工具调用。它不执行工具，也不做航空政策检查。领域政策作为系统说明传入。密钥留在环境变量中。

先安装官方 `sierra-research/tau2-bench` 检出及其 Python 依赖，然后在该检出中运行：

```sh
ATHENA_NODE=/path/to/node \
ATHENA_BENCH_PROVIDER=deepseek \
DEEPSEEK_API_KEY=... \
.venv/bin/python /path/to/athena/benchmarks/tau2/run.py run \
  --domain airline --agent athena \
  --agent-llm deepseek/deepseek-chat --user-llm deepseek/deepseek-chat \
  --task-ids 1 --num-trials 1 \
  --communicate-scorer substring --max-steps 30 \
  --save-to athena-airline-task1
```

本地 Ollama 不需要设置 `ATHENA_BENCH_PROVIDER` 和 `DEEPSEEK_API_KEY`；设置 `ATHENA_BENCH_MODEL`，可选 `OLLAMA_HOST`。用 `--dry-run` 检查 CLI 注册，且不发起模型调用。小样本分数只用于诊断，不要当作榜单成绩。每次运行都记录基准版本、任务集、agent 模型、用户模拟器、打分配置和原始结果。
