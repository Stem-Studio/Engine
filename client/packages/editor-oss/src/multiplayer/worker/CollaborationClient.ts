import {isEqual} from "lodash";
import {Object3D, Scene} from "three";

import {CollaborationEventQueue} from "./CollaborationEventQueue";
import {saveScene} from "@stem/network/api/scene";
import {AttachBehaviorCommand} from "@stem/editor-oss/command/behaviors/AttachBehaviorCommand";
import {DetachBehaviorCommand} from "@stem/editor-oss/command/behaviors/DetachBehaviorCommand";
import {refreshAsset, refreshEditorAssets} from "@stem/editor-oss/editor/asset-management/hooks/assets";
import {BehaviorConfig} from "@stem/editor-oss/editor/behaviors/BehaviorConfig";
import type {BehaviorThrottleConfig} from "@stem/editor-oss/behaviors/Behavior";
import {updateLambdaRegistries} from "@stem/editor-oss/editor/lambdas/util";
import {refreshDependentScriptsForScript} from "@stem/editor-oss/editor/scripts/util";
import type EngineRuntime from "@stem/editor-oss/EngineRuntime";
import global from "@stem/editor-oss/global";
import type {LambdaConfig} from "@stem/editor-oss/lambdas/Lambda";
import {SNAPSHOT_EVENTS, BEHAVIOR_EVENTS, ASSET_EVENTS, LAMBDA_EVENTS} from "@stem/editor-oss/physics/common/events";
import {isPrefab, isPrefabUnlocked} from "@stem/editor-oss/prefab/util";
import {queryClient} from "@web-shared/queryClient";
import {NoDeserializeSerializers} from "@stem/editor-oss/core/noDeserializeSerializers";
import {
    findObjectByUuidDepthFirst,
    traverseObjectDepthFirst,
} from "@stem/editor-oss/utils/SceneTraverser";
import {Behavior, Script} from "../GameRoomState";

const behaviorsToOmit = ["character", "csm", "terrain"];

type SceneChild = {
    uuid: string;
    children: SceneChild[];
};

/** Per-instance behavior data as stored on object.userData.behaviors. */
type SerializedBehaviorData = {
    uuid?: string;
    id?: string;
    attributesData?: Record<string, unknown>;
    throttleConfig?: BehaviorThrottleConfig;
};

/**
 * A serialized scene object as received over the multiplayer wire. It is the
 * JSON form of a THREE.Object3D plus collaboration bookkeeping fields.
 */
type Vec3Like = {x: number; y: number; z: number};
type QuatLike = {x: number; y: number; z: number; w: number};

type SnapshotObject = {
    uuid: string;
    userId?: string;
    parentUuid?: string;
    parent?: string;
    name?: string;
    type?: string;
    geometry?: {type?: string};
    metadata?: {generator?: string};
    position?: Vec3Like;
    quaternion?: QuatLike;
    scale?: Vec3Like;
    userData?: Record<string, unknown>;
    [key: string]: unknown;
};

/** Lambda instance entry stored on scene.userData lambda instance arrays. */
type SceneLambdaInstance = {
    instanceId?: string;
    lambdaId?: string;
    enabled?: boolean;
    attributes?: Record<string, unknown>;
};

type LambdaSyncPayload = {
    id: string;
    config?: LambdaConfig | string;
    assetId?: string;
    revisionId?: string;
    userId: string;
};

export class CollaborationClient {
    private engine: EngineRuntime = global.app as EngineRuntime;
    private selectedObjectUUID: string | null = null;
    private workerHandler: Worker | null;
    private syncCheckInterval: NodeJS.Timeout | null = null;
    private readonly SYNC_CHECK_INTERVAL_MS = 30000; // Check every 30 seconds
    private readonly POSITION_THRESHOLD = 0.001; // Position tolerance
    private readonly ROTATION_THRESHOLD = 0.001; // Rotation tolerance
    private readonly SCALE_THRESHOLD = 0.001; // Scale tolerance
    private inboundQueue: CollaborationEventQueue = new CollaborationEventQueue();
    private outboundQueue: CollaborationEventQueue = new CollaborationEventQueue(10_000, 50);

    private readonly AUTO_SAVE_INTERVAL_MS = 30000; // 30 seconds
    private readonly AUTO_SAVE_DEBOUNCE_MS = 2000; // 2 second debounce
    private autoSaveInterval: NodeJS.Timeout | null = null;
    private autoSaveDebounceTimer: NodeJS.Timeout | null = null;
    private autoSavePlayerAddedToken: string | null = null;
    private autoSavePlayerRemovedToken: string | null = null;
    private lockCleanupPlayerRemovedToken: string | null = null;

    constructor(workerHandler: Worker | null) {
        this.workerHandler = workerHandler;
        this.setupCollaborationListeners();
        this.startSyncCheck();
    }

    init = () => {
        const behaviors = this.engine.editor?.behaviorConfigRegistry?.getAllConfigs() || [];
        const scripts = this.engine.editor?.behaviorScriptRegistry?.getScripts() || {};
        const lambdas = this.engine.editor?.lambdaConfigRegistry?.getAllConfigs() || [];

        behaviors.forEach((config: BehaviorConfig) => {
            const behaviorObj = new Behavior(config.id, config, this.engine.userId || "");
            this.workerHandler?.postMessage({event: BEHAVIOR_EVENTS.REGISTER.BEHAVIOR, behavior: behaviorObj});
        });
        Object.keys(scripts).forEach(name => {
            const script = scripts[name];
            if (!script) return;
            const scriptObj = new Script(name, script, this.engine.userId || "");
            this.workerHandler?.postMessage({event: BEHAVIOR_EVENTS.REGISTER.SCRIPT, script: scriptObj});
        });
        lambdas.forEach((config: LambdaConfig) => {
            this.postLambdaEvent(LAMBDA_EVENTS.REGISTER, {id: config.id, config});
        });
    };

    // --- Handlers for messages from the worker ---
    onAssetAdd(): void {
        const assetSource = this.engine.editor?.assetSource;
        if (assetSource) {
            refreshEditorAssets(queryClient, assetSource).catch(console.error);
        }
        this.engine.editor?.loadBackendLambdaConfigs().catch(console.error);
        this.engine.editor?.loadBackendImportSources().catch(console.error);
    }

    onAssetRemove(assetId: string): void {
        refreshAsset(queryClient, assetId).catch(console.error);

        const assetSource = this.engine.editor?.assetSource;
        if (assetSource) {
            refreshEditorAssets(queryClient, assetSource).catch(console.error);
        }
        this.engine.editor?.loadBackendLambdaConfigs().catch(console.error);
        this.engine.editor?.loadBackendImportSources().catch(console.error);
    }

