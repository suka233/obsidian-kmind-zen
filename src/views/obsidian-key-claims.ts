import type { KeymapEventHandler, Modifier, Scope } from "obsidian";

import {
  listWhiteboardInputOwnedCombos,
  listWhiteboardToolShortcutCombos,
  normalizeKeyComboKey,
  type KeyCombo,
  type KeymapContribution,
} from "@kmind/app";

/**
 * The keys a map view claims now (phase-34.16, phase-34.55): in whiteboard mode the keys the whiteboard and the host
 * bindings take; and the whiteboard's single-key tool shortcuts only while they act (`whiteboardToolKeysActive`: the
 * canvas has the focus, the whiteboard is in context, no node is selected, nothing is typed), so a letter typed
 * anywhere else in Obsidian stays Obsidian's. In map mode, with the tool keys inactive, nothing.
 */
export function resolveObsidianClaimedCombos(input: {
  bindings: readonly KeymapContribution[];
  whiteboardInputActive: boolean;
  whiteboardToolKeysActive: boolean;
}): KeyCombo[] {
  const toolKeys = input.whiteboardToolKeysActive ? listWhiteboardToolShortcutCombos() : [];
  if (!input.whiteboardInputActive) return toolKeys;
  return [...listWhiteboardInputOwnedCombos(input.bindings), ...toolKeys];
}

/**
 * The Obsidian key of a KMind key combo (`Scope.register`): exact modifiers, letters and digits by their
 * character (also when the combo names the physical key), named keys as the browser names them, Space as " ".
 */
export function obsidianKeyOfCombo(combo: KeyCombo): { modifiers: Modifier[]; key: string } | null {
  const modifiers: Modifier[] = [];
  if (combo.meta) modifiers.push("Meta");
  if (combo.ctrl) modifiers.push("Ctrl");
  if (combo.alt) modifiers.push("Alt");
  if (combo.shift) modifiers.push("Shift");
  const code = combo.code ?? "";
  const key = combo.key
    ?? (/^Key[A-Z]$/u.test(code) ? code.slice(3) : /^Digit[0-9]$/u.test(code) ? code.slice(5) : code === "Space" ? " " : code);
  if (!key) return null;
  return { modifiers, key: key.length === 1 ? key.toUpperCase() : key };
}

/**
 * The keys a map view's Obsidian scope claims (phase-34.16, Q9). Obsidian's hotkeys run before the view's
 * window listener, so without a claim one press of a key KMind takes would also run an Obsidian command bound
 * to it. A claim's handler returns nothing: the key is neither prevented nor stopped, KMind's own listeners
 * still handle it. `claim(combos)` makes `combos` the claimed keys (new ones registered, gone ones unregistered).
 */
export function createObsidianKeyClaims(scope: Pick<Scope, "register" | "unregister">) {
  const claims = new Map<string, KeymapEventHandler>();
  return {
    claim(combos: readonly KeyCombo[]): void {
      const wanted = new Map<string, { modifiers: Modifier[]; key: string }>();
      for (const combo of combos) {
        const id = normalizeKeyComboKey(combo);
        const key = obsidianKeyOfCombo(combo);
        if (id && key) wanted.set(id, key);
      }
      for (const [id, handler] of claims) {
        if (wanted.has(id)) continue;
        scope.unregister(handler);
        claims.delete(id);
      }
      for (const [id, key] of wanted) {
        if (claims.has(id)) continue;
        claims.set(id, scope.register(key.modifiers, key.key, () => undefined));
      }
    },
    /** The claimed keys, for tests and diagnostics. */
    claimed: (): string[] => [...claims.keys()],
  };
}
