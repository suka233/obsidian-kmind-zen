import type { DocumentId, KmindFeature } from "@kmind/app";
import {
  createStandardFeaturePreset,
  createViewModesFeature,
} from "@kmind/app";

import { kmindZenViewModesDefaultsStore } from "./view-modes-defaults-store";

export function commonFeaturePreset(args: { rootDocId: DocumentId }): KmindFeature[] {
  return createStandardFeaturePreset({
    documentOptions: { catalog: { mode: "root-only", rootId: args.rootDocId }, createIfMissing: false, touchLastOpenedAt: false, upgradeThemeState: false },
    viewModesOptions: { defaults: kmindZenViewModesDefaultsStore },
    layoutOptions: { initScope: "none", projectScope: "project-submaps" },
    includeTrash: false,
    mindMapOptions: {
      defaultLayoutEngine: "tidy",
      collab: {
        enabled: true,
        clearBootstrapUpdate: false,
        onProjectYdoc: ({ app, projectId, ydoc, generation, collab }) => {
          app.host.ports.projectCollab?.setContext({
            projectId,
            ydoc,
            generation,
            collab: {
              encodeYDocStateAsUpdate: collab.encodeYDocStateAsUpdate,
              inspectKmindCrdtFullSnapshotUpdate: collab.inspectKmindCrdtFullSnapshotUpdate,
              applyKmindCrdtFullSnapshotUpdate: collab.applyKmindCrdtFullSnapshotUpdate,
              listDocumentIdsInCrdt: collab.listDocumentIdsInCrdt,
              deleteMindMapDocumentFromCrdt: collab.deleteMindMapDocumentFromCrdt,
              materializeMindMapDocumentFromCrdt: collab.materializeMindMapDocumentFromCrdt,
              readDocumentRecordMetaFromCrdt: collab.readDocumentRecordMetaFromCrdt,
              upsertDocumentRecordMetaIntoCrdt: collab.upsertDocumentRecordMetaIntoCrdt,
              upsertMindMapDocumentIntoCrdt: collab.upsertMindMapDocumentIntoCrdt,
              replaceMindMapDocumentInCrdt: collab.replaceMindMapDocumentInCrdt,
              replaceProjectSnapshotInCrdt: collab.replaceProjectSnapshotInCrdt,
            },
          });
        },
      },
    },
    nodeUiLayoutOptions: { defaultLayout: "card-v1", enableToolbar: false },
    nodeLinkOptions: { externalBacklinks: { mode: "eager", scope: "reachable-submaps" } },
    autosaveOptions: { debounceMs: 1000 },
    documentZipOptions: { enableToolbar: false },
  });
}
