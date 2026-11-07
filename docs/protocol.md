**English** | [中文](protocol.zh.md)

# Protocol

The protocol has two directions, in the same shape as Codex. A client submits an `op`. The session answers with `eventmsg` values, each carrying the submission id. The command line and the TUI are clients of that queue. A name that is not in the list is rejected. In the TUI, a line that starts with `/` is always a command.

`/help` in the TUI, and `npm run cli` or `npm run cli -- help` on the command line, print this same list.

## Op and eventmsg

| Op | Event messages |
|---|---|
| `user_input` | `turn_started`, `exec_approval_request` when a person must answer, `exec_command_begin`, `exec_command_end`, `agent_message`, `turn_complete`. A model failure is `error`. |
| `exec_approval` | Resolves the matching `exec_approval_request`. `approved`, `denied`, or `abort`. |
| `interrupt` | `turn_aborted` when no turn is waiting. A running turn stops and then emits `turn_aborted`. |
| `configure_permission` | `session_configured` |
| `show_permission` | Prints the current mode |

`user_input` may carry `permissionMode`. That value applies to that turn only. Without it, the turn uses the session mode. The session starts in `untrusted`.

## Permission mode

| Mode | Tool calls |
|---|---|
| `untrusted` | Ask before every tool. A surface with no prompt denies the call. |
| `on-request` | Allow `read_file`, `search_knowledge`, and `elapsed_time`. Ask before every other tool. |
| `never` | Do not ask. Allow the call. A tool's own `beforeExecute` check still runs. |

The TUI asks with `Allow <tool> <arguments> for this turn? [y/N]`. `y` or `yes` approves. `abort` stops the turn. Any other answer, including EOF, denies it. The command line has no prompt, so `untrusted` and `on-request` asks are denied there unless the mode allows the tool. `--yes` selects `never` for that process. `--permission-mode <mode>` selects one of the three modes.

## Operations available to both

| Operation | TUI | Command line | What it does |
|---|---|---|---|
| `help` | `/help` | `help` | List operations |
| `prompt` | Type a line that does not start with `/` | `prompt [--yes] <text>` | Send one message and print the answer |
| `model` | `/model [<provider>] [name]` | `model [<provider>] [name]` | Show the current model, or switch provider and model. Switching starts a new conversation |
| `workspace` | `/workspace [directory]` | `workspace [directory]` | Show the workspace root, or switch to a directory |
| `sessions` | `/sessions` | `sessions` | List sessions in the current workspace |
| `session` | `/session new` or `/session use <id>` | `session new` or `session use <id>` | Create a session, or resume one by id |
| `new` | `/new` | `new` | Start a new conversation |
| `permissions` | `/permissions [untrusted\|on-request\|never]` | `permissions [untrusted\|on-request\|never]` | Show or set the permission mode |

`prompt` uses the permission mode above. The TUI can ask. The command line cannot, so a mode that asks denies that tool call and returns the denial to the model. `--yes` is the `never` mode.

## TUI only

| Operation | TUI | What it does |
|---|---|---|
| `exit` | `/exit` or `/quit` | Leave the interactive session |

The command line runs one operation and then exits, so it has no `exit` operation.

## Command line

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

`npm start` opens the TUI. Both entries use `openApp`, so they see the same providers, workspace, sessions, and tools.
