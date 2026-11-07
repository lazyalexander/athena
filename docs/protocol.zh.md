**[English](protocol.md)** | 中文

# 协议

协议有两个方向，形状与 Codex 相同。客户端提交一个 `op`。会话用 `eventmsg` 回答，每条事件都带上那次提交的 id。命令行和 TUI 都是这个队列的客户端。不在清单里的名字会被拒绝。在 TUI 中，以 `/` 开头的一行始终是命令。

TUI 里用 `/help`。命令行用 `npm run cli` 或 `npm run cli -- help`。两边打印的是同一份清单。

## Op 与 eventmsg

| Op | 事件 |
|---|---|
| `user_input` | `turn_started`；需要人回答时有 `exec_approval_request`；然后是 `exec_command_begin`、`exec_command_end`、`agent_message`、`turn_complete`。模型失败是 `error`。 |
| `exec_approval` | 回应匹配的 `exec_approval_request`。决定是 `approved`、`denied` 或 `abort`。 |
| `interrupt` | 没有正在等待的轮次时发出 `turn_aborted`。正在跑的轮次会停下来，然后发出 `turn_aborted`。 |
| `configure_permission` | `session_configured` |
| `show_permission` | 打印当前模式 |

`user_input` 可以带 `permissionMode`。该值只作用于这一轮。不带时，这一轮使用会话模式。会话从 `untrusted` 开始。

## 权限 mode

| 模式 | 工具调用 |
|---|---|
| `untrusted` | 每个工具都先问。没有提示可回答的界面会拒绝这次调用。 |
| `on-request` | 允许 `read_file`、`search_knowledge` 和 `elapsed_time`。其余工具先问。 |
| `never` | 不问。允许这次调用。工具自己的 `beforeExecute` 检查仍会执行。 |

TUI 的问题是 `Allow <tool> <arguments> for this turn? [y/N]`。`y` 或 `yes` 表示批准。`abort` 停止这一轮。其他回答，包括 EOF，都是拒绝。命令行没有提示，所以 `untrusted` 和 `on-request` 里需要询问的调用会被拒绝，除非该模式允许这个工具。`--yes` 选择 `never`。`--permission-mode <mode>` 选择三种模式之一。

## 两边都能做的操作

| 操作 | TUI | 命令行 | 作用 |
|---|---|---|---|
| `help` | `/help` | `help` | 列出操作 |
| `prompt` | 输入一行不以 `/` 开头的文本 | `prompt [--yes] <text>` | 发送一条消息并打印回答 |
| `model` | `/model [<provider>] [name]` | `model [<provider>] [name]` | 显示当前模型，或切换 provider 和模型。切换会开始新对话 |
| `workspace` | `/workspace [directory]` | `workspace [directory]` | 显示工作区根目录，或切换到一个目录 |
| `sessions` | `/sessions` | `sessions` | 列出当前工作区的会话 |
| `session` | `/session new` 或 `/session use <id>` | `session new` 或 `session use <id>` | 创建会话，或按 id 恢复会话 |
| `new` | `/new` | `new` | 开始一轮新对话 |
| `permissions` | `/permissions [untrusted\|on-request\|never]` | `permissions [untrusted\|on-request\|never]` | 显示或设置权限 mode |

`prompt` 使用上面的权限 mode。TUI 可以询问。命令行不能询问，所以需要询问的工具调用会被拒绝，并把拒绝送回模型。`--yes` 就是 `never` 模式。

## 仅 TUI

| 操作 | TUI | 作用 |
|---|---|---|
| `exit` | `/exit` 或 `/quit` | 离开交互会话 |

命令行执行一个操作后就退出，所以没有 `exit` 操作。

## 命令行

```sh
npm run cli
npm run cli -- model
npm run cli -- model ollama qwen3:1.7b
npm run cli -- workspace
npm run cli -- sessions
npm run cli -- session use <id>
npm run cli -- new
npm run cli -- permissions
npm run cli -- permissions on-request
npm run cli -- prompt "hello"
npm run cli -- prompt --permission-mode on-request "hello"
npm run cli -- prompt --yes "hello"
```

`npm start` 打开 TUI。两个入口都使用 `openApp`，因此看到同一组 provider、工作区、会话和工具。
