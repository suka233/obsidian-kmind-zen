import type { App } from "obsidian";
import { sha256HexText } from "@kmind/app";
import { resolveObsidianSafetyDirectory } from "./obsidian-safe-project-write";

const queues = new WeakMap<App, Promise<void>>();
const validPath = (path: unknown): path is string => typeof path === "string" && path.length > 0 && path.length <= 4096
  && !path.startsWith("/") && !/[\\\u0000-\u001f]/u.test(path)
  && path.split("/").every(part => part !== "" && part !== "." && part !== "..");
const linkDirectory = async (path: string) => `.kmind-zen/safety-renames/${await sha256HexText(path)}`;

/** Called only with paths supplied by a real Vault rename event. No project writes. */
export function recordObsidianSafetyRename(app: App, from: string, to: string): Promise<void> {
  const task = (queues.get(app) ?? Promise.resolve()).catch(() => {}).then(async () => {
    if (!validPath(from) || !validPath(to) || from === to) throw Error("Invalid safety rename paths.");
    const adapter = app.vault.adapter;
    let hasSources = false;
    for (const directory of [await resolveObsidianSafetyDirectory(from), await linkDirectory(from)]) {
      if (!await adapter.exists(directory)) continue;
      const entries = await adapter.list(directory);
      if (entries.files.length || entries.folders.length) { hasSources = true; break; }
    }
    if (!hasSources) return;
    const directory = await linkDirectory(to);
    let parent = "";
    for (const segment of directory.split("/")) {
      parent = parent ? `${parent}/${segment}` : segment;
      if (!await adapter.exists(parent)) await adapter.mkdir(parent);
    }
    const path = `${directory}/${crypto.randomUUID()}.json`;
    if (await adapter.exists(path)) throw Error("Safety rename record already exists.");
    const text = JSON.stringify({ version: 1, from, to });
    await adapter.write(path, text);
    if (await adapter.read(path) !== text) throw Error("Safety rename record failed read-back.");
  });
  queues.set(app, task.then(() => {}, () => {}));
  return task;
}

/** Paths are provenance labels, never authority to restore or merge their content. */
export async function listObsidianSafetySourcePaths(app: App, target: string): Promise<string[]> {
  await queues.get(app);
  if (!validPath(target)) throw Error("Invalid recovery target path.");
  const paths = [target];
  const seen = new Set(paths);
  const adapter = app.vault.adapter;
  for (let index = 0; index < paths.length; index++) {
    if (paths.length > 128) throw Error("Safety rename provenance exceeds inspection limit.");
    const to = paths[index]!;
    const directory = await linkDirectory(to);
    if (!await adapter.exists(directory)) continue;
    const entries = await adapter.list(directory);
    if (entries.folders.length) throw Error("Invalid safety rename directory.");
    for (const path of entries.files) {
      if (!path.startsWith(`${directory}/`) || !/^[a-zA-Z0-9_-]+\.json$/u.test(path.slice(directory.length + 1))) throw Error("Invalid safety rename record path.");
      const stat = await adapter.stat(path);
      if (!stat || stat.type !== "file" || stat.size > 16384) throw Error("Invalid safety rename record size.");
      const record = JSON.parse(await adapter.read(path));
      if (!record || Object.keys(record).sort().join(",") !== "from,to,version" || record.version !== 1 || record.to !== to || !validPath(record.from) || record.from === to) throw Error("Invalid safety rename record.");
      if (!seen.has(record.from)) { seen.add(record.from); paths.push(record.from); }
    }
  }
  return paths;
}
