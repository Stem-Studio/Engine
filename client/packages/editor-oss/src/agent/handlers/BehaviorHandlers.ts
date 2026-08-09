import * as THREE from "three";

import {Asset, AssetType} from "@stem/network/api/asset";
import {saveScene} from "@stem/network/api/scene";
import {
    getAssetResolutionContext,
    removeAssetRevision,
    resolveAssetRevisionId,
    setAssetRevision,
} from "../../asset-management/AssetResolutionContext";
import {BehaviorThrottleConfig} from "../../behaviors/Behavior";
import {BehaviorThrottlePriority} from "../../behaviors/performance/interfaces/IThrottleStrategy";
import {refreshEditorAssets} from "../../editor/asset-management/hooks/assets";
import {removeAssetInstancesFromScene} from "../../editor/asset-management/util/scene";
import BehaviorAttributeType from "../../editor/behaviors/BehaviorAttributeType";
import {BehaviorConfig} from "../../editor/behaviors/BehaviorConfig";
import {createBehavior, createBehaviorRevision} from "../../editor/behaviors/util";
import EngineRuntime from "../../EngineRuntime";
import global from "../../global";
import {findObjectByUuidOrNameDepthFirst, findObjectDepthFirst} from "../../utils/SceneTraverser";
import {queryClient} from "@web-shared/queryClient";
import {CommandResult} from "../types/ACPTypes";
import {getObjectBaseMetaData} from "../utils/serialization";
import {BehaviorCodeValidator} from "../validation/BehaviorCodeValidator";
import type {ValidationResult} from "../validation/types";

/**
 * Behavior command handlers for CommandsRegistry
 */
export class BehaviorHandlers {
    private readonly codeValidator = new BehaviorCodeValidator();

    constructor(private engine: EngineRuntime) {}

    handleListBehaviors({filter}: {filter?: string}): CommandResult {
        try {
            const behaviorConfigRegistry = this.engine.editor?.behaviorConfigRegistry;

            if (!behaviorConfigRegistry) {
                return {
                    status: "failed",
                    message: "Behavior registry not found",
                    data: [],
                };
            }

            const configs = behaviorConfigRegistry.getAllConfigs();

            filter = filter?.toLowerCase();
            if (filter === "*") {
                filter = undefined;
            }

            const behaviors = configs.map(config => {
                return {
                    id: config.id,
                    name: config.name,
                    description: config.description,
                    version: config.version,
                    author: config.author,
                };
            });

            const filtered = behaviors.filter(behavior => {
                if (!filter) return true;
                return behavior.id?.toLowerCase().includes(filter) || behavior.name?.toLowerCase().includes(filter);
            });

            return {
                status: "success",
                message: `Retrieved ${filtered.length} behaviors (metadata only)`,
                data: filtered,
            };
        } catch (error) {
            console.error("Error listing behaviors:", error);
            return {
                status: "failed",
                message: `Error listing behaviors: ${error instanceof Error ? error.message : String(error)}`,
                data: [],
            };
        }
    }

    handleGetBehavior({behaviorId}: {behaviorId: string}): CommandResult {
        try {
            const behaviorScriptRegistry = this.engine.editor?.behaviorScriptRegistry;
            const behaviorConfigRegistry = this.engine.editor?.behaviorConfigRegistry;

            if (!behaviorScriptRegistry || !behaviorConfigRegistry) {
                return {
                    status: "failed",
                    message: "Behavior registry not found",
                    data: null,
                };
            }

            const config = behaviorConfigRegistry.getConfig(behaviorId);
            const script = behaviorScriptRegistry.getScript(behaviorId);

            if (!config) {
                return {
                    status: "failed",
                    message: `Behavior ${behaviorId} not found`,
                    data: null,
                };
            }

            return {
                status: "success",
                message: `Retrieved behavior ${config.name} (${behaviorId}) successfully`,
                data: {
                    config,
                    code: script || "",
                },
            };
        } catch (error) {
            console.error("Error getting behavior:", error);
            return {
                status: "failed",
                message: `Error getting behavior: ${error instanceof Error ? error.message : String(error)}`,
                data: null,
            };
        }
    }

