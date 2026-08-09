type AmmoFactory = typeof import("ammo").default;
export type AmmoModule = ReturnType<AmmoFactory>;

export interface AmmoInitOptions {
    locateFile?: (path: string) => string;
}

const AMMO_GLOBAL_KEY = "__erthAmmo__";

let ammoPromise: Promise<AmmoModule> | null = null;

export const getCachedAmmo = (): AmmoModule | undefined => {
    return (globalThis as Record<string, unknown>)[AMMO_GLOBAL_KEY] as AmmoModule | undefined;
};

/**
 * Initialize the Ammo.js physics engine.
 * 
 * @returns A promise that resolves to the Ammo.js physics engine.
 */
export const teardownAmmo = (): void => {
    ammoPromise = null;
    delete (globalThis as Record<string, unknown>)[AMMO_GLOBAL_KEY];
};

export const initAmmo = async (options: AmmoInitOptions = {}): Promise<AmmoModule> => {
    const cachedAmmo = getCachedAmmo();
    if (cachedAmmo) {
        return cachedAmmo;
    }

    if (!ammoPromise) {
        ammoPromise = (async () => {
            // Import the package-local checked-in WASM build directly. The historical
            // `ammo.js` npm package exports a pre-initialized object rather
            // than the factory used by our typed/runtime contract, which
            // makes `default(...)` fail under Node/Vitest and can silently
            // select a stale backend in other bundlers.
            const module = await import("../../../assets/js/ammo/ammo.wasm.js");
            const defaultExport = module.default as unknown;
            // Accept one additional default wrapper for Vite/Vitest interop
            // while still rejecting the legacy preinitialized object.
            const factory = (typeof defaultExport === "function"
                ? defaultExport
                : (defaultExport as {default?: unknown} | null)?.default) as AmmoFactory | undefined;
            if (typeof factory !== "function") {
                throw new TypeError("The checked-in Ammo WASM module must export a factory function");
            }
            const ammo = await factory({
                locateFile: options.locateFile ?? ((path: string) => `/assets/js/ammo/${path}`),
            });
            (globalThis as Record<string, unknown>)[AMMO_GLOBAL_KEY] = ammo;
            return ammo;
        })() as unknown as Promise<AmmoModule>;
    }

    return ammoPromise;
};
