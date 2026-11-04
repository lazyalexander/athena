import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFileTools } from "../src/file-tools.ts";
import { ToolRegistry } from "../src/tools.ts";
import { Workspace } from "../src/workspace.ts";

test("file tools create, read, edit, and reject stale replacement and escapes", async () => {
  const base = await mkdtemp(join(tmpdir(), "athena-files-"));
  try {
    const root = join(base, "project");
    await mkdir(root);
    await symlink(base, join(root, "outside"));
    const workspace = await Workspace.open(root);
    const registry = new ToolRegistry();
    registerFileTools(registry, workspace);

    await registry.call("write_file", { path: "note.txt", content: "hello" });
    const read = JSON.parse(await registry.call("read_file", { path: "note.txt" })) as { content: string; sha256: string };
    assert.equal(read.content, "hello");
    await registry.call("edit_file", { path: "note.txt", oldText: "hello", newText: "bonjour" });
    assert.equal(await readFile(join(root, "note.txt"), "utf8"), "bonjour");
    await assert.rejects(registry.call("write_file", { path: "note.txt", content: "oops", expectedSha256: read.sha256 }), /changed/);
    await assert.rejects(registry.call("write_file", { path: "../escape.txt", content: "oops" }), /outside workspace/);
    await assert.rejects(registry.call("write_file", { path: "outside/escape.txt", content: "oops" }), /outside workspace/);
    await assert.rejects(registry.call("read_file", { path: "outside" }), /outside workspace/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
