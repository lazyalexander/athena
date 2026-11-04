import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSandboxExec, seatbeltProfile, wrapSandboxed } from "../src/sandbox.ts";

test("profile confines writes to workspace and temp, denies network", () => {
  const profile = seatbeltProfile("/Users/alice/project", "/var/folders/xyz/T");
  assert.match(profile, /\(version 1\)/);
  assert.match(profile, /\(deny network\*\)/);
  assert.match(profile, /\(subpath "\/Users\/alice\/project"\)/);
  const writeLine = profile.split("\n").find((line) => line.includes("file-write*"));
  assert.ok(writeLine);
  assert.ok(!writeLine.includes("/System"), "system paths must not be writable");
  assert.ok(!writeLine.includes("/usr"), "system paths must not be writable");
});

test("profile escapes quotes and backslashes in paths", () => {
  const profile = seatbeltProfile('/tmp/we"ird\\dir', "/tmp");
  assert.ok(profile.includes('/tmp/we\\"ird\\\\dir'));
});

test("profile adds /private-prefixed twins for /var paths (symlink resolution)", () => {
  const profile = seatbeltProfile("/var/folders/x/T/ws", "/var/folders/x/T", []);
  assert.ok(profile.includes('(subpath "/private/var/folders/x/T/ws")'));
  assert.ok(profile.includes('(subpath "/private/var/folders/x/T")'));
  assert.ok(profile.includes('(subpath "/private/etc")'));
});

test("wrapSandboxed wraps with sandbox-exec profile when available", () => {
  const wrapped = wrapSandboxed("node", ["server.js"], "/ws", "/tmp", "/usr/bin/sandbox-exec");
  assert.equal(wrapped.command, "/usr/bin/sandbox-exec");
  assert.equal(wrapped.args[0], "-p");
  assert.match(wrapped.args[1], /\(version 1\)/);
  assert.deepEqual(wrapped.args.slice(2), ["node", "server.js"]);
});

test("wrapSandboxed passes through when sandbox-exec is missing", () => {
  const wrapped = wrapSandboxed("node", ["server.js"], "/ws", "/tmp", null);
  assert.deepEqual(wrapped, { command: "node", args: ["server.js"] });
});

test("resolveSandboxExec uses the injected lookup", async () => {
  assert.equal(await resolveSandboxExec(async () => "/usr/bin/sandbox-exec"), "/usr/bin/sandbox-exec");
  assert.equal(await resolveSandboxExec(async () => null), null);
});
