import { argv, stdout } from "node:process";
import { runTurn } from "./agent/core.ts";
import { openApp } from "./app.ts";
import { executeOperation, parseArgv, renderHelp, startConversation, type ProtocolHost } from "./protocol/protocol.ts";

let parsed: ReturnType<typeof parseArgv> | undefined;
try {
  parsed = parseArgv(argv.slice(2));
} catch (error) {
  stdout.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
if (parsed! && parsed.name === "help" && !parsed.permissionMode) {
  stdout.write(renderHelp("cli"));
} else if (parsed) {
  const app = await openApp();
  const host: ProtocolHost = {
    surface: "cli",
    io: { write: (text) => stdout.write(text), [Symbol.asyncIterator]: async function* () { /* one-shot */ } },
    model: app.model,
    tools: app.registry,
    workspace: app.workspace,
    models: app.model,
    journal: app.journal,
    sessions: app.sessions,
    switchWorkspace: app.switchWorkspace,
    turnCount: { n: 0 },
    permissionMode: parsed.permissionMode,
    runTurn: (input, options) => runTurn(app.model, app.registry, input, options),
  };
  try {
    startConversation(host);
    const status = await executeOperation(parsed.name, parsed.args, host);
    if (!status.ok) process.exitCode = 1;
  } catch (error) {
    stdout.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}