    onAssetUpdate(assetId: string): void {
        // We don't really know what changed, so we need to refresh everything
        refreshAsset(queryClient, assetId, {
            refreshDerivatives: true,
            refreshLists: true,
            refreshRevisions: true,
        }).catch(console.error);

        // Refresh the list of editor assets since the asset's head revision may
        // have changed
        const assetSource = this.engine.editor?.assetSource;
        if (assetSource) {
            refreshEditorAssets(queryClient, assetSource).catch(console.error);
        }

        this.engine.editor?.loadBackendLambdaConfigs().catch(console.error);
        this.engine.editor?.loadBackendImportSources().catch(console.error);
        refreshDependentScriptsForScript(assetId).catch(console.error);
    }

    onSnapshotObjectAdd(obj: SnapshotObject): void {
        if (!obj || obj?.userId === this.engine.userId || obj?.uuid === this.engine.scene.uuid) {
            return;
        }

        if (obj.userData?.isBillboardContent) return;

        if (findObjectByUuidDepthFirst(this.engine.scene, obj.uuid)) {
            return;
        }

        delete obj.userId;
        this.inboundQueue.enqueue({
            id: `add-${obj.uuid}-${Date.now()}`,
            type: "snapshot:add:object",
            uuid: obj.uuid,
            payload: obj,
            priority: "low",
            timestamp: Date.now(),
            handler: () => this.processObjectAdd(obj),
        });
    }

    private async processObjectAdd(obj: SnapshotObject): Promise<void> {
        if (findObjectByUuidDepthFirst(this.engine.scene, obj.uuid)) {
            return;
        }

        const sceneObject = await this.engine.editor?.deserializeObject(obj);

        if (sceneObject) {
            const parent = findObjectByUuidDepthFirst(this.engine.scene, obj.parentUuid) || this.engine.scene;
            parent.add(sceneObject);
            await this.addObjectBehaviors(sceneObject, sceneObject.userData?.behaviors || []);
            this.attachEditorBehaviorPlugins(sceneObject);
            await this.ensureLambdaInstancesForObject(sceneObject);
            this.engine.editor?.processParticleSystems(sceneObject);
            this.engine.call("objectUpdated", this, sceneObject);
        }
        this.engine.scene.updateMatrixWorld(true);
        this.engine.call("sceneUpdated", this, this.engine.scene);
        this.engine.call("sceneGraphChanged", this, this.engine.scene);
    }

