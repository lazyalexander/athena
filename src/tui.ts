import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { runCore } from "./agent/core.ts";
import { openApp } from "./app.ts";

const app = await openApp();
const terminal = createInterface({ input: stdin, crlfDelay: Infinity });

try {
  await runCore(app.model, app.registry, {
    [Symbol.asyncIterator]: () => terminal[Symbol.asyncIterator](),
    write: (text) => stdout.write(text),
  }, app.workspace, app.model, app.journal, { sessions: app.sessions, switchWorkspace: app.switchWorkspace });
} finally {
  terminal.close();
  await app.close();
}
