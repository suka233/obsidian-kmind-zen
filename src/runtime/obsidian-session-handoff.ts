// Vault and TFile identity survive leaf replacement and file rename. No document data is owned here.
const closingByVault = new WeakMap<object, Map<object, Set<Promise<void>>>>();

export function registerObsidianSessionClose(vault: object, file: object, pending: Promise<void>): void {
  let files = closingByVault.get(vault);
  if (!files) closingByVault.set(vault, files = new Map());
  let jobs = files.get(file);
  if (!jobs) files.set(file, jobs = new Set());
  jobs.add(pending);
  // Observe rejection now, even if no replacement view is opened.
  void pending.then(() => {
    jobs.delete(pending);
    if (!jobs.size) files.delete(file);
  }, error => {
    // A failed close remains visible to a replacement reader; never silently adopt stale disk state.
    console.error("[kmind-zen] session close failed", error);
  });
}

export async function waitForObsidianSessionClose(vault: object, file: object): Promise<void> {
  for (;;) {
    const jobs = closingByVault.get(vault)?.get(file);
    if (!jobs?.size) return;
    await Promise.all([...jobs]);
  }
}