    async handleAddBehavior({
        name,
        code,
        metadata,
        version,
        description,
        author,
    }: {
        behaviorId: string;
        name: string;
        code: string;
        metadata?: Record<string, unknown>;
        version?: string;
        description?: string;
        author?: string;
    }): Promise<CommandResult> {
        try {
            const behaviorScriptRegistry = this.engine.editor?.behaviorScriptRegistry;
            const behaviorConfigRegistry = this.engine.editor?.behaviorConfigRegistry;

            if (!behaviorScriptRegistry || !behaviorConfigRegistry) {
                return {
                    status: "failed",
                    message: "Behavior registry not found",
                };
            }

            // Idempotent: update existing behavior if one with the same name exists
            const existingByName = behaviorConfigRegistry.getAllConfigs().find(c => c.name === name);
            if (existingByName) {
                return this.handleUpdateBehavior({
                    behaviorId: existingByName.id,
                    code,
                    metadata,
                    name,
                    version,
                    description,
                    author,
                });
            }

            const config: BehaviorConfig = {
                id: "",
                name: name,
                description: description || "",
                version: version || "1.0.0",
                author: author || "",
                isScript: true,
                main: "",
                attributes: {},
                ...metadata,
            };

            const validationRes = this.validateConfigAttributes(config.attributes);

            if (validationRes) {
                return validationRes;
            }

            const codeValidation = this.codeValidator.validate(code, "behavior");

            const newBehavior = await createBehavior({
                assetSource: global.app?.editor?.assetSource,
                name: config.name,
                code,
                config,
            });

            console.log(`[StudioACP] handleAddBehavior: `, config, newBehavior);

            return {
                status: "success",
                message: this.formatBehaviorMutationMessage(
                    `Behavior ${name} -> ${newBehavior.id} added successfully`,
                    codeValidation,
                ),
                data: {
                    behaviorId: newBehavior.id,
                    config,
                    ...this.buildCodeValidationData(codeValidation),
                },
            };
        } catch (error) {
            console.error("Error adding behavior:", error);
            return {
                status: "failed",
                message: `Failed to add behavior: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }

    async handleUpdateBehavior({
        behaviorId,
        code,
        metadata,
        name,
        version,
        description,
        author,
    }: {
        behaviorId: string;
        code: string;
        metadata?: Record<string, unknown>;
        name?: string;
        version?: string;
        description?: string;
        author?: string;
    }): Promise<CommandResult> {
        try {
            const scene = this.engine.scene;
            const behaviorScriptRegistry = this.engine.editor?.behaviorScriptRegistry;
            const behaviorConfigRegistry = this.engine.editor?.behaviorConfigRegistry;

            if (!behaviorScriptRegistry || !behaviorConfigRegistry) {
                return {
                    status: "failed",
                    message: "Behavior registry not found",
                };
            }

            const existingConfig = behaviorConfigRegistry.getConfig(behaviorId);
            if (!existingConfig) {
                return {
                    status: "failed",
                    message: `Behavior ${behaviorId} not found in registry`,
                };
            }

            const context = getAssetResolutionContext(scene);
            const currentRevisionId = context ? resolveAssetRevisionId(behaviorId, context) : undefined;

            if (!currentRevisionId) {
                return {
                    status: "failed",
                    message: `No revision found for behavior ${behaviorId}`,
                };
            }

            const config: BehaviorConfig = {
                ...existingConfig,
                ...(name && {name}),
                ...(description !== undefined && {description}),
                ...(version && {version}),
                ...(author && {author}),
                ...metadata,
            };

            const validationRes = this.validateConfigAttributes(config.attributes);

            if (validationRes) {
                return validationRes;
            }

            const codeValidation = this.codeValidator.validate(code, "behavior");

            // Signal the code editor to lock this behavior to readonly
            this.engine.call("copilotEditStart", this, {assetId: behaviorId});
            try {
                const newRevision = await createBehaviorRevision({
                    assetId: behaviorId,
                    parentRevisionId: currentRevisionId,
                    code,
                    config,
                    assetSource: this.engine.editor?.assetSource,
                    retryOnConflict: true,
                });

                if (this.engine.editor?.sceneID && this.engine.editor?.isCollaborative) {
                    await saveScene(false, false);
                }

                console.log(`[StudioACP] handleUpdateBehavior: `, config, newRevision);

                return {
                    status: "success",
                    message: this.formatBehaviorMutationMessage(
                        `Behavior ${behaviorId} updated successfully`,
                        codeValidation,
                    ),
                    data: {
                        id: behaviorId,
                        config,
                        sceneId: this.engine.editor?.sceneID ?? undefined,
                        revisionId: newRevision.id,
                        ...this.buildCodeValidationData(codeValidation),
                    },
                };
            } finally {
                this.engine.call("copilotEditEnd", this, {assetId: behaviorId});
            }
        } catch (error) {
            console.error("Error updating behavior:", error);
            return {
                status: "failed",
                message: `Failed to update behavior: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }

    async handleAttachBehavior({
        target,
        behaviorId,
        config,
    }: {
        target: string;
        behaviorId: string;
        config?: Record<string, unknown>;
    }): Promise<CommandResult> {
        const Commands = await import("../../command/Commands");
        const object = this.findObject(target);
        if (!object) {
            return {
                status: "error",
                message: `Object not found: ${target}`,
            };
        }

        // Idempotent: skip if behavior is already attached.
        // The script may reference the YAML alias (e.g. "pfsBlimp") while the
        // stored behavior data uses the server-assigned asset ID. Resolve the
        // alias through the config registry before comparing.
        const resolvedBehaviorId = this.engine.editor?.behaviorConfigRegistry?.getConfig(behaviorId)?.id || behaviorId;
        const existingBehavior = object.userData.behaviors?.find(
            (b: Record<string, unknown>) => b.id === resolvedBehaviorId || b.id === behaviorId,
        );
        if (existingBehavior) {
            return {
                status: "success",
                message: `Behavior ${behaviorId} already attached to ${target}, skipping`,
                data: getObjectBaseMetaData(object),
            };
        }

        // Idempotent for singletons: if the behavior already exists anywhere
        // in the scene, skip silently instead of showing an error toast.
        const bhvConfig = this.engine.editor?.behaviorConfigRegistry?.getConfig(resolvedBehaviorId);
        if (bhvConfig?.isSingleton) {
            const scene = this.engine.editor?.scene;
            const alreadyInScene = scene ? findObjectDepthFirst(scene, child => {
                const behaviors: Array<Record<string, unknown>> | undefined = child.userData.behaviors;
                return behaviors?.some(b => b.id === resolvedBehaviorId || b.id === behaviorId) ?? false;
            }) !== null : false;
            if (alreadyInScene) {
                return {
                    status: "success",
                    message: `Singleton behavior ${behaviorId} already exists in scene, skipping`,
                    data: getObjectBaseMetaData(object),
                };
            }
        }

        const resolvedConfig = await this.resolveAssetAttributes(resolvedBehaviorId, config || {});
        const highPriority: BehaviorThrottleConfig = {
            throttlePriority: BehaviorThrottlePriority.HIGH,
            enableFrustumCulling: false,
            enableDistanceThrottling: false,
            requiresConsistentUpdates: true,
        };
        const res = await new Commands.AttachBehaviorCommand(object, resolvedBehaviorId, {
            attributesData: resolvedConfig,
            throttleConfig: highPriority,
        }).execute();
        return {
            ...res,
            data: getObjectBaseMetaData(object),
        };
    }

    async handleAddNavMesh({
        target = "Default Scene",
        ...config
    }: {
        target?: string;
        enabled?: boolean;
        cellSize?: number;
        cellHeight?: number;
        agentHeight?: number;
        agentRadius?: number;
        agentMaxClimb?: number;
        agentMaxSlope?: number;
        regionMinSize?: number;
        regionMergeSize?: number;
        edgeMaxLen?: number;
        edgeMaxError?: number;
        vertsPerPoly?: number;
        detailSampleDist?: number;
        detailSampleMaxError?: number;
        autoGenerate?: boolean;
        onlyPhysicsMeshes?: boolean;
        debugVisualization?: boolean;
    }): Promise<CommandResult> {
        const object = this.findObject(target);
        if (!object) {
            return {
                status: "failed",
                message: `Object not found: ${target}`,
            };
        }

        const behaviorId = "navmesh";
        const attributesData = this.compactObject(config);
        const existingBehavior = object.userData.behaviors?.find(
            (b: Record<string, unknown>) => b.id === behaviorId,
        );

        if (existingBehavior) {
            return this.handleSetTargetBehaviorConfig({
                target,
                behaviorId,
                attributesData,
            });
        }

        return this.handleAttachBehavior({
            target,
            behaviorId,
            config: attributesData,
        });
    }

    handleRebuildNavMesh({target = "Default Scene"}: {target?: string}): CommandResult {
        const object = this.findObject(target);
        if (!object) {
            return {
                status: "failed",
                message: `Object not found: ${target}`,
            };
        }

        const navmesh = object.userData.behaviors?.find(
            (b: Record<string, unknown>) => b.id === "navmesh",
        );
        if (!navmesh) {
            return {
                status: "failed",
                message: `NavMesh behavior not found on ${target}`,
                data: null,
            };
        }

        this.engine.call("objectChanged", this, object);

        return {
            status: "success",
            message: `Triggered NavMesh rebuild for ${target}`,
            data: getObjectBaseMetaData(object),
        };
    }

    async handleAddNavMeshConnection({
        source,
        target,
        enabled,
        bidirectional,
        radius,
        showConnection,
    }: {
        source: string;
        target: string;
        enabled?: boolean;
        bidirectional?: boolean;
        radius?: number;
        showConnection?: boolean;
    }): Promise<CommandResult> {
        const sourceObject = this.findObject(source);
        if (!sourceObject) {
            return {
                status: "failed",
                message: `Source object not found: ${source}`,
            };
        }

        const targetObject = this.findObject(target);
        if (!targetObject) {
            return {
                status: "failed",
                message: `Target object not found: ${target}`,
            };
        }

        const config = this.compactObject({
            targetObject: targetObject.uuid,
            enabled,
            bidirectional,
            radius,
            showConnection,
        });
        const existingBehavior = sourceObject.userData.behaviors?.find(
            (b: Record<string, unknown>) => b.id === "navmesh-connection",
        );

        if (existingBehavior) {
            return this.handleSetTargetBehaviorConfig({
                target: source,
                behaviorId: "navmesh-connection",
                attributesData: config,
            });
        }

        return this.handleAttachBehavior({
            target: source,
            behaviorId: "navmesh-connection",
            config,
        });
    }

    async handleAddWaypointPath({
        name,
        position,
        rotation,
        scale,
        parent,
        loop,
    }: {
        name: string;
        position?: {x: number; y: number; z: number};
        rotation?: {x: number; y: number; z: number};
        scale?: {x: number; y: number; z: number};
        parent?: string;
        loop?: boolean;
    }): Promise<CommandResult> {
        const Commands = await import("../../command/Commands");
        const existing = this.findObject(name);

        if (existing) {
            if (position) existing.position.set(position.x ?? existing.position.x, position.y ?? existing.position.y, position.z ?? existing.position.z);
            if (rotation) existing.rotation.set(rotation.x ?? existing.rotation.x, rotation.y ?? existing.rotation.y, rotation.z ?? existing.rotation.z);
            if (scale) existing.scale.set(scale.x ?? existing.scale.x, scale.y ?? existing.scale.y, scale.z ?? existing.scale.z);
            existing.userData.aiWaypointPath = {
                ...(existing.userData.aiWaypointPath || {}),
                loop: loop ?? existing.userData.aiWaypointPath?.loop ?? true,
            };
            this.engine.call("objectChanged", this, existing);
            return {
                status: "success",
                message: `Waypoint path ${name} updated`,
                data: getObjectBaseMetaData(existing),
            };
        }

        const group = new THREE.Group();
        group.name = name;
        if (position) group.position.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);
        if (rotation) group.rotation.set(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0);
        if (scale) group.scale.set(scale.x ?? 1, scale.y ?? 1, scale.z ?? 1);
        group.userData.isSelectable = true;
        group.userData.aiWaypointPath = {
            loop: loop ?? true,
        };

        const parentObject = parent ? this.findObject(parent) || undefined : undefined;
        const res = await new Commands.AddObjectCommand(group, parentObject).execute();
        return {
            ...res,
            data: getObjectBaseMetaData(group),
        };
    }

    async handleAddWaypoint({
        path,
        name,
        position,
        order,
        waitTime,
        arrivalRadius,
    }: {
        path: string;
        name?: string;
        position: {x: number; y: number; z: number};
        order?: number;
        waitTime?: number;
        arrivalRadius?: number;
    }): Promise<CommandResult> {
        const Commands = await import("../../command/Commands");
        const pathObject = this.findObject(path);
        if (!pathObject) {
            return {
                status: "failed",
                message: `Waypoint path not found: ${path}`,
            };
        }

        const pathName = pathObject.name || path;
        const waypointIndex = order ?? pathObject.children.length;
        const waypointName = name || `${pathName}_waypoint_${waypointIndex + 1}`;
        const existing = this.findObject(waypointName);
        const metadata = {
            path: pathObject.uuid,
            pathName,
            order: waypointIndex,
            waitTime: waitTime ?? 0,
            arrivalRadius: arrivalRadius ?? 1,
        };

        if (existing) {
            existing.position.set(position.x ?? existing.position.x, position.y ?? existing.position.y, position.z ?? existing.position.z);
            existing.userData.aiWaypoint = metadata;
            this.engine.call("objectChanged", this, existing);
            return {
                status: "success",
                message: `Waypoint ${waypointName} updated`,
                data: getObjectBaseMetaData(existing),
            };
        }

        const geometry = new THREE.SphereGeometry(0.28, 16, 16);
        const material = new THREE.MeshBasicMaterial({color: 0xffd166});
        const marker = new THREE.Mesh(geometry, material);
        marker.name = waypointName;
        marker.position.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);
        marker.userData.isSelectable = true;
        marker.userData.gameVisibility = false;
        marker.userData.visibleByAI = true;
        marker.userData.aiWaypoint = metadata;

        const res = await new Commands.AddObjectCommand(marker, pathObject).execute();
        return {
            ...res,
            data: getObjectBaseMetaData(marker),
        };
    }

