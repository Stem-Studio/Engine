import * as THREE from "three";
import type {WebGPURenderer} from "three/webgpu";

import type EngineRuntime from "../EngineRuntime";
import type {AssetSource} from "../asset-management/SceneAssetSource";
import {SceneConfig} from "../scene/SceneConfig";
import {CAMERA_EFFECTS, CAMERA_OBJECT_INTERACTION, CAMERA_TYPES_NEW} from "../types/editor";
import {
    findObjectByNameDepthFirst,
    findObjectDepthFirst,
    traverseObjectDepthFirst,
    traverseObjectReversePostOrder,
    updateObjectMatrixWorldDepthFirst,
} from "../utils/SceneTraverser";

const GLOBAL_BEHAVIOR_HOST_NAME = "GlobalBehaviorsHost";

export class PlayerSceneHost {
    sceneConfig = new SceneConfig();
    assetSource: AssetSource | null = null;
    controls: null = null;
    component: null = null;
    selectionHelpers: THREE.Object3D[] = [];
    gpuPickNum = 0;
    isStarted = false;
    view = "perspective";

    constructor(private readonly engine: EngineRuntime) {}

    get scene() {
        return this.engine.scene;
    }

    get camera() {
        return this.engine.camera;
    }

    get orthCamera() {
        return this.engine.orthCamera;
    }

    get renderer() {
        return this.engine.renderer;
    }

    set renderer(nextRenderer: WebGPURenderer) {
        this.engine.renderer = nextRenderer;
    }

    get sceneID() {
        return this.sceneConfig.sceneID;
    }

    set sceneID(value: string | null) {
        this.sceneConfig.sceneID = value;
    }

    get sceneName() {
        return this.sceneConfig.sceneName;
    }

    set sceneName(value: string | null) {
        this.sceneConfig.sceneName = value;
    }

    get sceneThumbnail() {
        return this.sceneConfig.sceneThumbnail;
    }

    set sceneThumbnail(value: string | null) {
        this.sceneConfig.sceneThumbnail = value;
    }

    get sceneAssetId() {
        return this.sceneConfig.sceneAssetId;
    }

    get isSandbox() {
        return this.sceneConfig.isSandbox;
    }

    set isSandbox(value: boolean) {
        this.sceneConfig.isSandbox = value;
    }

    get isMultiplayer() {
        return this.sceneConfig.isMultiplayer;
    }

    get maxMultiplayerClientsPerRoom() {
        return this.sceneConfig.maxMultiplayerClientsPerRoom;
    }

    get useInstancing() {
        return this.sceneConfig.useInstancing;
    }

    get showHUD() {
        return this.sceneConfig.showHUD;
    }

    get showStats() {
        return this.sceneConfig.showStats;
    }

    get showMemoryStats() {
        return this.sceneConfig.showMemoryStats;
    }

    get isCollaborative() {
        return this.sceneConfig.isCollaborative;
    }

    get maxCollaboratorsInRoom() {
        return this.sceneConfig.maxCollaboratorsInRoom;
    }

    get rendering() {
        return this.sceneConfig.rendering;
    }

    set rendering(value) {
        this.sceneConfig.rendering = value;
    }

    getDefaultCameraData() {
        return {
            type: "Camera",
            cameraType: CAMERA_TYPES_NEW.THIRD_PERSON,
            objectInteraction: CAMERA_OBJECT_INTERACTION.ZOOM,
            playerCollisionBox: 2,
            cameraHeadHeight: 2,
            cameraEffect: CAMERA_EFFECTS.NONE,
            cameraDefaultDistance: 3.5,
            cameraMinDistance: 0.5,
            cameraMaxDistance: 8,
            cameraFOV: 60,
            cameraNear: 1,
            cameraFar: 100000,
            cameraAngle: 0,
            cameraAxis: 0,
            usePointerLock: false,
            orbitOptions: {
                enableDamping: true,
                dampingFactor: 0.08,
                panSpeed: 1.6,
            },
        };
    }

    async setScene(scene: THREE.Scene): Promise<void> {
        this.engine.scene = scene;
        if (!findObjectDepthFirst(scene, object => object.type === "BatchedRenderer")) {
            scene.add(this.engine.batchedRenderer);
        }

        let globalHost = findObjectByNameDepthFirst(scene, GLOBAL_BEHAVIOR_HOST_NAME);
        if (!globalHost) {
            globalHost = new THREE.Object3D();
            globalHost.name = GLOBAL_BEHAVIOR_HOST_NAME;
            scene.add(globalHost);
        }

        updateObjectMatrixWorldDepthFirst(scene, true);
        traverseObjectDepthFirst(scene, object => {
            (object as {target?: {updateMatrixWorld?: () => void}}).target?.updateMatrixWorld?.();
        });
    }

    start() {
        this.isStarted = true;
    }

    stop() {
        this.isStarted = false;
    }

    clear() {
        this.sceneConfig.clear();
    }

    traverseSceneObjects(callback: (object: THREE.Object3D) => void) {
        traverseObjectDepthFirst(this.scene, callback);
    }

    reverseTraverseSceneObjects(callback: (object: THREE.Object3D) => void) {
        traverseObjectReversePostOrder(this.scene, callback);
    }

    removeObject(object: THREE.Object3D) {
        object.parent?.remove(object);
    }

    select() {
        // Player-only runtime has no editor selection state.
    }
}