    onSnapshotObjectRemove(obj: SnapshotObject): void {
        if (!obj || obj?.userId === this.engine.userId || obj?.uuid === this.engine.scene.uuid) {
            return;
        }

        delete obj.userId;
        this.inboundQueue.enqueue({
            id: `remove-${obj.uuid}-${Date.now()}`,
            type: "snapshot:remove:object",
            uuid: obj.uuid,
            payload: obj,
            priority: "high",
            timestamp: Date.now(),
            handler: () => this.processObjectRemove(obj),
        });
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    private async processObjectRemove(obj: SnapshotObject): Promise<void> {
        const sceneObject = findObjectByUuidDepthFirst(this.engine.scene, obj.uuid);
        if (sceneObject) {
            this.removeObjectBehaviors(sceneObject, sceneObject.userData?.behaviors || []);
            this.detachEditorBehaviorPlugins(sceneObject);
            this.engine.game?.removeObject(sceneObject);
            if (!this.engine.game) {
                this.engine.scene.remove(sceneObject);
                this.engine.physics?.removeObject(sceneObject);
            }

            // Cancel any pending outbound events for the removed object
            this.outboundQueue.removePending(sceneObject.uuid);
            this.engine.call("collabObjectRemoved", this, sceneObject);
        }

        this.engine.scene.updateMatrixWorld(true);
        this.engine.call("sceneUpdated", this, this.engine.scene);
        this.engine.call("sceneGraphChanged", this, this.engine.scene);
    }

    onSnapshotObjectUpdate(obj: SnapshotObject): void {
        if (!obj || !obj.uuid) {
            console.log("[CollaborationClient] onSnapshotObjectUpdate: obj or uuid is null");
            return;
        }

        if (obj.userId === this.engine.userId) {
            console.log(`[CollaborationClient] Skipping update from self`);
            return;
        }

        if (obj.uuid === this.engine.scene.uuid) {
            this.engine.scene.userData = obj.userData || {};
            this.engine.call("objectChanged", this, this.engine.scene);
            void this.reconcileLambdaRuntime();
            return;
        }

        if (obj.userData?.isBillboardContent) return;

        delete obj.userId;
        this.inboundQueue.enqueue({
            id: `update-${obj.uuid}-${Date.now()}`,
            type: "snapshot:update:object",
            uuid: obj.uuid,
            payload: obj,
            priority: "normal",
            timestamp: Date.now(),
            handler: () => this.processObjectUpdate(obj),
        });
    }

    private async processObjectUpdate(obj: SnapshotObject): Promise<void> {
        const isSelected = this.selectedObjectUUID === obj.uuid;
        const oldObject = findObjectByUuidDepthFirst(this.engine.scene, obj.uuid);

        if (!oldObject) return;

        const parent = findObjectByUuidDepthFirst(this.engine.scene, obj.parent) || this.engine.scene;
        const index = oldObject.parent?.children.indexOf(oldObject) ?? -1;

        try {
            console.log("[CollaborationClient] About to deserialize:", {
                name: obj.name,
                type: obj.type,
                hasGeometry: !!obj.geometry,
                geometryType: obj.geometry?.type,
                hasUserData: !!obj.userData,
                textConfig: obj.userData?.textConfig,
            });

            const object = await this.engine.editor?.deserializeObject(obj);

            console.log("[CollaborationClient] Deserialized result:", {
                success: !!object,
                name: object?.name,
                type: object?.type,
                constructorName: object?.constructor?.name,
                hasTextConfig: !!object?.userData?.textConfig,
                textConfigAfter: object?.userData?.textConfig,
            });

            if (object?.children.length === 0 && oldObject.children.length > 0) {
                const childrenToTransfer = [...oldObject.children].filter(
                    child => !child.userData?.isBillboardContent,
                );
                childrenToTransfer.forEach(child => object.add(child));
            }

            if (object) {
                if (oldObject.parent?.uuid === parent.uuid) {
                    parent.children.splice(index, 1, object);
                    object.parent = parent;
                } else {
                    oldObject.removeFromParent();
                    parent.add(object);
                }

                object.updateMatrix();
                object.updateMatrixWorld(true);

                this.engine.physics?.removeObject(oldObject);
                this.engine.game?.disposeObject(oldObject);
                const oldBehaviors = oldObject.userData?.behaviors || [];
                const newBehaviors = object.userData?.behaviors || [];
                const removedBehaviors = oldBehaviors.filter(
                    (b: {uuid: string}) => !newBehaviors.find((nb: {uuid: string}) => nb.uuid === b.uuid),
                );
                const updatedBehaviors = newBehaviors.filter((b: {uuid: string}) =>
                    oldBehaviors.find((ob: {uuid: string}) => ob.uuid === b.uuid),
                );
                const addedBehaviors = newBehaviors.filter(
                    (b: {uuid: string}) => !oldBehaviors.find((ob: {uuid: string}) => ob.uuid === b.uuid),
                );

                this.removeObjectBehaviors(object, removedBehaviors);
                this.updateExistingObjectBehaviors(object, updatedBehaviors);
                await this.addObjectBehaviors(object, addedBehaviors);
                this.detachEditorBehaviorPlugins(oldObject);
                this.attachEditorBehaviorPlugins(object);

                // Lambda runtime sync: deregister old object, register new
                this.engine.game?.lambdaManager?.deregisterObjectFromAll(oldObject);
                await this.ensureLambdaInstancesForObject(object);

                if (isSelected || !!obj.userData?.selectedBy) {
                    this.engine.physics?.removeObject(object);
                    this.engine.editor?.pauseObjectBehaviors(object);
                } else {
                    await this.engine.physics?.addObject(object);
                    this.engine.editor?.retargetObjectBehaviors(oldObject.uuid, object);
                    this.engine.editor?.resumeObjectBehaviors(object);
                }

                this.engine.editor?.processParticleSystems(object);

                this.engine.call("objectUpdated", this, object);
                object.updateMatrixWorld(true);
            }
        } catch (error) {
            console.error("[CollaborationClient] Failed to process object update:", error, obj?.uuid);
        }

        this.engine.scene.updateMatrixWorld(true);
        this.engine.call("sceneUpdated", this, this.engine.scene);
        this.engine.call("sceneGraphChanged", this, this.engine.scene);
    }

    onBehaviorRegistered(behavior: Behavior): void {
        if (!behavior) return;
        if (behavior.userId === this.engine.userId) return;

        behavior.config = typeof behavior.config === "string" ? JSON.parse(behavior.config) : behavior.config;
        this.engine.editor?.behaviorConfigRegistry?.unregisterConfig(behavior.id, true);
        this.engine.editor?.behaviorConfigRegistry?.registerConfig(behavior.id, behavior.config, true);

        this.engine?.editor?.syncSceneBehaviorConfigs();
    }

    onBehaviorUnregistered(behavior: Behavior): void {
        if (!behavior) return;
        if (behavior.userId === this.engine.userId) return;

        behavior.config = typeof behavior.config === "string" ? JSON.parse(behavior.config) : behavior.config;
        this.engine.editor?.behaviorConfigRegistry?.unregisterConfig(behavior.id, true);

        this.engine?.editor?.syncSceneBehaviorConfigs();
    }

    onBehaviorUpdated(behavior: Behavior): void {
        if (!behavior) return;
        if (behavior.userId === this.engine.userId) return;

        behavior.config = typeof behavior.config === "string" ? JSON.parse(behavior.config) : behavior.config;
        this.engine.editor?.behaviorConfigRegistry?.unregisterConfig(behavior.id, true);
        this.engine.editor?.behaviorConfigRegistry?.registerConfig(behavior.id, behavior.config, true);
        this.engine?.editor?.syncSceneBehaviorConfigs();
    }

    onScriptRegistered(script: Script): void {
        if (!script) return;
        if (script.userId === this.engine.userId) return;

        this.engine.editor?.behaviorScriptRegistry?.unregisterScript(script.name, true);
        this.engine.editor?.behaviorScriptRegistry?.registerScript(script.name, script.script, true);
        this.engine?.editor?.syncSceneBehaviorConfigs();
    }
    onScriptUnregistered(script: Script): void {
        if (!script) return;
        if (script.userId === this.engine.userId) return;

        this.engine.editor?.behaviorScriptRegistry?.unregisterScript(script.name, true);
        this.engine?.editor?.syncSceneBehaviorConfigs();
    }
    onScriptUpdated(script: Script): void {
        if (!script) return;
        if (script.userId === this.engine.userId) return;

        this.engine.editor?.behaviorScriptRegistry?.updateScript(script.name, script.script, true);
        this.engine?.editor?.syncSceneBehaviorConfigs();
    }

    onLambdaRegistered(lambda: LambdaSyncPayload): void {
        if (!lambda) return;
        if (lambda.userId === this.engine.userId) return;
        if (!lambda.config) return;

        this.inboundQueue.enqueue({
            id: `lambda-register-${lambda.id}-${Date.now()}`,
            type: "lambda:register",
            uuid: lambda.id,
            payload: lambda,
            priority: "low",
            timestamp: Date.now(),
            handler: () => this.processLambdaRegistered(lambda),
        });
    }

    private async processLambdaRegistered(lambda: LambdaSyncPayload): Promise<void> {
        const config = typeof lambda.config === "string" ? JSON.parse(lambda.config) : lambda.config;
        updateLambdaRegistries({
            lambdaId: lambda.id,
            config,
            assetMeta:
                lambda.assetId && lambda.revisionId
                    ? {assetId: lambda.assetId, revisionId: lambda.revisionId}
                    : undefined,
        });
        await this.engine.game?.ensureLambdaClassLoaded({
            lambdaId: lambda.id,
            assetId: lambda.assetId,
            revisionId: lambda.revisionId,
            config,
        });
        await this.reconcileLambdaRuntime(lambda.id);
    }

    onLambdaUnregistered(lambda: LambdaSyncPayload): void {
        if (!lambda) return;
        if (lambda.userId === this.engine.userId) return;

        this.engine.editor?.lambdaConfigRegistry?.unregisterConfig(lambda.id, true);
        this.engine.game?.lambdaManager?.destroyInstancesByType(lambda.id);
        this.engine.game?.lambdaManager?.unregisterLambdaClass(lambda.id);
    }

    onLambdaUpdated(lambda: LambdaSyncPayload): void {
        if (!lambda) return;
        if (lambda.userId === this.engine.userId) return;
        if (!lambda.config) return;

        this.inboundQueue.enqueue({
            id: `lambda-update-${lambda.id}-${Date.now()}`,
            type: "lambda:update",
            uuid: lambda.id,
            payload: lambda,
            priority: "normal",
            timestamp: Date.now(),
            handler: () => this.processLambdaUpdated(lambda),
        });
    }

    private async processLambdaUpdated(lambda: LambdaSyncPayload): Promise<void> {
        const config = typeof lambda.config === "string" ? JSON.parse(lambda.config) : lambda.config;
        // Update path assumes the lambda is already registered — sender
        // wouldn't be broadcasting an "update" otherwise. Don't go through
        // updateLambdaRegistries here; that helper would register on miss
        // and we'd silently turn a stray update into a registration.
        if (lambda.assetId && lambda.revisionId) {
            this.engine.editor?.lambdaConfigRegistry?.setAssetMeta(lambda.id, {
                assetId: lambda.assetId,
                revisionId: lambda.revisionId,
            });
        }
        this.engine.editor?.lambdaConfigRegistry?.updateConfig(lambda.id, config, true);
        this.engine.game?.lambdaManager?.updateConfig(lambda.id, config);
        await this.engine.game?.ensureLambdaClassLoaded({
            lambdaId: lambda.id,
            assetId: lambda.assetId,
            revisionId: lambda.revisionId,
            config,
            forceReload: true,
        });
        await this.reconcileLambdaRuntime(lambda.id);
    }

    // --- End of handlers for messages from the worker ---

    // --- Methods to send messages to the worker ---
    private addAsset({assetId}: {assetId: string}): void {
        this.workerHandler?.postMessage({event: ASSET_EVENTS.ADD, assetId});
    }

    private removeAsset({assetId}: {assetId: string}): void {
        this.workerHandler?.postMessage({event: ASSET_EVENTS.REMOVE, assetId});
    }

    private updateAsset({assetId}: {assetId: string}): void {
        this.workerHandler?.postMessage({event: ASSET_EVENTS.UPDATE, assetId});
    }

    private addObject(object: Object3D): void {
        if (!object?.uuid) return;

        const objArr = this.engine.editor?.serializeObject(object, !!object.userData?.Server);

        objArr?.forEach(obj => {
            if (obj.uuid) {
                obj.userId = this.engine.userId;
                this.workerHandler?.postMessage({event: SNAPSHOT_EVENTS.ADD.OBJECT, object: obj});
            }
        });
        this.debouncedUpdateSceneChildren();
    }

    private removeObject(object: Object3D): void {
        if (!object?.uuid) return;

        traverseObjectDepthFirst(object, child => {
            if (child.userData?.Server || child.userData?.isRuntimeOnly) return;
            this.workerHandler?.postMessage({event: SNAPSHOT_EVENTS.REMOVE.OBJECT, uuid: child.uuid});
        });

        this.outboundQueue.removePending(object.uuid);
        this.debouncedUpdateSceneChildren();
    }

    private updateObject(object: Object3D): void {
        if (!object || !object.uuid) return;
        if (this.inboundQueue.isProcessing(object.uuid)) return;

        if (object.uuid === this.engine.scene.uuid) {
            this.updateSceneUserData();
            return;
        }

        this.outboundQueue.enqueue({
            id: `outbound-update-${object.uuid}-${Date.now()}`,
            type: "outbound:update:object",
            uuid: object.uuid,
            payload: null,
            priority: "normal",
            timestamp: Date.now(),
            handler: () => this.executeUpdateObject(object),
        });
    }

    private executeUpdateObject(object: Object3D): void {
        if (!object) return;

        const sceneObj = findObjectByUuidDepthFirst(this.engine.scene, object?.uuid);
        if (sceneObj) {
            object.position.copy(sceneObj.position);
            object.quaternion?.copy(sceneObj.quaternion);
            object.scale.copy(sceneObj.scale);
            object.rotation.copy(sceneObj.rotation);
        }

        let objArr = this.engine.editor?.serializeObject(object, !!object.userData?.Server);

        if (isPrefab(object) && isPrefabUnlocked(object)) {
            objArr = objArr?.filter(o => o.uuid === object.uuid) || [];
        }

        objArr?.forEach(obj => {
            if (obj.uuid) {
                obj.userId = this.engine.userId;

                this.workerHandler?.postMessage({event: SNAPSHOT_EVENTS.UPDATE.OBJECT, object: obj});
            }
        });
        this.debouncedUpdateSceneChildren();
    }

    private selectObject(object: Object3D | null): void {
        const objectUuid = object?.uuid || "null";

        this.outboundQueue.enqueue({
            id: `outbound-select-${objectUuid}-${Date.now()}`,
            type: "outbound:select:object",
            uuid: objectUuid,
            payload: null,
            priority: "normal",
            timestamp: Date.now(),
            handler: () => this.executeSelectObject(object),
        });
    }

    private executeSelectObject(object: Object3D | null): void {
        if (this.selectedObjectUUID && this.selectedObjectUUID !== object?.uuid) {
            const prevSelected = findObjectByUuidDepthFirst(this.engine.scene, this.selectedObjectUUID);
            if (prevSelected) {
                const prevSelectedBy = prevSelected.userData.selectedBy;
                if (!prevSelectedBy || prevSelectedBy === this.engine.userId) {
                    prevSelected.userData.selectedBy = "";
                    this.workerHandler?.postMessage({
                        event: SNAPSHOT_EVENTS.UPDATE.OBJECT_USER_DATA,
                        uuid: prevSelected.uuid,
                        userData: prevSelected.userData,
                    });
                }
            }
        }

        if (object) {
            this.selectedObjectUUID = object.uuid;
            this.workerHandler?.postMessage({
                event: SNAPSHOT_EVENTS.UPDATE.OBJECT_USER_DATA,
                uuid: object.uuid,
                userData: object.userData,
            });
        } else {
            this.selectedObjectUUID = null;
        }
    }

    private behaviorRegistered(behavior: Behavior): void {
        if (!behavior) return;
        behavior.userId = this.engine.userId || "";
        this.workerHandler?.postMessage({event: BEHAVIOR_EVENTS.REGISTER.BEHAVIOR, behavior});
        this.engine?.editor?.syncSceneBehaviorConfigs();
        this.engine?.call("objectChanged", this.engine.editor, this.engine.scene);
    }

    private behaviorUnregistered(behavior: Behavior): void {
        if (!behavior) return;
        behavior.userId = this.engine.userId || "";
        this.workerHandler?.postMessage({event: BEHAVIOR_EVENTS.UNREGISTER.BEHAVIOR, behavior});
        this.engine?.editor?.syncSceneBehaviorConfigs();
        this.engine?.call("objectChanged", this.engine.editor, this.engine.scene);
    }

    private behaviorUpdated(behavior: Behavior): void {
        if (!behavior) return;
        behavior.userId = this.engine.userId || "";
        this.workerHandler?.postMessage({event: BEHAVIOR_EVENTS.UPDATE.BEHAVIOR, behavior});
        this.engine?.editor?.syncSceneBehaviorConfigs();
        this.engine?.call("objectChanged", this.engine.editor, this.engine.scene);
    }

    private scriptRegistered(script: Script): void {
        if (!script) return;
        script.userId = this.engine.userId || "";
        this.workerHandler?.postMessage({event: BEHAVIOR_EVENTS.REGISTER.SCRIPT, script});
        this.engine?.editor?.syncSceneBehaviorConfigs();
        this.engine?.call("objectChanged", this.engine.editor, this.engine.scene);
    }

    private scriptUnregistered(script: Script): void {
        if (!script) return;
        script.userId = this.engine.userId || "";
        this.workerHandler?.postMessage({event: BEHAVIOR_EVENTS.UNREGISTER.SCRIPT, script});
        this.engine?.editor?.syncSceneBehaviorConfigs();
        this.engine?.call("objectChanged", this.engine.editor, this.engine.scene);
    }

    private scriptUpdated(script: Script): void {
        if (!script) return;
        script.userId = this.engine.userId || "";
        this.workerHandler?.postMessage({event: BEHAVIOR_EVENTS.UPDATE.SCRIPT, script});
        this.engine?.editor?.syncSceneBehaviorConfigs();
        this.engine?.call("objectChanged", this.engine.editor, this.engine.scene);
    }

    private lambdaRegistered({id, config}: {id: string; config: LambdaConfig}): void {
        this.postLambdaEvent(LAMBDA_EVENTS.REGISTER, {id, config});
    }

    private lambdaUnregistered({id}: {id: string}): void {
        this.postLambdaEvent(LAMBDA_EVENTS.UNREGISTER, {id});
    }

    private lambdaUpdated({id, config}: {id: string; config: LambdaConfig}): void {
        this.postLambdaEvent(LAMBDA_EVENTS.UPDATE, {id, config});
    }

    // --- End of methods to send messages to the worker ---

    // --- Sync Check Methods ---

    private startSyncCheck(): void {
        // Stop previous interval if exists
        if (this.syncCheckInterval) {
            clearInterval(this.syncCheckInterval);
        }

        // Start periodic synchronization verification
        this.syncCheckInterval = setInterval(() => {
            this.performSyncCheck();
        }, this.SYNC_CHECK_INTERVAL_MS);
    }

    private stopSyncCheck(): void {
        if (this.syncCheckInterval) {
            clearInterval(this.syncCheckInterval);
            this.syncCheckInterval = null;
        }
    }

    private performSyncCheck(): void {
        this.workerHandler?.postMessage({event: SNAPSHOT_EVENTS.SYNC.CHECK_REQUEST});
    }

    public handleSyncCheckResponse(objectsData: SnapshotObject[]): void {
        if (!objectsData || !Array.isArray(objectsData)) {
            console.warn("[CollaborationClient] Invalid sync check data received");
            return;
        }

        if (!this.inboundQueue.isIdle()) {
            console.log("[CollaborationClient] Sync check deferred — inbound queue is not idle");
            return;
        }

        let missingCount = 0;
        let existingCount = 0;
        let updatedCount = 0;

        // Process objects from room state
        objectsData.forEach((roomObject: SnapshotObject) => {
            const generator = roomObject?.metadata?.generator;
            if (generator && NoDeserializeSerializers.includes(generator)) {
                return; // Skip objects with non-deserializable serializers
            }
            const sceneObject = findObjectByUuidDepthFirst(this.engine.scene, roomObject.uuid);

            if (!sceneObject) {
                // Object missing in scene - add it
                console.warn(`[CollaborationClient] Sync issue: Object ${roomObject.uuid} missing in scene - adding`);
                this.onSnapshotObjectAdd(roomObject);
                missingCount++;
            } else {
                existingCount++;

                // Check if object has any differences that require update
                if (this.hasObjectDesync(sceneObject, roomObject)) {
                    console.log(
                        `[CollaborationClient] Sync issue: Object ${roomObject.uuid} has differences - updating`,
                    );
                    this.onSnapshotObjectUpdate(roomObject);
                    updatedCount++;
                }
            }
        });

        console.log(
            `[CollaborationClient] Sync check completed: ${missingCount} added, ${updatedCount} updated, ${existingCount} total in room`,
        );
    }

    private hasObjectDesync(sceneObject: Object3D, roomObject: SnapshotObject): boolean {
        const reasons: string[] = [];

        if (roomObject.position && this.hasPositionDesync(sceneObject, roomObject.position)) {
            reasons.push(
                `position: local(${sceneObject.position.x.toFixed(4)}, ${sceneObject.position.y.toFixed(4)}, ${sceneObject.position.z.toFixed(4)}) vs room(${roomObject.position.x.toFixed(4)}, ${roomObject.position.y.toFixed(4)}, ${roomObject.position.z.toFixed(4)})`,
            );
        }

        if (roomObject.quaternion && this.hasRotationDesync(sceneObject, roomObject.quaternion)) {
            reasons.push(
                `rotation: local(${sceneObject.quaternion.x.toFixed(4)}, ${sceneObject.quaternion.y.toFixed(4)}, ${sceneObject.quaternion.z.toFixed(4)}, ${sceneObject.quaternion.w.toFixed(4)}) vs room(${roomObject.quaternion.x.toFixed(4)}, ${roomObject.quaternion.y.toFixed(4)}, ${roomObject.quaternion.z.toFixed(4)}, ${roomObject.quaternion.w.toFixed(4)})`,
            );
        }

        if (roomObject.scale && this.hasScaleDesync(sceneObject, roomObject.scale)) {
            reasons.push(
                `scale: local(${sceneObject.scale.x.toFixed(4)}, ${sceneObject.scale.y.toFixed(4)}, ${sceneObject.scale.z.toFixed(4)}) vs room(${roomObject.scale.x.toFixed(4)}, ${roomObject.scale.y.toFixed(4)}, ${roomObject.scale.z.toFixed(4)})`,
            );
        }

        if (roomObject.userData) {
            const userDataDiff = this.getUserDataDiffKeys(sceneObject, roomObject.userData);
            if (userDataDiff.length > 0) {
                reasons.push(`userData keys: [${userDataDiff.join(", ")}]`);
            }
        }

        if (reasons.length > 0) {
            console.log(
                `[CollaborationClient] Desync on "${roomObject.name || sceneObject.name}" (${roomObject.uuid}):`,
                reasons.join(" | "),
            );
            return true;
        }

        return false;
    }

    private hasPositionDesync(object: Object3D, roomPosition: {x: number; y: number; z: number}): boolean {
        return (
            Math.abs(object.position.x - roomPosition.x) > this.POSITION_THRESHOLD ||
            Math.abs(object.position.y - roomPosition.y) > this.POSITION_THRESHOLD ||
            Math.abs(object.position.z - roomPosition.z) > this.POSITION_THRESHOLD
        );
    }

    private hasRotationDesync(object: Object3D, roomQuaternion: {x: number; y: number; z: number; w: number}): boolean {
        return (
            Math.abs(object.quaternion.x - roomQuaternion.x) > this.ROTATION_THRESHOLD ||
            Math.abs(object.quaternion.y - roomQuaternion.y) > this.ROTATION_THRESHOLD ||
            Math.abs(object.quaternion.z - roomQuaternion.z) > this.ROTATION_THRESHOLD ||
            Math.abs(object.quaternion.w - roomQuaternion.w) > this.ROTATION_THRESHOLD
        );
    }

    private hasScaleDesync(object: Object3D, roomScale: {x: number; y: number; z: number}): boolean {
        return (
            Math.abs(object.scale.x - roomScale.x) > this.SCALE_THRESHOLD ||
            Math.abs(object.scale.y - roomScale.y) > this.SCALE_THRESHOLD ||
            Math.abs(object.scale.z - roomScale.z) > this.SCALE_THRESHOLD
        );
    }

    private static readonly EPHEMERAL_USER_DATA_KEYS = new Set([
        "csmEnabled",
        "selectedBy",
        "lastEditTime",
        "lastSaveTime",
    ]);

    private static filterEphemeralUserData(data: Record<string, unknown>): Record<string, unknown> {
        if (!data || typeof data !== "object") return data;
        const filtered: Record<string, unknown> = {};
        for (const key of Object.keys(data)) {
            if (!CollaborationClient.EPHEMERAL_USER_DATA_KEYS.has(key)) {
                filtered[key] = data[key];
            }
        }
        return filtered;
    }

    private getUserDataDiffKeys(object: Object3D, roomUserData: Record<string, unknown>): string[] {
        const localFiltered = CollaborationClient.filterEphemeralUserData(object.userData);
        const roomFiltered = CollaborationClient.filterEphemeralUserData(roomUserData);
        const diffKeys: string[] = [];
        const allKeys = new Set([...Object.keys(localFiltered), ...Object.keys(roomFiltered)]);
        for (const key of allKeys) {
            if (!isEqual(localFiltered[key], roomFiltered[key])) {
                diffKeys.push(key);
            }
        }
        return diffKeys;
    }

    private hasUserDataDesync(object: Object3D, roomUserData: Record<string, unknown>): boolean {
        return this.getUserDataDiffKeys(object, roomUserData).length > 0;
    }

    // --- Auto-save methods ---

    public startAutoSave(): void {
        this.stopAutoSave();

        const client = global.app?.multiplayerClient;
        if (client) {
            this.autoSavePlayerAddedToken = client.addOnPlayerAddedListener(() => this.triggerAutoSave());
            this.autoSavePlayerRemovedToken = client.addOnPlayerRemovedListener(() => this.triggerAutoSave());
            this.lockCleanupPlayerRemovedToken = client.addOnPlayerRemovedListener(player => {
                this.clearLocksForUser(player.user?.id);
            });
        }

        this.autoSaveInterval = setInterval(() => this.triggerAutoSave(), this.AUTO_SAVE_INTERVAL_MS);
    }

    private stopAutoSave(): void {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
            this.autoSaveInterval = null;
        }
        if (this.autoSaveDebounceTimer) {
            clearTimeout(this.autoSaveDebounceTimer);
            this.autoSaveDebounceTimer = null;
        }
        const client = global.app?.multiplayerClient;
        if (this.autoSavePlayerAddedToken) {
            client?.removeOnPlayerAddedListener(this.autoSavePlayerAddedToken);
            this.autoSavePlayerAddedToken = null;
        }
        if (this.autoSavePlayerRemovedToken) {
            client?.removeOnPlayerRemovedListener(this.autoSavePlayerRemovedToken);
            this.autoSavePlayerRemovedToken = null;
        }
        if (this.lockCleanupPlayerRemovedToken) {
            client?.removeOnPlayerRemovedListener(this.lockCleanupPlayerRemovedToken);
            this.lockCleanupPlayerRemovedToken = null;
        }
    }

