import { projectProtectionError } from "@kmind/app";
import {
  ProjectDestructiveLineageLedger, evaluateProjectDurableTransition,
  ProjectSaveIOError, ProjectSaveRetryCoordinator,
  type DocumentId, type ProjectDurableDescriptor, type ProjectDurableDiagnostic, type ProjectSaveIntegrityPort,
} from "@kmind/app";
import { ObsidianVerifiedSourceWriteError } from "./obsidian-safe-project-write";

/** Owns host save state; content and change authority remain in Core/app. */
export function createObsidianSaveIntegrity(projectId: () => DocumentId | null, retryIO?: {
  readCurrent(): Promise<string | null>;
  validateCurrent(text: string): Promise<void>;
  adoptCandidate(text: string): Promise<void>;
}) {
  const retry = new ProjectSaveRetryCoordinator();
  let maintenance: ReturnType<ProjectSaveIntegrityPort["getState"]>["maintenance"] = null;
  let ledger = new ProjectDestructiveLineageLedger();
  const observedRevisions = new Map<string, Parameters<ProjectDestructiveLineageLedger["attachCanonicalRevision"]>[0]>();
  const observe = (args: Parameters<ProjectDestructiveLineageLedger["attachCanonicalRevision"]>[0]) => {
    observedRevisions.set(JSON.stringify([args.projectId, args.docId]), args);
  };
  const listeners = new Set<() => void>();
  const operations: string[] = [];
  let state: ReturnType<ProjectSaveIntegrityPort["getState"]> = { mode: "normal", diagnostic: null };
  const publish = (next: typeof state) => { state = Object.freeze(next); for (const listener of listeners) listener(); };
  const quarantine = (code: ProjectDurableDiagnostic["code"] = "project-quarantined", safetyCheckpointAvailable = false) => { retry.clear(); publish({ mode: "quarantine", diagnostic: {
    schemaVersion: 1, correlationId: globalThis.crypto.randomUUID(),
    code, safetyCheckpointAvailable, nextAction: "open-recovery",
  } }); };
  const assertWritable = () => {
    if (state.mode === "quarantine") throw projectProtectionError("project-quarantined", "Project is quarantined; open recovery before another save.");
    if (retry.getState()) throw projectProtectionError("retry-required", "Explicit save retry verification is required before another write.");
  };
  const port: ProjectSaveIntegrityPort = {
    getState: () => Object.freeze({ ...state, retry: retry.getState(), maintenance }),
    async prepareFailedSaveRetry() {
      if (!retryIO || operations.length) throw projectProtectionError("retry-unavailable", "This operation cannot be retried as an ordinary save.");
      try {
        const checked = await retry.check({ ...retryIO, onChecking: () => publish(state) });
        if (checked.kind === "candidate-committed" && checked.text !== null) await retryIO.adoptCandidate(checked.text);
        retry.clear();
        publish({ mode: "normal", diagnostic: null });
      } catch (error) {
        publish({ mode: "quarantine", diagnostic: { schemaVersion: 1, correlationId: crypto.randomUUID(), code: "project-baseline-changed", safetyCheckpointAvailable: false, nextAction: "retry" } });
        throw error;
      }
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    attachCanonicalRevision: args => { observe(args); return ledger.attachCanonicalRevision(args); },
    recordCanonicalRevision: args => { observe(args); return ledger.recordCanonicalRevision(args); },
    async beginDestructiveOperation(args) {
      if (args.projectId !== projectId()) throw projectProtectionError("identity-mismatch", "Destructive operation project does not match active file.");
      // A failed file must first be reloaded/inspected; an operation name alone
      // cannot authorize replacing an unknown or externally changed baseline.
      assertWritable();
      const scope = ledger.beginOperation(args);
      operations.push(scope.operationId);
      return { operationId: scope.operationId };
    },
    async finishDestructiveOperation({ operationId }) {
      const index = operations.indexOf(operationId);
      if (index < 0) throw projectProtectionError("operation-failed", "Unknown destructive operation.");
      operations.splice(index, 1);
      ledger.finishOperation(operationId);
    },
  };
  return {
    port, assertWritable, quarantine,
    setMaintenance(value: typeof maintenance) { maintenance = value; publish(state); },
    prepareExternalAdoption() {
      if (operations.length) throw projectProtectionError("operation-busy", "Cannot adopt an external baseline during an active destructive operation.");
      // Old Core revisions must never authorize edits in the replacement session.
      // The new session attaches fresh observations synchronously during commit.
      const previousLedger = ledger;
      const previousObservations = new Map(observedRevisions);
      ledger = new ProjectDestructiveLineageLedger();
      observedRevisions.clear();
      retry.clear();
      return () => {
        ledger = previousLedger;
        observedRevisions.clear();
        for (const [key, value] of previousObservations) observedRevisions.set(key, value);
      };
    },
    reset() {
      if (operations.length) throw projectProtectionError("operation-busy", "Cannot reset a disk baseline during an active destructive operation.");
      // A new verified disk baseline is not a continuation of old edit authority.
      // Reattach observation points without copying pending semantic targets.
      ledger = new ProjectDestructiveLineageLedger();
      retry.clear();
      for (const args of observedRevisions.values()) ledger.attachCanonicalRevision(args);
      publish({ mode: "normal", diagnostic: null });
    },
    assertExternalTransition(before: ProjectDurableDescriptor, after: ProjectDurableDescriptor) {
      assertWritable();
      // Local commands and import scopes are not evidence for an external writer.
      const decision = evaluateProjectDurableTransition({ before, after, isNewProject: false, hasDestructiveProof: false });
      if (!decision.allowed) {
        quarantine(decision.hardDiagnostics[0] ?? "project-destructive-proof-required");
        throw projectProtectionError(decision.hardDiagnostics[0] ?? "project-destructive-proof-required", "Unsafe external project transition blocked before live merge.");
      }
    },
    async withOperation<T>(
      args: Parameters<ProjectSaveIntegrityPort["beginDestructiveOperation"]>[0],
      task: () => Promise<T>,
    ): Promise<T> {
      const scope = await port.beginDestructiveOperation(args);
      let outcome: "success" | "failure" = "failure";
      try {
        const result = await task();
        outcome = "success";
        return result;
      } finally {
        await port.finishDestructiveOperation({ ...scope, outcome });
      }
    },
    async commit(args: {
      before: ProjectDurableDescriptor; after: ProjectDurableDescriptor;
      revision: string | null; changedDocIds: () => readonly DocumentId[];
      write: () => Promise<void>;
    }) {
      assertWritable();
      const initial = evaluateProjectDurableTransition({ before: args.before, after: args.after, isNewProject: false, hasDestructiveProof: false });
      const proof = initial.requiresDestructiveProof ? await ledger.beginAttempt({
        projectId: args.before.rootDocId, baselineRevision: args.revision,
        baselineFingerprint: args.before.fullFileFingerprint,
        candidateFullFingerprint: args.after.fullFileFingerprint,
        candidateSemanticFingerprint: args.after.docsSemanticFingerprint,
        candidateTargetDocIds: args.changedDocIds(),
        operationId: operations.at(-1) ?? null,
      }) : null;
      const decision = evaluateProjectDurableTransition({ before: args.before, after: args.after, isNewProject: false, hasDestructiveProof: proof !== null });
      if (!decision.allowed) {
        if (proof) ledger.finishAttempt({ proof, outcome: "failure" });
        quarantine(decision.hardDiagnostics[0] ?? "project-destructive-proof-required");
        throw projectProtectionError(decision.hardDiagnostics[0] ?? "project-destructive-proof-required", "Unsafe project transition blocked before disk write.");
      }
      try {
        await args.write();
      } catch (error) {
        if (proof) ledger.finishAttempt({ proof, outcome: "failure" });
        if (retryIO && operations.length === 0 && error instanceof ProjectSaveIOError) {
          retry.record({ error, sourceFingerprint: args.before.fullFileFingerprint, candidateFingerprint: args.after.fullFileFingerprint });
          publish({ mode: error.stage === "precommit" ? "normal" : "quarantine", diagnostic: {
            schemaVersion: 1, correlationId: crypto.randomUUID(), code: "project-write-readback-invalid",
            safetyCheckpointAvailable: error.safetyCheckpointAvailable, nextAction: "retry",
          } });
          throw error;
        }
        quarantine("project-write-readback-invalid", error instanceof ObsidianVerifiedSourceWriteError);
        throw error;
      }
      if (proof) ledger.finishAttempt({ proof, outcome: "success" });
      retry.clear();
      publish({ mode: "normal", diagnostic: null });
    },
  };
}
