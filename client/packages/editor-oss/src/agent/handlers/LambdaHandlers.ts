import {getScriptRevisionData} from "@stem/network/api/script";

import EngineRuntime from "../../EngineRuntime";
import type {LambdaComponentData, LambdaConfig, LambdaInstanceData} from "../../lambdas/Lambda";
import {traverseObjectDepthFirst} from "../../utils/SceneTraverser";
import {CommandResult} from "../types/ACPTypes";

type LambdaRegistryLike = {
    getAllConfigs?: () => LambdaConfig[];
    getAssetMeta?: (lambdaId: string) => {assetId: string; revisionId: string} | null;
    getConfig?: (lambdaId: string) => LambdaConfig | null;
};

export class LambdaHandlers {
    constructor(private engine: EngineRuntime) {}

    handleListLambdas({filter}: {filter?: string}): CommandResult {
        try {
            const registry = this.getRegistry();
            if (!registry?.getAllConfigs) {
                return {status: "failed", message: "Lambda registry not found", data: []};
            }

            const normalizedFilter = filter?.toLowerCase();
            const lambdas = registry.getAllConfigs().map(config => ({
                id: config.id,
                name: config.name,
                description: config.description,
                version: config.version,
                tags: config.tags,
                attributes: Object.keys(config.attributes ?? {}),
                componentSchema: Object.keys(config.componentSchema ?? {}),
            }));
            const filtered = normalizedFilter && normalizedFilter !== "*"
                ? lambdas.filter(lambda =>
                    lambda.id?.toLowerCase().includes(normalizedFilter) ||
                    lambda.name?.toLowerCase().includes(normalizedFilter))
                : lambdas;

            return {
                status: "success",
                message: `Retrieved ${filtered.length} lambdas (metadata only)`,
                data: filtered,
            };
        } catch (error) {
            return {
                status: "failed",
                message: `Error listing lambdas: ${error instanceof Error ? error.message : String(error)}`,
                data: [],
            };
        }
    }

    async handleGetLambda({
        includeCode = false,
        lambdaId,
    }: {
        includeCode?: boolean;
        lambdaId: string;
    }): Promise<CommandResult> {
        try {
            const registry = this.getRegistry();
            if (!registry?.getConfig) {
                return {status: "failed", message: "Lambda registry not found", data: null};
            }

            const config = registry.getConfig(lambdaId);
            if (!config) {
                return {status: "failed", message: `Lambda ${lambdaId} not found`, data: null};
            }

            const assetMeta = registry.getAssetMeta?.(lambdaId) ?? null;
            const data: Record<string, unknown> = {
                assetMeta,
                componentBindings: this.getObjectComponents(lambdaId),
                config,
                sceneInstances: this.getSceneInstances(lambdaId),
            };

            if (includeCode && assetMeta) {
                try {
                    data.code = (await getScriptRevisionData(assetMeta.assetId, assetMeta.revisionId)).code;
                } catch (error) {
                    data.codeError = error instanceof Error ? error.message : String(error);
                }
            }

            return {
                status: "success",
                message: `Retrieved lambda ${config.name} (${lambdaId}) successfully`,
                data,
            };
        } catch (error) {
            return {
                status: "failed",
                message: `Error getting lambda: ${error instanceof Error ? error.message : String(error)}`,
                data: null,
            };
        }
    }

    private getRegistry(): LambdaRegistryLike | undefined {
        return this.engine.editor?.lambdaConfigRegistry as unknown as LambdaRegistryLike | undefined;
    }

    private getSceneInstances(lambdaId: string): LambdaInstanceData[] {
        const instances = this.engine.scene?.userData?.lambdaInstances;
        if (!Array.isArray(instances)) return [];
        return instances.filter(instance => instance?.lambdaId === lambdaId);
    }

    private getObjectComponents(lambdaId: string): Array<{objectName: string; objectUuid: string; component: LambdaComponentData}> {
        const components: Array<{objectName: string; objectUuid: string; component: LambdaComponentData}> = [];
        if (!this.engine.scene) {
            return components;
        }

        traverseObjectDepthFirst(this.engine.scene, object => {
            const lambdaComponents = object.userData?.lambdaComponents;
            if (!Array.isArray(lambdaComponents)) return;
            for (const component of lambdaComponents) {
                if (component?.lambdaId === lambdaId) {
                    components.push({
                        objectName: object.name || object.type,
                        objectUuid: object.uuid,
                        component,
                    });
                }
            }
        });
        return components;
    }
}
