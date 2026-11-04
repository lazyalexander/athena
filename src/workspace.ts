import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export class Workspace {
  private currentRoot: string;

  private constructor(root: string) {
    this.currentRoot = root;
  }

  static async open(path: string): Promise<Workspace> {
    return new Workspace(await Workspace.directory(path));
  }

  get root(): string {
    return this.currentRoot;
  }

  async switchTo(path: string): Promise<void> {
    this.currentRoot = await Workspace.directory(resolve(this.currentRoot, path));
  }

  async resolveExisting(path: string): Promise<string> {
    const actual = await realpath(resolve(this.currentRoot, path));
    this.assertInside(actual);
    return actual;
  }

  resolvePath(path: string): string {
    if (!path || path.includes("\0")) throw new Error("Invalid workspace path");
    const candidate = resolve(this.currentRoot, path);
    this.assertInside(candidate);
    return candidate;
  }

  private assertInside(path: string): void {
    const offset = relative(this.currentRoot, path);
    if (offset === ".." || offset.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(offset)) {
      throw new Error(`Path is outside workspace: ${path}`);
    }
  }

  private static async directory(path: string): Promise<string> {
    const actual = await realpath(path);
    if (!(await stat(actual)).isDirectory()) throw new Error(`Not a directory: ${path}`);
    return actual;
  }
}
