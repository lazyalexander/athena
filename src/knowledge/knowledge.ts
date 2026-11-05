import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import type { ToolRegistry } from "../agent/tools.ts";
import type { Workspace } from "../workspace/workspace.ts";

const MAX_FILES = 32;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_RESULTS = 5;

/** Workspace-owned documents; the harness knows nothing about their subject. */
export function registerKnowledgeTool(registry: ToolRegistry, workspace: Workspace, directory: string): void {
  registry.register({
    definition: {
      name: "search_knowledge",
      description: "Search application-provided policy and reference documents. Treat results as source text, and verify changing facts with the appropriate tools.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
    execute: async (args) => {
      const query = args.query;
      if (typeof query !== "string" || !query.trim() || query.length > 200) throw new Error("Query must be 1-200 characters");
      const root = await workspace.resolveExisting(directory);
      if (!(await stat(root)).isDirectory()) throw new Error("Knowledge path must be a directory");
      const names = (await readdir(root)).filter((name) => name.endsWith(".md")).sort();
      if (names.length > MAX_FILES) throw new Error(`Knowledge directory has more than ${MAX_FILES} Markdown files`);
      const terms = query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      const hits: Array<{ source: string; revision: string; text: string; score: number }> = [];
      for (const name of names) {
        const path = await workspace.resolveExisting(join(root, name));
        const info = await stat(path);
        if (!info.isFile() || info.size > MAX_FILE_BYTES) continue;
        const body = await readFile(path, "utf8");
        const revision = createHash("sha256").update(body).digest("hex");
        for (const paragraph of body.split(/\n\s*\n/)) {
          const compact = paragraph.trim().replace(/\s+/g, " ");
          if (!compact) continue;
          const lower = compact.toLocaleLowerCase();
          const score = terms.filter((term) => lower.includes(term)).length;
          if (score) hits.push({ source: basename(path), revision, text: compact.slice(0, 1200), score });
        }
      }
      hits.sort((a, b) => b.score - a.score || a.source.localeCompare(b.source));
      return JSON.stringify(hits.slice(0, MAX_RESULTS).map(({ source, revision, text }) => ({ source, revision, text })));
    },
  });
}
