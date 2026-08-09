/**
 * Optional handler that fully replaces the cloud save flow. Set by the local
 * bootstrap to route saves through `getProjectStore().save()` (IndexedDB or
 * File System Access). When set, `saveScene` calls the handler instead of
 * the cloud path.
 */
export type SceneSaveHandler = (createThumbnail: boolean, shouldShowToast: boolean) => Promise<void>;

let sceneSaveHandler: SceneSaveHandler | null = null;

/**
 * Install a replacement handler for `saveScene`. Pass `null` to clear.
 * Idempotent: calling twice with the same handler is fine.
 *
 * The handler owns the entire save flow: serialization, persistence, UX
 * feedback, and event dispatch (`sceneSaveStart` / `sceneSaved` /
 * `sceneSaveFailed`). The cloud-flow guards in `saveScene` (read-only,
 * copilot preview block, stem editor redirect) are skipped; the handler is
 * responsible for any equivalents it needs.
 */
export const setSceneSaveHandler = (handler: SceneSaveHandler | null): void => {
    sceneSaveHandler = handler;
};

export const getSceneSaveHandler = (): SceneSaveHandler | null => sceneSaveHandler;
