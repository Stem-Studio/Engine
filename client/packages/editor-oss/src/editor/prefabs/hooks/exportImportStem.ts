import {Object3D} from "three";

import {AssetType, getAssetRevision} from "@stem/network/api/asset";
import {getBehaviorRevisionData} from "@stem/network/api/behavior";
import {getLambdaRevisionData} from "@stem/network/api/lambda";
import {getScriptRevisionData} from "@stem/network/api/script";
import {getAssetResolutionContext, resolveAssetRevisionId} from "@stem/editor-oss/asset-management/AssetResolutionContext";
import {useAssetSource} from "@stem/editor-oss/context/AssetSourceContext";
import global from "@stem/editor-oss/global";
import {getPrefabId} from "@stem/editor-oss/prefab/util";
import {remapScriptImportSpecifiers} from "../../../script-runtime/scriptImportCore";
import {showToast} from "@stem/editor-oss/showToast";
import {useCreateAssetWithData, useGetAsset} from "../../asset-management/hooks/assets";
import {
    exportStem,
    importStemFile,
    type EmbeddedBehavior,
    type EmbeddedImport,
    type EmbeddedLambda,
} from "../../assets/v2/AssetsLibrary/exportImportUtils";
import { BehaviorConfig } from '../../behaviors/BehaviorConfig';
import {createBehavior} from "../../behaviors/util";
import {useCreateLambda} from "../../lambdas/hooks/lambdas";
import {useCreateScript} from "../../scripts/hooks/scripts";

const LOCAL_ASSET_URL_PATTERN = /(localhost|minio)/i;

const normalizeTunnelOrigin = (input: string | null): string | null => {
    if (!input) return null;
    const trimmed = input.trim();
    if (!trimmed) return null;
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
        const parsed = new URL(withProtocol);
        return `${parsed.protocol}//${parsed.host}`;
    } catch {
        return null;
    }
};

export const useExportStem = () => {
    const getAsset = useGetAsset();

    return async (object: Object3D) => {
        const prefabId = getPrefabId(object);
        if (!prefabId) {
            showToast({type: "error", title: "Object is not a stem"});
            return;
        }

        try {
            const asset = await getAsset(prefabId);
            const context = getAssetResolutionContext(object, true);
            const revisionId = context ? resolveAssetRevisionId(prefabId, context) : asset.headRevisionId;
            if (!revisionId) {
                showToast({type: "error", title: "Could not resolve stem revision"});
                return;
            }

            const revision = await getAssetRevision(prefabId, revisionId, {
                includeDataUrl: true,
                includeDependencies: true,
                includeMetadata: true,
            });

            if (!revision.dataUrl) {
                showToast({type: "error", title: "Stem has no data"});
                return;
            }

            // Fetch serialized prefab data
            const dataResponse = await fetch(revision.dataUrl);
            const data = await dataResponse.text();

            // Build asset resolution context from revision metadata
            const logicalIdToAssetId: Record<string, string> =
                (revision.metadata as any)?.logicalAssetIdMap || {};
            const assetIdToRevisionId: Record<string, string> =
                revision.dependencies || {};

            // Embed behavior, lambda, and import dependencies
            const behaviors: EmbeddedBehavior[] = [];
            const lambdas: EmbeddedLambda[] = [];
            const imports: EmbeddedImport[] = [];
            const visited = new Set<string>();

            const collectScriptDeps = async (assetId: string, revisionId: string) => {
                const key = `${assetId}:${revisionId}`;
                if (visited.has(key)) return;
                visited.add(key);

                const scriptRevision = await getAssetRevision(assetId, revisionId, {
                    includeDependencies: true,
                });

                for (const [depAssetId, depRevisionId] of Object.entries(scriptRevision.dependencies || {})) {
                    const depAsset = await getAsset(depAssetId);
                    if (depAsset.type !== AssetType.Script) {
                        continue;
                    }

                    const existing = imports.find(item => item.originalAssetId === depAssetId);
                    if (!existing) {
                        const {code} = await getScriptRevisionData(depAssetId, depRevisionId);
                        imports.push({originalAssetId: depAssetId, name: depAsset.name, code});
                    }

                    await collectScriptDeps(depAssetId, depRevisionId);
                }
            };

            for (const [depAssetId, depRevisionId] of Object.entries(assetIdToRevisionId)) {
                try {
                    const depAsset = await getAsset(depAssetId);
                    if (depAsset.type === AssetType.Behavior) {
                        const {config, code} = await getBehaviorRevisionData(depAssetId, depRevisionId);
                        behaviors.push({originalAssetId: depAssetId, name: depAsset.name, config, code});
                        await collectScriptDeps(depAssetId, depRevisionId);
                    } else if (depAsset.type === AssetType.Lambda) {
                        const {config, code} = await getLambdaRevisionData(depAssetId, depRevisionId);
                        lambdas.push({originalAssetId: depAssetId, name: depAsset.name, config: config, code});
                        await collectScriptDeps(depAssetId, depRevisionId);
                    } else if (depAsset.type === AssetType.Script) {
                        const {code} = await getScriptRevisionData(depAssetId, depRevisionId);
                        imports.push({originalAssetId: depAssetId, name: depAsset.name, code});
                        await collectScriptDeps(depAssetId, depRevisionId);
                    }
                    // Models and nested prefabs are skipped (binary data can't be embedded)
                } catch (err) {
                    console.warn(`Failed to embed dependency ${depAssetId}`, err);
                }
            }

            const sourceServer = global.app?.options?.server;

            exportStem(
                asset.name,
                data,
                {logicalIdToAssetId, assetIdToRevisionId},
                {behaviors, lambdas, imports},
                sourceServer,
            );

            showToast({type: "success", title: `Stem "${asset.name}" exported`});
        } catch (err: any) {
            showToast({type: "error", title: err.message || "Failed to export stem"});
            console.error("Export stem failed", err);
        }
    };
};