    private triggerAutoSave(): void {
        if (!global.app?.multiplayerClient?.isHost()) return;

        const scene = this.engine.scene;
        const lastEditTime = scene?.userData?.lastEditTime;
        const lastSaveTime = scene?.userData?.lastSaveTime;

        // Skip auto-save if there are no unsaved changes. We only short-circuit when both
        // timestamps are present and the last edit is not newer than the last save.
        if (typeof lastEditTime === "number" && typeof lastSaveTime === "number" && lastEditTime <= lastSaveTime) {
            return;
        }

        if (this.autoSaveDebounceTimer) {
            clearTimeout(this.autoSaveDebounceTimer);
        }

        this.autoSaveDebounceTimer = setTimeout(() => {
            const currentScene = this.engine.scene;
            void saveScene(false, false)
                .then(() => {
                    if (currentScene) {
                        currentScene.userData.lastSaveTime = Date.now();
                        this.updateSceneUserData();
                    }
                })
                .finally(() => {
                    this.autoSaveDebounceTimer = null;
                });
        }, this.AUTO_SAVE_DEBOUNCE_MS);
    }

    // --- End of auto-save methods ---

    // --- Lock cleanup methods ---

    private clearLocksForUser(userId: string | undefined): void {
        if (!userId) return;

        traverseObjectDepthFirst(this.engine.scene, object => {
            if (object.userData?.selectedBy === userId) {
                delete object.userData.selectedBy;
                this.engine.call("objectChanged", this, object);
            }
        });
    }

