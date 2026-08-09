import type {LambdaConfig, LambdaConstructor} from "./Lambda";

const LAMBDAS_FOLDER = "./packs";

interface LambdaModule {
    default: LambdaConstructor;
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

export class LambdaFileLoader {
    private modules: Record<string, () => Promise<LambdaModule>>;
    private eagerConfigs: Record<string, LambdaConfig>;
    private pathToModuleMap: Map<string, string> = new Map();
    private configPathMap: Map<string, string> = new Map();

    constructor() {
        // Only treat actual lambda entry files as lazy modules. Support files
        // like kernels should stay internal to their pack chunks.
        this.modules = import.meta.glob<LambdaModule>([
            "./packs/**/*Lambda.ts",
            "!./packs/fusedPhysics/FusedPhysicsLambda.ts",
        ]);
        this.eagerConfigs = import.meta.glob<LambdaConfig>(`./packs/**/lambda.json`, {eager: true});
        this.buildPathMap();
    }

    private buildPathMap(): void {
        for (const moduleKey of Object.keys(this.modules)) {
            const pathMatch = moduleKey.match(/\.\/packs\/(.+)/);
            if (pathMatch) {
                const relativePath = `./packs/${pathMatch[1]}`;
                this.pathToModuleMap.set(relativePath, moduleKey);
            }
        }
        for (const configKey of Object.keys(this.eagerConfigs)) {
            const pathMatch = configKey.match(/\.\/packs\/([^/]+)\/lambda\.json/);
            if (pathMatch && pathMatch[1]) {
                this.configPathMap.set(pathMatch[1], configKey);
            }
        }
    }

    /** Returns all built-in lambda configs synchronously (eagerly loaded at import time) */
    getEagerConfigs(): Array<{folder: string; config: LambdaConfig}> {
        const results: Array<{folder: string; config: LambdaConfig}> = [];
        for (const [path, mod] of Object.entries(this.eagerConfigs)) {
            const pathMatch = path.match(/\.\/packs\/([^/]+)\/lambda\.json/);
            if (pathMatch && pathMatch[1]) {
                const config = (mod as LambdaConfig & {default?: LambdaConfig}).default ?? mod;
                results.push({folder: pathMatch[1], config});
            }
        }
        return results;
    }

    async loadFile(folder: string, main: string): Promise<LambdaConstructor | null> {
        const path = `${LAMBDAS_FOLDER}/${folder}/${main}`;

        const moduleKey = this.pathToModuleMap.get(path);
        if (!moduleKey) {
            console.error(`[LambdaFileLoader] No module found for path "${path}"`);
            return null;
        }

        try {
            const loader = this.modules[moduleKey];
            if (!loader) {
                console.error(`[LambdaFileLoader] No loader found for module key "${moduleKey}"`);
                return null;
            }
            const module = await loader();
            if (!module) {
                console.error(`[LambdaFileLoader] Failed to load module for path "${path}"`);
                return null;
            }
            return module.default;
        } catch (error) {
            console.error(`[LambdaFileLoader] Failed to load file "${path}". Error:`, error);
            return null;
        }
    }

    async loadLambdasBatch(
        lambdaPaths: Array<{ folder: string; main: string }>,
        batchSize: number = 5,
    ): Promise<Array<LambdaConstructor | null>> {
        const results: Array<LambdaConstructor | null> = [];

        for (let i = 0; i < lambdaPaths.length; i += batchSize) {
            const batch = lambdaPaths.slice(i, i + batchSize);
            const batchResults = await Promise.all(
                batch.map(({folder, main}) => this.loadFile(folder, main)),
            );
            results.push(...batchResults);
            if (i + batchSize < lambdaPaths.length) {
                await yieldToPaint();
            }
        }

        return results;
    }

    hasLambda(folder: string, main: string): boolean {
        const path = `${LAMBDAS_FOLDER}/${folder}/${main}`;
        return this.pathToModuleMap.has(path);
    }

    getAvailableLambdas(): Array<{ folder: string; main: string; path: string }> {
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
            .filter(Boolean) as Array<{ folder: string; main: string; path: string }>;
    }

    async loadAllBuiltInPacks(): Promise<Array<{ config: LambdaConfig; cls: LambdaConstructor }>> {
        const results: Array<{ config: LambdaConfig; cls: LambdaConstructor }> = [];

        for (const [folder, configKey] of this.configPathMap.entries()) {
            try {
                const configModule = this.eagerConfigs[configKey];
                if (!configModule) continue;

                const config = (configModule as LambdaConfig & {default?: LambdaConfig}).default ?? configModule;

                const cls = await this.loadFile(folder, config.main);
                if (!cls) {
                    console.error(`[LambdaFileLoader] Failed to load class for pack "${folder}"`);
                    continue;
                }

                results.push({config, cls});
                await yieldToPaint();
            } catch (error) {
                console.error(`[LambdaFileLoader] Failed to load pack "${folder}":`, error);
            }
        }

        return results;
    }
}
