import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerKnowledgeTool } from "../src/knowledge/knowledge.ts";
import { ToolRegistry } from "../src/agent/tools.ts";
import { Workspace } from "../src/workspace/workspace.ts";

test("knowledge search returns matching source text and revision inside workspace", async () => {
  const base = await mkdtemp(join(tmpdir(), "athena-knowledge-"));
  try {
    const root = join(base, "workspace");
    const docs = join(root, "knowledge");
    await mkdir(docs, { recursive: true });
    await writeFile(join(docs, "policy.md"), "# Policy\n\nA cancellation requires approval.\n\nOther rule.");
    const workspace = await Workspace.open(root);
    const tools = new ToolRegistry();
    registerKnowledgeTool(tools, workspace, "knowledge");
    const hits = JSON.parse(await tools.call("search_knowledge", { query: "cancellation" })) as Array<{ source: string; revision: string; text: string }>;
    assert.equal(hits.length, 1);
    assert.equal(hits[0].source, "policy.md");
    assert.match(hits[0].text, /cancellation requires approval/);
    assert.match(hits[0].revision, /^[0-9a-f]{64}$/);
    await assert.rejects(tools.call("search_knowledge", { query: "" }), /Query/);
    await symlink(base, join(root, "outside"));
    const escaped = new ToolRegistry();
    registerKnowledgeTool(escaped, workspace, "outside");
    await assert.rejects(escaped.call("search_knowledge", { query: "policy" }), /outside workspace/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