    // --- End of lock cleanup methods ---

    // --- Utility methods ---

    private updateSceneUserData(): void {
        this.workerHandler?.postMessage({
            event: SNAPSHOT_EVENTS.UPDATE.OBJECT_USER_DATA,
            uuid: this.engine.scene.uuid,
            userData: this.engine.scene.userData,
        });
    }

    private updateSceneChildren(scene: Scene): SceneChild[] {
        const children: SceneChild[] = [];
        const objectStack: Object3D[] = [scene];
        const childrenListStack: SceneChild[][] = [children];

        while (objectStack.length > 0) {
            const obj = objectStack.pop()!;
            const childrenList = childrenListStack.pop()!;
            if (obj.userData.Server === true || obj.userData.isRuntimeOnly) continue;
            if (!obj.children || obj.userData?.type !== undefined) continue;

            const childTasks: Array<{object: Object3D; children: SceneChild[]}> = [];
            for (let i = 0, l = obj.children.length; i < l; i++) {
                const child = obj.children[i]!;
                const childChildren: SceneChild[] = [];
                childrenList.push({
                    uuid: child.uuid,
                    children: childChildren,
                });
                childTasks.push({object: child, children: childChildren});
            }

            for (let i = childTasks.length - 1; i >= 0; i--) {
                const task = childTasks[i]!;
                objectStack.push(task.object);
                childrenListStack.push(task.children);
            }
        }

        this.workerHandler?.postMessage({event: SNAPSHOT_EVENTS.UPDATE.SCENE_CHILDREN, uuid: scene.uuid, children});
        return children;
    }

