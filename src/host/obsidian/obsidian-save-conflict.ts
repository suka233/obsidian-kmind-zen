/**
 * The project file changed on disk since this session loaded or last saved it: an ordinary
 * concurrent-edit conflict, resolved through the conflict dialog. It never quarantines the
 * project; its message keeps the "Save conflict detected" prefix the dialog listens for.
 */
export class ObsidianSaveConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObsidianSaveConflictError";
  }
}
