import type { ObsidianRuntime } from "./create-obsidian-runtime";

let activeRuntime: ObsidianRuntime | null = null;

export function setActiveObsidianKmindRuntime(runtime: ObsidianRuntime): void {
  activeRuntime = runtime;
}

export function clearActiveObsidianKmindRuntime(runtime: ObsidianRuntime): void {
  if (activeRuntime === runtime) activeRuntime = null;
}

export function getActiveObsidianKmindRuntime(): ObsidianRuntime | null {
  return activeRuntime;
}