    private debouncedUpdateSceneChildren(): void {
        this.outboundQueue.enqueue({
            id: `outbound-scene-children-${Date.now()}`,
            type: "outbound:update:scene-children",
            uuid: "__scene_children__",
            payload: null,
            priority: "normal",
            timestamp: Date.now(),
            handler: () => {
                this.updateSceneChildren(this.engine.scene);
            },
        });
    }

    private getSceneLambdaInstanceAttributes(instanceId: string): Record<string, unknown> {
        const sceneInstances = [
            ...((this.engine.scene.userData?.projectLambdaInstances || []) as SceneLambdaInstance[]),
            ...((this.engine.scene.userData?.lambdaInstances || []) as SceneLambdaInstance[]),
        ];
        const instance = sceneInstances.find(entry => entry?.instanceId === instanceId);
        return {...(instance?.attributes || {})};
    }

    private postLambdaEvent(
        event: string,
        lambda: {
            id: string;
            config?: LambdaConfig;
        },
    ): void {
        void Promise.resolve().then(() => {
            const meta = this.engine.editor?.lambdaConfigRegistry?.getAssetMeta(lambda.id);
            this.workerHandler?.postMessage({
                event,
                lambda: {
                    ...lambda,
                    assetId: meta?.assetId,
                    revisionId: meta?.revisionId,
                    userId: this.engine.userId || "",
                },
            });
        });
    }