export const useImportStem = () => {
    const createLambda = useCreateLambda();
    const createImport = useCreateScript();
    const createAssetWithData = useCreateAssetWithData();
    const assetSource = useAssetSource() ?? undefined;

    return async (file: File) => {
        const result = await importStemFile(file);

        // Cross-server localhost URL rewriting
        let processedData = result.data;
        const currentServer = global.app?.options?.server;
        const isCrossServer = result.sourceServer && currentServer && result.sourceServer !== currentServer;

        if (isCrossServer) {
            try {
                const parsed = JSON.parse(processedData) as any[];
                const hasLocalhostUrls = parsed.some((item: any) => {
                    if (item?.metadata?.generator === "ServerObject" && item?.userData?.Url) {
                        return LOCAL_ASSET_URL_PATTERN.test(item.userData.Url);
                    }
                    return false;
                });

                if (hasLocalhostUrls) {
                    const shouldSetup = window.confirm(
                        "This stem contains localhost/minio asset URLs. Would you like to set up a remote tunnel so these assets can be imported?",
                    );

                    if (!shouldSetup) {
                        throw new Error("Import cancelled: tunnel setup declined");
                    }

                    const tunnelInput = window.prompt(
                        [
                            "Set up an ngrok reverse proxy tunnel, then enter your ngrok domain:",
                            "",
                            "1. Start your local asset server (for example MinIO on port 9000).",
                            "2. Run: ngrok http --host-header=rewrite http://localhost:9000",
                            "3. Copy the generated URL (example: https://abcd-1234.ngrok-free.app).",
                            "",
                            "Enter ngrok domain:",
                        ].join("\n"),
                    );

                    const tunnelOrigin = normalizeTunnelOrigin(tunnelInput);
                    if (!tunnelOrigin) {
                        throw new Error("Import cancelled: invalid tunnel URL");
                    }

                    for (const item of parsed) {
                        if (item?.metadata?.generator === "ServerObject" && typeof item?.userData?.Url === "string") {
                            if (LOCAL_ASSET_URL_PATTERN.test(item.userData.Url)) {
                                try {
                                    const url = new URL(item.userData.Url);
                                    item.userData.Url = `${tunnelOrigin}${url.pathname}${url.search}${url.hash}`;
                                } catch {
                                    // skip invalid URLs
                                }
                            }
                        }
                    }
                    processedData = JSON.stringify(parsed);
                }
            } catch (err: any) {
                if (err.message?.startsWith("Import cancelled")) throw err;
                // If JSON parse fails, data isn't a JSON array with ServerObjects — continue as-is
            }
        }

        // Create new assets for embedded behaviors and lambdas, building old→new ID map
        const assetIdMap: Record<string, string> = {};
        const revisionIdMap: Record<string, string> = {};

        for (const importAsset of result.embeddedAssets.imports) {
            const rewrittenCode = remapScriptImportSpecifiers(importAsset.code, oldAssetId => assetIdMap[oldAssetId] || oldAssetId);
            const newAsset = await createImport({
                name: importAsset.name,
                code: rewrittenCode,
            });
            assetIdMap[importAsset.originalAssetId] = newAsset.id;
            revisionIdMap[importAsset.originalAssetId] = newAsset.headRevisionId;
        }

        for (const behavior of result.embeddedAssets.behaviors) {
            const newAsset = await createBehavior({
                assetSource,
                name: behavior.name,
                config: behavior.config as BehaviorConfig,
                code: remapScriptImportSpecifiers(behavior.code, oldAssetId => assetIdMap[oldAssetId] || oldAssetId),
            });
            assetIdMap[behavior.originalAssetId] = newAsset.id;
            revisionIdMap[behavior.originalAssetId] = newAsset.headRevisionId;
        }

        for (const lambda of result.embeddedAssets.lambdas) {
            const newAsset = await createLambda({
                name: lambda.name,
                config: JSON.stringify(lambda.config),
                code: remapScriptImportSpecifiers(lambda.code, oldAssetId => assetIdMap[oldAssetId] || oldAssetId),
            });
            assetIdMap[lambda.originalAssetId] = newAsset.id;
            revisionIdMap[lambda.originalAssetId] = newAsset.headRevisionId;
        }

        // Remap the asset resolution context
        const remappedLogicalIdToAssetId: Record<string, string> = {};
        for (const [logicalId, oldAssetId] of Object.entries(result.assetResolutionContext.logicalIdToAssetId)) {
            remappedLogicalIdToAssetId[logicalId] = assetIdMap[oldAssetId] || oldAssetId;
        }

        const remappedAssetIdToRevisionId: Record<string, string> = {};
        for (const [oldAssetId, oldRevId] of Object.entries(result.assetResolutionContext.assetIdToRevisionId)) {
            const newAssetId = assetIdMap[oldAssetId] || oldAssetId;
            const newRevId = revisionIdMap[oldAssetId] || oldRevId;
            remappedAssetIdToRevisionId[newAssetId] = newRevId;
        }

        // Create the prefab asset
        await createAssetWithData.mutateAsync({
            type: AssetType.Prefab,
            name: result.stemName,
            data: processedData,
            format: "json",
            contentType: "application/json",
            options: {
                dependencies: remappedAssetIdToRevisionId,
                metadata: {
                    logicalAssetIdMap: remappedLogicalIdToAssetId,
                },
            },
        });

        // Warn about unmapped dependencies (models/nested prefabs that weren't embedded)
        const unmappedDeps = Object.keys(result.assetResolutionContext.assetIdToRevisionId)
            .filter(id => !assetIdMap[id]);
        if (unmappedDeps.length > 0) {
            showToast({
                type: "warning",
                title: `${unmappedDeps.length} dependency(ies) could not be embedded (models/nested stems). They may be missing.`,
            });
        }

        showToast({type: "success", title: `Stem "${result.stemName}" imported`});
    };
};
