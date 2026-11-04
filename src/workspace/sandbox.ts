/** macOS Seatbelt (sandbox-exec) profiles for sandboxing child processes such as MCP servers. */

export type SandboxCommand = { command: string; args: string[] };

function escapeSbpl(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Seatbelt resolves paths before matching, and /var is a symlink to
 * /private/var, so every /var path needs its /private-prefixed twin or the
 * rule silently never matches.
 */
function pathVariants(path: string): string[] {
  const variants = [path];
  if (path.startsWith("/var/")) variants.push(`/private${path}`);
  return variants;
}

function subpaths(paths: string[]): string {
  return paths.flatMap(pathVariants).map((path) => `(subpath "${escapeSbpl(path)}")`).join(" ");
}

/** Allow reading what an unprivileged macOS process normally needs to start (dyld, system libs, config). */
const SYSTEM_READS = ["/System", "/usr", "/bin", "/sbin", "/Library", "/private/etc", "/private/var/db", "/dev", "/opt/homebrew", "/usr/local"];

/**
 * Seatbelt profile denying network access and limiting file access to the
 * workspace plus temp and cache locations. Writes are confined to the
 * workspace and temp dirs.
 */
export function seatbeltProfile(workspace: string, tmpDir: string, extraReadPaths: string[] = []): string {
  const reads = subpaths(SYSTEM_READS);
  const extraReads = extraReadPaths.length ? " " + subpaths(extraReadPaths) : "";
  const tmpReads = subpaths([tmpDir]);
  const writable = subpaths([workspace, "/private/tmp", "/private/var/tmp", tmpDir]);
  return [
    "(version 1)",
    "(deny default)",
    "(allow process-fork process-exec process-exec-interpreter sysctl-read)",
    "(allow file-read-metadata)",
    `(allow file-read* (literal "/") ${reads} ${tmpReads}${extraReads})`,
    `(allow file-read* file-write* ${writable})`,
    "(deny network*)",
    "",
  ].join("\n");
}

/** Look up the sandbox-exec binary; null when Seatbelt is unavailable (non-macOS or removed). */
export async function resolveSandboxExec(
  lookup: (name: string) => Promise<string | null> = defaultLookup,
): Promise<string | null> {
  return lookup("sandbox-exec");
}

async function defaultLookup(name: string): Promise<string | null> {
  const { access } = await import("node:fs/promises");
  for (const dir of ["/usr/bin", "/bin", "/usr/sbin", "/sbin", "/opt/homebrew/bin", "/usr/local/bin"]) {
    const candidate = `${dir}/${name}`;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next directory
    }
  }
  return null;
}

/**
 * Wrap a child command in sandbox-exec with a workspace-confined profile.
 * When sandboxExec is null the command is returned unchanged (no sandbox).
 */
export function wrapSandboxed(
  command: string,
  args: string[],
  workspace: string,
  tmpDir: string,
  sandboxExec: string | null,
  extraReadPaths: string[] = [],
): SandboxCommand {
  if (!sandboxExec) return { command, args };
  const profile = seatbeltProfile(workspace, tmpDir, extraReadPaths);
  return { command: sandboxExec, args: ["-p", profile, command, ...args] };
}