    private async reconcileLambdaRuntime(lambdaId?: string): Promise<void> {
        for (const instanceData of [
            ...((this.engine.scene.userData?.projectLambdaInstances || []) as SceneLambdaInstance[]),
            ...((this.engine.scene.userData?.lambdaInstances || []) as SceneLambdaInstance[]),
        ]) {
            if (lambdaId && instanceData?.lambdaId !== lambdaId) continue;
            const lambdaManager = this.engine.game?.lambdaManager;
            if (!lambdaManager || !instanceData?.enabled || !instanceData?.instanceId || !instanceData?.lambdaId)
                continue;

            if (!lambdaManager.hasLambdaClass(instanceData.lambdaId)) {
                const config = this.engine.editor?.lambdaConfigRegistry?.getConfig(instanceData.lambdaId) ?? undefined;
                const meta = this.engine.editor?.lambdaConfigRegistry?.getAssetMeta(instanceData.lambdaId) ?? undefined;
                await this.engine.game?.ensureLambdaClassLoaded({
                    lambdaId: instanceData.lambdaId,
                    assetId: meta?.assetId,
                    revisionId: meta?.revisionId,
                    config,
                });
            }

            let instance = lambdaManager.getInstance(instanceData.instanceId);
            if (!instance && lambdaManager.hasLambdaClass(instanceData.lambdaId)) {
                instance = await lambdaManager.createInstance(instanceData.lambdaId, {
                    uuid: instanceData.instanceId,
                    attributes: instanceData.attributes || {},
                });
            }
            if (instance) {
                Object.assign(instance.attributes, instanceData.attributes || {});
            }
        }

        const objects: Object3D[] = [];
        traverseObjectDepthFirst(this.engine.scene, child => {
            if (child !== this.engine.scene) {
                objects.push(child);
            }
        });
        for (const object of objects) {
            await this.ensureLambdaInstancesForObject(object, lambdaId);
        }
    }

    private removeObjectBehaviors(object: Object3D, behaviors: SerializedBehaviorData[]): void {
        if (!object || !this.engine.isPlaying) return;
        if (behaviors && behaviors.length > 0) {
            behaviors.forEach((behaviorData: SerializedBehaviorData) => {
                if (behaviorData.uuid && (!behaviorData.id || !behaviorsToOmit.includes(behaviorData.id))) {
                    new DetachBehaviorCommand(object, behaviorData.uuid).execute();
                }
            });
        }
    }

    private async addObjectBehaviors(object: Object3D, behaviors: SerializedBehaviorData[]): Promise<void> {
        if (!object || !this.engine.isPlaying) return;
        if (behaviors && behaviors.length > 0) {
            for (const behaviorData of behaviors) {
                if (behaviorData.id && !behaviorsToOmit.includes(behaviorData.id)) {
                    await new AttachBehaviorCommand(object, behaviorData.id, {
                        enabled: false,
                        uuid: behaviorData.uuid,
                        attributesData: behaviorData.attributesData,
                        throttleConfig: behaviorData.throttleConfig,
                    }).execute();
                }
            }
        }
        this.engine.editor?.addAllPendingBehaviors();
    }

    private updateExistingObjectBehaviors(object: Object3D, behaviors: SerializedBehaviorData[]): void {
        if (!object || !this.engine.isPlaying) return;

        behaviors?.forEach((behaviorData: SerializedBehaviorData) => {
            if (!behaviorData.uuid || (behaviorData.id && behaviorsToOmit.includes(behaviorData.id))) return;
            const behavior = this.engine.game?.behaviorManager?.getBehaviorByUUID(behaviorData.uuid);
            if (!behavior || !this.engine.game?.behaviorManager) return;

            this.engine.game.behaviorManager.applyAttributesToBehavior(behavior, behaviorData.attributesData || {});
        });
    }

