import type { KmindApp } from "@kmind/app";
import { hasUnsavedProjectContent, saveProjectOnHostExit } from "@kmind/app";
import type { Workspace } from "obsidian";

export function registerObsidianQuitSave(workspace: Pick<Workspace, "on" | "offref">, app: KmindApp,
  writes: { hasPendingWrites: () => boolean; whenWritesIdle: () => Promise<void> }): () => void {
  const ref = workspace.on("quit", (tasks) => {
    // Obsidian cancels the first unload when quit tasks are nonempty. An idle view
    // must leave its existing quit/save path alone (notably app.quit on macOS).
    if (!hasUnsavedProjectContent(app) && !writes.hasPendingWrites()) return;
    tasks.add(async () => {
      await saveProjectOnHostExit(app);
      await writes.whenWritesIdle();
    });
  });
  return () => workspace.offref(ref);
}
