/**
 * A write attempted by a view without the edit lease: another view of this file edits it. The
 * attempt is refused and nothing is written; it is not a data-safety failure and never
 * quarantines the project.
 */
export class ObsidianReadOnlyViewError extends Error {
  constructor() {
    super("This view is read-only: another view is editing this file.");
    this.name = "ObsidianReadOnlyViewError";
  }
}