    async handleDetachBehavior({target, behaviorId}: {target: string; behaviorId: string}): Promise<CommandResult> {
        const Commands = await import("../../command/Commands");
        const object = this.findObject(target);
        if (!object) {
            return {
                status: "error",
                message: `Object not found: ${target}`,
            };
        }

        const res = new Commands.DetachBehaviorCommand(object, "", behaviorId).execute();
        return res;
    }

    async handleRemoveBehavior({behaviorId}: {behaviorId: string}): Promise<CommandResult> {
        try {
            const assetSource = this.engine.editor?.assetSource;
            if (!assetSource) {
                return {
                    status: "failed",
                    message: "Asset source not found",
                };
            }

            const editor = this.engine.editor;
            const scene = this.engine.scene;
            const behaviorScriptRegistry = editor?.behaviorScriptRegistry;
            const behaviorConfigRegistry = editor?.behaviorConfigRegistry;

            if (!editor || !scene) {
                return {
                    status: "failed",
                    message: "Editor or scene not found",
                };
            }

            if (!behaviorScriptRegistry || !behaviorConfigRegistry) {
                return {
                    status: "failed",
                    message: "Behavior registry not found",
                };
            }

            // Remove behavior instances from all scene objects
            await removeAssetInstancesFromScene(editor, scene, [behaviorId]);

            // Remove from scene's asset resolution context
            removeAssetRevision(scene, behaviorId);
            this.engine.call("objectChanged", null, scene);

            // Persist changes
            await saveScene(false, false);

            // Remove from registries
            behaviorConfigRegistry.unregisterConfig(behaviorId);
            behaviorScriptRegistry.unregisterScript(behaviorId);

            await refreshEditorAssets(queryClient, assetSource);

            return {
                status: "success",
                message: `Behavior ${behaviorId} removed successfully`,
            };
        } catch (error) {
            console.error("Error removing behavior:", error);
            return {
                status: "failed",
                message: `Failed to remove behavior: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }

    async handleSetTargetBehaviorConfig({
        target,
        behaviorId,
        attributesData = {},
        config,
        enabled,
    }: {
        target: string;
        behaviorId: string;
        attributesData?: Record<string, unknown>;
        config?: Record<string, unknown>;
        enabled?: boolean;
    }): Promise<CommandResult> {
        const object = this.findObject(target);
        if (!object) throw new Error(`Object not found: ${target}`);

        const resolvedBehaviorId = this.engine.editor?.behaviorConfigRegistry?.getConfig(behaviorId)?.id || behaviorId;
        attributesData = await this.resolveAssetAttributes(resolvedBehaviorId, {
            ...(config || {}),
            ...attributesData,
        });

        const behavior = object.userData.behaviors?.find(
            (b: Record<string, unknown>) => b.id === resolvedBehaviorId || b.id === behaviorId,
        );
        if (!behavior) {
            return {
                status: "failed",
                message: `Behavior ${behaviorId} not found on object ${target}`,
                data: null,
            };
        }

        behavior.attributesData = {...behavior.attributesData, ...attributesData};
        behavior.enabled = enabled ?? behavior.enabled;

        this.engine.call("objectChanged", this, object);

        return {
            status: "success",
            message: `Behavior ${behaviorId} on object ${target} updated successfully`,
            data: getObjectBaseMetaData(object),
        };
    }

    private async resolveAssetAttributes(
        behaviorId: string,
        attributesData: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        const behaviorConfigRegistry = this.engine.editor?.behaviorConfigRegistry;
        if (!behaviorConfigRegistry) return attributesData;

        const config = behaviorConfigRegistry.getConfig(behaviorId);
        if (!config?.attributes) return attributesData;

        const assetTypeMap: Record<string, (typeof AssetType)[keyof typeof AssetType]> = {
            audioAsset: AssetType.Audio,
            imageAsset: AssetType.Image,
            image: AssetType.Image,
            modelAsset: AssetType.Model,
            videoAsset: AssetType.Video,
            prefab: AssetType.Prefab,
            fileAsset: AssetType.File,
        };

        const resolved = {...attributesData};
        const scene = this.engine.scene;
        const assetSource = this.engine.editor?.assetSource;
        if (!assetSource) return resolved;

        for (const key of Object.keys(resolved)) {
            const value = resolved[key];
            if (typeof value !== "string" || value === "") continue;

            const attrDef = config.attributes[key];
            if (!attrDef) continue;

            const queryAssetType = assetTypeMap[attrDef.type];
            if (!queryAssetType) continue;

            const {assets} = await assetSource.getAssets({types: [queryAssetType]});
            const match = assets?.find((a: Asset) => a.name.toLowerCase() === value.toLowerCase());

            if (match) {
                const context = getAssetResolutionContext(scene);
                const revisionId =
                    (context ? resolveAssetRevisionId(match.id, context) : undefined) || match.headRevisionId;
                resolved[key] = {
                    assetId: match.id,
                    revisionId,
                };
                // Pin the resolved asset as a scene dependency. The behavior
                // attribute now holds a real asset id, but `resolveAssetRef`
                // re-derives the revision from the scene's
                // `assetIdToRevisionId` map on every load. If this asset is
                // only referenced by the behavior (not added to the scene as
                // its own object), nothing else registers the dependency —
                // so after save/reload the ref fails to resolve and the
                // behavior loads without the model. Registering it here
                // ensures `saveScene` persists it in `Dependencies`.
                if (scene && revisionId) {
                    setAssetRevision(scene, match.id, revisionId);
                }
            }
        }

        return resolved;
    }

    private findObject(identifier: string): THREE.Object3D | null {
        return findObjectByUuidOrNameDepthFirst(this.engine.scene, identifier);
    }

    private validateConfigAttributes = (attributesData?: Record<string, unknown>) => {
        if (attributesData) {
            for (const key of Object.keys(attributesData)) {
                const value = attributesData[key] as any;

                if (!this.engine.editor?.behaviorAttributeConverter.getAttributeConverter(value.type)) {
                    return {
                        message: `No attribute converter found for attribute ${value.name}. See available attribute types in response data`,
                        status: "error",
                        data: Object.values(BehaviorAttributeType),
                    };
                }
            }
        }
        return null;
    };

    private compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
        return Object.fromEntries(
            Object.entries(value).filter(([, entry]) => entry !== undefined),
        ) as Partial<T>;
    }

    private formatBehaviorMutationMessage(baseMessage: string, codeValidation: ValidationResult): string {
        const parts: string[] = [];

        if (codeValidation.errorCount > 0) {
            parts.push(`${codeValidation.errorCount} code error(s)`);
        }

        if (codeValidation.warningCount > 0) {
            parts.push(`${codeValidation.warningCount} warning(s)`);
        }

        if (codeValidation.infoCount > 0) {
            parts.push(`${codeValidation.infoCount} info note(s)`);
        }

        if (parts.length === 0) {
            return baseMessage;
        }

        return `${baseMessage} with ${parts.join(", ")}`;
    }

    private buildCodeValidationData(codeValidation: ValidationResult): {codeValidation?: ValidationResult} {
        if (codeValidation.issues.length === 0) {
            return {};
        }

        return {
            codeValidation: {
                valid: codeValidation.valid,
                errorCount: codeValidation.errorCount,
                warningCount: codeValidation.warningCount,
                infoCount: codeValidation.infoCount,
                issues: codeValidation.issues,
            },
        };
    }
}
