import type { DocumentId, KmindFeature } from "@kmind/app";
import {
  createStandardFeaturePreset,
} from "@kmind/app";

import { OBSIDIAN_AUTOSAVE_OPTIONS, OBSIDIAN_NAVIGATION_OPTIONS } from "./feature-options";
import { kmindZenViewModesDefaultsStore } from "./view-modes-defaults-store";

export function commonFeaturePreset(args: { rootDocId: DocumentId }): KmindFeature[] {
  return createStandardFeaturePreset({
    documentOptions: { catalog: { mode: "root-only", rootId: args.rootDocId }, createIfMissing: false, touchLastOpenedAt: false, upgradeThemeState: false },
    navigationOptions: OBSIDIAN_NAVIGATION_OPTIONS,
    viewModesOptions: { defaults: kmindZenViewModesDefaultsStore },
    layoutOptions: { initScope: "none", projectScope: "project-submaps" },
    includeTrash: false,
    // JSON-canonical: the plain Core edits the host records; no project Y.Doc is created.
    mindMapOptions: { defaultLayoutEngine: "tidy" },
    nodeUiLayoutOptions: { defaultLayout: "card-v1", enableToolbar: false },
    nodeLinkOptions: { externalBacklinks: { mode: "eager", scope: "reachable-submaps" } },
    autosaveOptions: OBSIDIAN_AUTOSAVE_OPTIONS,
    documentZipOptions: { enableToolbar: false },
  });
}
