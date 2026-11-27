/**
 * Feature options the Obsidian runtime shares with its tests. Browsing never writes the project
 * file: moving between maps records no open times, and a clean project is not saved again.
 */
export const OBSIDIAN_NAVIGATION_OPTIONS = Object.freeze({ touchLastOpenedAt: false });
export const OBSIDIAN_AUTOSAVE_OPTIONS = Object.freeze({ debounceMs: 1000, skipCleanSaves: true });
