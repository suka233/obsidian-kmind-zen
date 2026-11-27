import type { App } from "obsidian";
import { PROJECT_RECOVERY_INPUT_LIMITS } from "@kmind/app";

// All views of one Vault share maintenance protection, not document state.
const protectedFiles = new WeakMap<object, Map<string, number>>();

export function isObsidianHistoryFileProtected(app: App, path: string): boolean {
  return (protectedFiles.get(app.vault)?.get(path) ?? 0) > 0;
}

export async function prepareObsidianHistoryRestore(app: App, path: string) {
  let paths = protectedFiles.get(app.vault);
  if (!paths) { paths = new Map(); protectedFiles.set(app.vault, paths); }
  const owned = new Set<string>();
  let released = false;
  const protect = (filePath: string) => {
    if (released) throw new Error("History restore lease has ended.");
    if (owned.has(filePath)) return;
    owned.add(filePath);
    paths.set(filePath, (paths.get(filePath) ?? 0) + 1);
  };
  const release = () => {
    if (released) return;
    released = true;
    for (const filePath of owned) {
      const count = (paths.get(filePath) ?? 1) - 1;
      if (count) paths.set(filePath, count); else paths.delete(filePath);
    }
    owned.clear();
  };
  const read = async () => {
    const stat = await app.vault.adapter.stat(path);
    if (!stat || stat.type !== "file" || stat.size > PROJECT_RECOVERY_INPUT_LIMITS.sourceFileBytes) {
      throw new Error("History restore source is missing or exceeds the input limit.");
    }
    const bytes = new Uint8Array(await app.vault.adapter.readBinary(path));
    if (bytes.byteLength > PROJECT_RECOVERY_INPUT_LIMITS.sourceFileBytes) throw new Error("History restore source exceeds the input limit.");
    return bytes;
  };
  protect(path);
  try {
    const baseline = await read();
    return {
      protect, release,
      async readVerified() {
        if (released) throw new Error("History restore lease has ended.");
        const current = await read();
        if (current.length !== baseline.length || current.some((value, index) => value !== baseline[index])) {
          throw new Error("History restore source changed after selection; select it again.");
        }
        return current;
      },
    };
  } catch (error) { release(); throw error; }
}
