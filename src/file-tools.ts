import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { constants } from "node:fs";
import type { ToolRegistry } from "./tools.ts";
import type { Workspace } from "./workspace.ts";

const MAX_BYTES = 1024 * 1024;

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value) throw new Error(`${key} must be a non-empty string`);
  return value;
}

function checksum(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function existingFile(workspace: Workspace, path: string): Promise<string> {
  const target = await workspace.resolveExisting(path);
  const info = await stat(target);
  if (!info.isFile()) throw new Error("Path is not a regular file");
  if (info.size > MAX_BYTES) throw new Error("File exceeds 1 MiB limit");
  return target;
}

async function replaceFile(target: string, content: string): Promise<void> {
  const parent = dirname(target);
  const temp = join(parent, `.${basename(target)}.${process.pid}.${randomSuffix()}.tmp`);
  const mode = (await stat(target)).mode & 0o777;
  const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, mode);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, target);
  } catch (error) {
    await unlink(temp);
    throw error;
  }
}

function randomSuffix(): string {
  return createHash("sha256").update(randomUUID()).digest("hex").slice(0, 12);
}

export function registerFileTools(registry: ToolRegistry, workspace: Workspace): void {
  registry.register({
    definition: {
      name: "read_file",
      description: "Read a UTF-8 file inside the current workspace (up to 1 MiB).",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
    },
    execute: async (args) => {
      const path = stringArg(args, "path");
      const target = await existingFile(workspace, path);
      const content = await readFile(target, "utf8");
      return JSON.stringify({ path: relative(workspace.root, target), content, sha256: checksum(content) });
    },
  });

  registry.register({
    definition: {
      name: "write_file",
      description: "Create a UTF-8 file in the workspace. To replace an existing file, provide its current SHA-256 from read_file.",
      parameters: { type: "object", properties: {
        path: { type: "string" }, content: { type: "string" }, expectedSha256: { type: "string" },
      }, required: ["path", "content"], additionalProperties: false },
    },
    execute: async (args) => {
      const path = stringArg(args, "path");
      if (typeof args.content !== "string") throw new Error("content must be a string");
      const content = args.content;
      if (Buffer.byteLength(content, "utf8") > MAX_BYTES) throw new Error("Content exceeds 1 MiB limit");
      const candidate = workspace.resolvePath(path);
      const parent = await workspace.resolveExisting(dirname(candidate));
      const target = join(parent, basename(candidate));
      workspace.resolvePath(target);
      const expected = args.expectedSha256;
      if (expected === undefined) {
        const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { await handle.writeFile(content, "utf8"); } finally { await handle.close(); }
      } else {
        if (typeof expected !== "string") throw new Error("expectedSha256 must be a string");
        const actual = await existingFile(workspace, path);
        const current = await readFile(actual, "utf8");
        if (checksum(current) !== expected) throw new Error("File changed since read_file");
        await replaceFile(actual, content);
      }
      return JSON.stringify({ path, sha256: checksum(content) });
    },
  });

  registry.register({
    definition: {
      name: "edit_file",
      description: "Replace one exact occurrence of text in a UTF-8 workspace file.",
      parameters: { type: "object", properties: {
        path: { type: "string" }, oldText: { type: "string" }, newText: { type: "string" },
      }, required: ["path", "oldText", "newText"], additionalProperties: false },
    },
    execute: async (args) => {
      const path = stringArg(args, "path");
      const oldText = stringArg(args, "oldText");
      if (typeof args.newText !== "string") throw new Error("newText must be a string");
      const target = await existingFile(workspace, path);
      const content = await readFile(target, "utf8");
      const first = content.indexOf(oldText);
      if (first < 0) throw new Error("oldText was not found");
      if (content.indexOf(oldText, first + oldText.length) >= 0) throw new Error("oldText is not unique");
      const updated = content.slice(0, first) + args.newText + content.slice(first + oldText.length);
      if (Buffer.byteLength(updated, "utf8") > MAX_BYTES) throw new Error("Result exceeds 1 MiB limit");
      await replaceFile(target, updated);
      return JSON.stringify({ path, sha256: checksum(updated) });
    },
  });
}
