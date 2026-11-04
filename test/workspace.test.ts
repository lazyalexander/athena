import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace } from "../src/workspace.ts";

test("workspace resolves paths inside its root and rejects escapes", async () => {
  const base = await mkdtemp(join(tmpdir(), "athena-workspace-"));
  try {
    const root = join(base, "project");
    await mkdir(root);
    await writeFile(join(root, "inside.txt"), "ok");
    await symlink(base, join(root, "link-out"));
    const workspace = await Workspace.open(root);
    assert.equal(await workspace.resolveExisting("inside.txt"), await realpath(join(root, "inside.txt")));
    assert.throws(() => workspace.resolvePath("../outside.txt"), /outside workspace/);
    await assert.rejects(workspace.resolveExisting("link-out"), /outside workspace/);
    await workspace.switchTo("..");
    assert.equal(workspace.root, await realpath(base));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
