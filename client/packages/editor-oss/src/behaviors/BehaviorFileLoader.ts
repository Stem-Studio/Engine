import {BehaviorConstructor} from "./Behavior";

const BEHAVIORS_FOLDER = "./packs";

interface BehaviorModule {
    default: BehaviorConstructor;
}

const yieldToPaint = (): Promise<void> =>
    new Promise(resolve => {
        const finish = () => setTimeout(() => resolve(), 0);
        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => finish());
        } else {
            finish();
        }
    });

export class BehaviorFileLoader {
    private modules: Record<string, () => Promise<BehaviorModule>>;
    private pathToModuleMap: Map<string, string> = new Map();

    constructor(useEditorPath: boolean = false) {
        // Only lazy-load pack entry files. Globbing every TS file turns helper
        // modules into async entrypoints and defeats chunking.
        if (useEditorPath) {
            this.modules = import.meta.glob<BehaviorModule>([
                "../behaviors/packs/**/*Behavior.ts",
                "../behaviors/packs/**/TouchControls.ts",
            ]);
        } else {
            this.modules = import.meta.glob<BehaviorModule>([
                "./packs/**/*Behavior.ts",
                "./packs/**/TouchControls.ts",
            ]);
        }

        // Build a reverse map path -> moduleKey for fast O(1) lookup
        this.buildPathMap();
    }

    /**
     * Build a reverse map path -> moduleKey for fast O(1) lookup
     */
    private buildPathMap(): void {
        for (const moduleKey of Object.keys(this.modules)) {
            // Extract relative path from the module key
            const pathMatch = moduleKey.match(/\.\/packs\/(.+)/) || moduleKey.match(/\.\.\/behaviors\/packs\/(.+)/);
            if (pathMatch) {
                const relativePath = `./packs/${pathMatch[1]}`;
                this.pathToModuleMap.set(relativePath, moduleKey);
            }
        }
    }

    async loadFile(folder: string, main: string): Promise<BehaviorConstructor | null> {
        const path = `${BEHAVIORS_FOLDER}/${folder}/${main}`;

        // Use fast lookup via Map O(1)
        const moduleKey = this.pathToModuleMap.get(path);

        if (!moduleKey) {
            console.error(`[BehaviorFileLoader] No module found for path "${path}"`);
            return null;
        }

        try {
            // Vite caches modules, repeated import() is instant
            const modulePrototype = this.modules[moduleKey];
            if (!modulePrototype) {
                return null;
            }
            const module = await modulePrototype();
            if (!module) {
                console.error(`[BehaviorFileLoader] Failed to load module for path "${path}"`);
                return null;
            }

            return module.default;
        } catch (error) {
            console.error(`[BehaviorFileLoader] Failed to load file "${path}". Error:`, error);
            return null;
        }
    }

    /**
     * Preload critical behaviors
     * Runs in parallel for maximum speed
     * @param behaviorPaths
     */
    async preloadBehaviors(behaviorPaths: Array<{folder: string; main: string}>): Promise<void> {
        const preloadPromises = behaviorPaths.map(({folder, main}) => this.loadFile(folder, main));

        await Promise.all(preloadPromises);
        console.log(`[BehaviorFileLoader] Preloaded ${behaviorPaths.length} behaviors in parallel`);
    }

    /**
     * Batch load behaviors with parallelism limit
     * Prevents overload when loading many behaviors
     * @param behaviorPaths
     * @param batchSize
     */
    async loadBehaviorsBatch(
        behaviorPaths: Array<{folder: string; main: string}>,
        batchSize: number = 5,
    ): Promise<Array<BehaviorConstructor | null>> {
        if (behaviorPaths.length === 0) {
            return [];
        }

        const results: Array<BehaviorConstructor | null> = new Array(behaviorPaths.length).fill(null);
        const workerCount = Math.max(1, Math.min(Math.floor(batchSize), behaviorPaths.length));
        let nextIndex = 0;

        const runWorker = async () => {
            while (nextIndex < behaviorPaths.length) {
                const index = nextIndex++;
                const {folder, main} = behaviorPaths[index]!;
                results[index] = await this.loadFile(folder, main);

                if (nextIndex < behaviorPaths.length) {
                    await yieldToPaint();
                }
            }
        };

        await Promise.all(Array.from({length: workerCount}, runWorker));

        console.log(`[BehaviorFileLoader] Loaded ${behaviorPaths.length} behaviors with concurrency ${workerCount}`);
        return results;
    }

    /**
     * Check if a behavior is available without loading it
     * Fast existence check for a behavior
     * @param folder
     * @param main
     */
    hasBehavior(folder: string, main: string): boolean {
        const path = `${BEHAVIORS_FOLDER}/${folder}/${main}`;
        return this.pathToModuleMap.has(path);
    }

    /**
     * Get a list of all available behaviors
     * Useful for UI and validation
     */
    getAvailableBehaviors(): Array<{folder: string; main: string; path: string}> {
        return Array.from(this.pathToModuleMap.entries())
            .map(([path]) => {
                const pathMatch = path.match(/\.\/packs\/(.+)\/(.+)/);
                if (pathMatch) {
                    return {
                        folder: pathMatch[1],
                        main: pathMatch[2],
                        path: path,
                    };
                }
                return null;
            })
            .filter(Boolean) as Array<{folder: string; main: string; path: string}>;
    }
}
