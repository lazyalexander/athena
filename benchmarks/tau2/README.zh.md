**[English](README.md)** | 中文

# τ-bench 适配器

这个适配器在官方 τ-bench 编排器下运行 Athena 的模型客户端。评测方拥有领域工具、用户模拟和打分。`bridge.ts` 提交 `external_step`，并返回这次提交产生的事件，以及评测方应该执行的调用。它不执行工具。`ATHENA_PERMISSION_MODE` 为该进程选择 `untrusted`、`on-request` 或 `never`。默认是 `never`，因此每个提议的调用都会返回。`on-request` 允许 `get_*`、`search_*` 和内置只读工具，其余调用会被拒绝，因为桥没有提示可回答。`untrusted` 拒绝每一次调用。领域政策作为系统说明传入，后面附有一段写操作检查清单。清单不会拦截工具调用。密钥留在环境变量中。

先安装官方 `sierra-research/tau2-bench` 检出及其 Python 依赖，然后在该检出中运行：

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

本地 Ollama 不需要设置 `ATHENA_BENCH_PROVIDER` 和 `DEEPSEEK_API_KEY`；设置 `ATHENA_BENCH_MODEL`，可选 `OLLAMA_HOST`。用 `--dry-run` 检查 CLI 注册，且不发起模型调用。小样本分数只用于诊断，不要当作榜单成绩。每次运行都记录基准版本、任务集、agent 模型、用户模拟器、打分配置和原始结果。
