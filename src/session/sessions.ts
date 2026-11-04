import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Journal, conversationStart } from "./journal.ts";

export type SessionInfo = { id: string; provider: string; model: string; createdAt: number };
const SESSION_ID = /^[a-f0-9-]{36}$/;

/** Session identity and agent model configuration belong to one workspace. */
export class Sessions {
  private readonly dir: string;
  private activeId: string;

  private constructor(root: string, activeId: string) {
    this.dir = join(root, ".athena", "sessions");
    this.activeId = activeId;
  }

  static open(root: string, provider: string, model: string): Sessions {
    const dir = join(root, ".athena", "sessions");
    mkdirSync(dir, { recursive: true });
    // Import the first multi-session layout, which stored metadata and logs side by side.
    for (const name of readdirSync(dir)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const id = name.slice(0, -5);
      const sessionDir = join(dir, id);
      mkdirSync(sessionDir, { recursive: true });
      renameSync(join(dir, name), join(sessionDir, "session.json"));
      const oldJournal = join(dir, `${id}.jsonl`);
      if (existsSync(oldJournal)) renameSync(oldJournal, join(sessionDir, "journal.jsonl"));
    }
    for (const name of readdirSync(dir)) {
      if (!/^[a-f0-9-]{36}\.jsonl$/.test(name)) continue;
      const sessionDir = join(dir, name.slice(0, -6));
      if (existsSync(join(sessionDir, "session.json"))) renameSync(join(dir, name), join(sessionDir, "journal.jsonl"));
    }
    const pointer = join(dir, "active");
    if (existsSync(pointer)) {
      const id = readFileSync(pointer, "utf8").trim();
      if (SESSION_ID.test(id) && existsSync(join(dir, id, "session.json"))) return new Sessions(root, id);
    }
    const sessions = new Sessions(root, "");
    const legacy = join(root, ".athena", "journal.jsonl");
    if (existsSync(legacy)) {
      const recorded = conversationStart(Journal.load(legacy).events);
      const info = sessions.create(recorded?.provider ?? provider, recorded?.model ?? model);
      renameSync(legacy, sessions.journalPath(info.id));
    } else sessions.create(provider, model);
    return sessions;
  }

  get active(): SessionInfo { return this.get(this.activeId); }

  get journal(): Journal { return Journal.openPath(this.journalPath(this.activeId)); }

  journalPath(id: string): string {
    if (!SESSION_ID.test(id)) throw new Error(`Invalid session ID: ${id}`);
    return join(this.dir, id, "journal.jsonl");
  }

  list(): SessionInfo[] {
    return readdirSync(this.dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && SESSION_ID.test(entry.name))
      .map((entry) => this.get(entry.name)).sort((a, b) => a.createdAt - b.createdAt);
  }

  get(id: string): SessionInfo {
    if (!SESSION_ID.test(id)) throw new Error(`Invalid session ID: ${id}`);
    const path = join(this.dir, id, "session.json");
    if (!existsSync(path)) throw new Error(`Unknown session: ${id}`);
    const info = JSON.parse(readFileSync(path, "utf8")) as SessionInfo;
    if (info.id !== id || typeof info.provider !== "string" || typeof info.model !== "string") throw new Error(`Invalid session: ${id}`);
    return info;
  }

  create(provider: string, model: string): SessionInfo {
    const info = { id: randomUUID(), provider, model, createdAt: Date.now() };
    const sessionDir = join(this.dir, info.id);
    mkdirSync(sessionDir, { mode: 0o700 });
    writeFileSync(join(sessionDir, "session.json"), JSON.stringify(info) + "\n", { flag: "wx", mode: 0o600 });
    this.activate(info.id);
    return info;
  }

  activate(id: string): SessionInfo {
    const info = this.get(id);
    const temporary = join(this.dir, `active.${randomUUID()}.tmp`);
    writeFileSync(temporary, id + "\n", { flag: "wx", mode: 0o600 });
    renameSync(temporary, join(this.dir, "active"));
    this.activeId = id;
    return info;
  }
}
