import { useMemo } from "react";
import type { App, TFile } from "obsidian";
import { RecoveryWorkbench } from "@kmind/app-react";
import { createObsidianProjectRecovery } from "../host/obsidian/obsidian-project-recovery";
import { createObsidianFilesPort } from "../host/obsidian/obsidian-files";

/** No editor, document store, autosave or CRDT is created in this error shell. */
export function ObsidianFailedProjectRecovery(props: { app: App; file: TFile }) {
  const recovery = useMemo(() => createObsidianProjectRecovery({
    app: props.app, file: props.file, files: createObsidianFilesPort({ app: props.app, baseFile: props.file }),
  }), [props.app, props.file, props.file.path]);
  return <RecoveryWorkbench recovery={recovery} diagnostic={null} translationPrefix="obsidian.recovery" initiallyExpanded />;
}