    // Editor-mode plugin sync: ensures behaviors like terrain/billboard fire their
    // onEditorAdded/onEditorRemoved hooks on the collaborator's side.
    private attachEditorBehaviorPlugins(object: Object3D): void {
        if (this.engine.isPlaying) return;
        const behaviors = object.userData?.behaviors as any[] | undefined;
        if (!behaviors || behaviors.length === 0) return;
        behaviors.forEach(behaviorData => {
            if (behaviorData?.uuid) {
                this.engine.editor?.addBehaviorPlugin(object, behaviorData);
            }
        });
    }

    private detachEditorBehaviorPlugins(object: Object3D): void {
        if (this.engine.isPlaying) return;
        const behaviors = object.userData?.behaviors as any[] | undefined;
        if (!behaviors || behaviors.length === 0) return;
        behaviors.forEach(behaviorData => {
            if (behaviorData?.uuid) {
                this.engine.editor?.removeBehaviorPlugin(behaviorData.uuid);
            }
        });
    }

    private async ensureLambdaInstancesForObject(object: Object3D, lambdaIdFilter?: string): Promise<void> {
        const lambdaComps = (object.userData?.lambdaComponents || []) as {
            lambdaId: string;
            enabled?: boolean;
            instanceId?: string;
            componentData?: Record<string, unknown>;
        }[];
        const lambdaManager = this.engine.game?.lambdaManager;
        if (!lambdaManager || lambdaComps.length === 0) return;

        for (const comp of lambdaComps) {
            if (lambdaIdFilter && comp.lambdaId !== lambdaIdFilter) continue;
            if (!comp.enabled || !comp.instanceId) continue;
            const config = this.engine.editor?.lambdaConfigRegistry?.getConfig(comp.lambdaId) ?? undefined;
            const meta = this.engine.editor?.lambdaConfigRegistry?.getAssetMeta(comp.lambdaId) ?? undefined;
            const instanceAttributes = this.getSceneLambdaInstanceAttributes(comp.instanceId);

            if (!lambdaManager.hasLambdaClass(comp.lambdaId)) {
                await this.engine.game?.ensureLambdaClassLoaded({
                    lambdaId: comp.lambdaId,
                    assetId: meta?.assetId,
                    revisionId: meta?.revisionId,
                    config,
                });
            }

            let instance = lambdaManager.getInstance(comp.instanceId);
            if (!instance && lambdaManager.hasLambdaClass(comp.lambdaId)) {
                instance = await lambdaManager.createInstance(comp.lambdaId, {
                    uuid: comp.instanceId,
                    attributes: instanceAttributes,
                });
            }
            if (!instance) continue;

            Object.assign(instance.attributes, instanceAttributes);
            const existingData = instance.getComponentData(object);
            if (existingData) {
                Object.assign(existingData, comp.componentData || {});
                continue;
            }
            lambdaManager.registerObject(comp.instanceId, object, comp.componentData);
        }
    }

    // --- End of utility methods ---

    // --- Start and stop collaboration listeners ---
    private setupCollaborationListeners(): void {
        this.engine.on("multiplayerHostStarted.CollaborationClient", this.init.bind(this));
        // 3D object events
        this.engine.on("objectAdded.CollaborationClient", this.addObject.bind(this));
        this.engine.on("objectRemoved.CollaborationClient", this.removeObject.bind(this));
        this.engine.on("objectChanged.CollaborationClient", this.updateObject.bind(this));
        this.engine.on("objectSelected.CollaborationClient", this.selectObject.bind(this));
        // Behaviors events
        this.engine.on("behaviorRegistered.CollaborationClient", this.behaviorRegistered.bind(this));
        this.engine.on("behaviorUnregistered.CollaborationClient", this.behaviorUnregistered.bind(this));
        this.engine.on("behaviorUpdated.CollaborationClient", this.behaviorUpdated.bind(this));
        // Scripts events
        this.engine.on("scriptRegistered.CollaborationClient", this.scriptRegistered.bind(this));
        this.engine.on("scriptUnregistered.CollaborationClient", this.scriptUnregistered.bind(this));
        this.engine.on("scriptUpdated.CollaborationClient", this.scriptUpdated.bind(this));
        this.engine.on("lambdaRegistered.CollaborationClient", this.lambdaRegistered.bind(this));
        this.engine.on("lambdaUnregistered.CollaborationClient", this.lambdaUnregistered.bind(this));
        this.engine.on("lambdaUpdated.CollaborationClient", this.lambdaUpdated.bind(this));
        // Asset events
        this.engine.on("assetAdded.CollaborationClient", this.addAsset.bind(this));
        this.engine.on("assetRemoved.CollaborationClient", this.removeAsset.bind(this));
        this.engine.on("assetChanged.CollaborationClient", this.updateAsset.bind(this));
    }

    private removeCollaborationListeners(): void {
        this.engine.on("multiplayerHostStarted.CollaborationClient", null);
        // 3D object events
        this.engine.on("objectAdded.CollaborationClient", null);
        this.engine.on("objectRemoved.CollaborationClient", null);
        this.engine.on("objectChanged.CollaborationClient", null);
        this.engine.on("objectSelected.CollaborationClient", null);
        // Behaviors events
        this.engine.on("behaviorRegistered.CollaborationClient", null);
        this.engine.on("behaviorUnregistered.CollaborationClient", null);
        this.engine.on("behaviorUpdated.CollaborationClient", null);
        // Scripts events
        this.engine.on("scriptRegistered.CollaborationClient", null);
        this.engine.on("scriptUnregistered.CollaborationClient", null);
        this.engine.on("scriptUpdated.CollaborationClient", null);
        this.engine.on("lambdaRegistered.CollaborationClient", null);
        this.engine.on("lambdaUnregistered.CollaborationClient", null);
        this.engine.on("lambdaUpdated.CollaborationClient", null);
        // Asset events
        this.engine.on("assetAdded.CollaborationClient", null);
        this.engine.on("assetRemoved.CollaborationClient", null);
        this.engine.on("assetChanged.CollaborationClient", null);
    }

    // --- End of collaboration listeners ---

    terminate(): void {
        this.stopAutoSave();
        this.stopSyncCheck();
        this.removeCollaborationListeners();
        this.inboundQueue.clear();
        this.outboundQueue.clear();
    }
}
