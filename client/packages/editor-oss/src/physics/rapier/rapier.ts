let rapierInitPromise: Promise<void> | null = null;

export const teardownRapier = (): void => {
    // Rapier's ESM/WASM singleton cannot be unloaded from a browser realm.
    // Clearing this promise makes the next Play session call `init()` again,
    // which the compat package rejects as "already initialized". Physics
    // worlds are still disposed by their engine instances; keep the module
    // initialization promise reusable across Play/Edit lifetimes.
};

export const initRapier = async () => {
    if (!rapierInitPromise) {
        rapierInitPromise = import("@dimforge/rapier3d-compat").then(async (mod) => {
            await mod.default.init();
        });
    }
    return rapierInitPromise;
};
