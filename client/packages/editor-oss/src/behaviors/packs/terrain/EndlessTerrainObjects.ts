import * as Comlink from 'comlink';
import { Noise } from 'noisejs';
import seedrandom from 'seedrandom/seedrandom.js';
import { AmbientLight, Box3, BufferGeometry, FrontSide, DoubleSide, InstancedMesh, LinearFilter, LinearMipmapLinearFilter, Material, MathUtils, Matrix4, Mesh, Object3D, PerspectiveCamera, Quaternion, Scene, Texture, Vector3, Group } from 'three';
import type {WebGPURenderer} from "three/webgpu";
import { acceleratedRaycast } from 'three-mesh-bvh';

import { TerrainObjectType } from './EndlessTerrainConstants';
import { HeightFn } from './EndlessTerrainTypes';
import { TerrainUtils } from './EndlessTerrainUtils';
import type { TerrainPlacementWorkerAPI, TerrainPlacementTaskMessage, TerrainPlacementResultMessage } from './TerrainPlacementWorker';
import TerrainPlacementWorker from './TerrainPlacementWorker.ts?worker';
import { AssetDerivativeType, getAssetDerivatives, getAssetRevision } from '@stem/network/api/asset';
import { AssetLoader } from '@stem/editor-oss/asset-management/AssetLoader';
import GLTFLoaderExtended from '../../../assets/js/loaders/GLTFLoaderExtended';
import { loadModelWithLoader } from '@stem/editor-oss/model/load-util';
import MeshUtils from '@stem/editor-oss/utils/MeshUtils';

Mesh.prototype.raycast = acceleratedRaycast;

export { TerrainObjectType };

export interface TerrainObjectModel {
    /** URL to GLB model (for default/bundled models) */
    url: string;
    /** Scene object UUID (for user-selected scene objects) - deprecated */
    modelUUID?: string;
    /** Asset reference (assetId + revisionId) for custom models from asset library */
    modelAsset?: { assetId: string; revisionId: string } | null;
    minScale: number;
    maxScale: number;
    terrainOffset?: number;
    probability: number;
    type: TerrainObjectType;
}

export type OnTerrainObjectAdded = (mesh: Object3D, index: number, objectId: string, type: TerrainObjectType) => void;
export type OnTerrainObjectRemoved = (mesh: Object3D, objectId: string) => void;

interface TerrainObjectsOptions {
    chunkSize?: number;
    chunkSegments?: number;
    density?: number;
    seed?: number;
    useInstancing?: boolean;
    useEnhancedTerrain?: boolean;
    waterPercentage?: number;
    /** Scene root for looking up objects by UUID */
    sceneRoot?: Object3D;
    /** Asset loader for loading models from asset library */
    assetLoader?: AssetLoader;
    /** Maximum terrain height (used to calculate snow threshold if rockMaxHeight not set) */
    maxHeight?: number;
    /** Height threshold above which grass transitions into rocky terrain */
    grassMaxHeight?: number;
    /** Height threshold above which snow begins (plants/trees won't spawn above this). Defaults to 80% of maxHeight */
    rockMaxHeight?: number;
    /** Tree density control (0-100). 0 = no trees, 50 = default, 100 = maximum density */
    treeDensity?: number;
    /** Rock density control (0-100). 0 = no rocks, 50 = default, 100 = maximum density */
    rockDensity?: number;
}

function findObjectByUuid(root: Object3D, uuid: string): Object3D | null {
    const stack: Object3D[] = [root];

    while (stack.length > 0) {
        const object = stack.pop();
        if (!object) continue;
        if (object.uuid === uuid) return object;

        for (let i = object.children.length - 1; i >= 0; i--) {
            const child = object.children[i];
            if (child) stack.push(child);
        }
    }

    return null;
}

function findFirstMesh(root: Object3D): Mesh | null {
    const stack: Object3D[] = [root];

    while (stack.length > 0) {
        const object = stack.pop();
        if (!object) continue;
        if ((object as Mesh).isMesh) return object as Mesh;

        for (let i = object.children.length - 1; i >= 0; i--) {
            const child = object.children[i];
            if (child) stack.push(child);
        }
    }

    return null;
}

type AddTask = {
    type: 'add';
    chunkX: number;
    chunkZ: number;
    start: number;
    count: number;
    totalInChunk: number;
    generation: number;
};

type RemoveTask = {
    type: 'remove';
    chunkX: number;
    chunkZ: number;
};

type UpdateTask = AddTask | RemoveTask;

interface TerrainManager {
    readonly root: Object3D;
    addInstance(chunkKey: string, matrix: Matrix4, objectId: string): number;
    removeChunk(chunkKey: string, onRemove: (objectId: string) => void): boolean;
    getObject(index: number): Object3D;
    getCount(): number;
    markBoundsDirty(): void;
    updateBounds(forceBox?: boolean): void;
}

class IndividualMeshManager implements TerrainManager {
    public readonly root: Group;
    private chunkObjects = new Map<string, Mesh[]>();
    private meshMap = new Map<number, Mesh>();

    constructor(private geometry: BufferGeometry, private material: Material | Material[]) {
        this.root = new Group();
    }

    public getObject(index: number) { 
        return this.meshMap.get(index) || this.root; 
    }

    public getCount() { return this.meshMap.size; }

    public markBoundsDirty() {}

    public updateBounds() {}

    public addInstance(chunkKey: string, matrix: Matrix4, objectId: string) {
        const mesh = new Mesh(this.geometry, this.material);
        matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.objectId = objectId;
        this.root.add(mesh);
        mesh.updateMatrixWorld();
        if (!this.chunkObjects.has(chunkKey)) {
            this.chunkObjects.set(chunkKey, []);
        }
        this.chunkObjects.get(chunkKey)!.push(mesh);
        this.meshMap.set(mesh.id, mesh);
        return mesh.id;
    }

    public removeChunk(chunkKey: string, onRemove: (objectId: string) => void) {
        const objects = this.chunkObjects.get(chunkKey);
        if (!objects) return false;
        for (const obj of objects) {
            if (obj.userData.objectId) onRemove(obj.userData.objectId);
            obj.removeFromParent();
            this.meshMap.delete(obj.id);
        }
        this.chunkObjects.delete(chunkKey);
        return true;
    }
}

class InstancedMeshManager implements TerrainManager {
    public readonly root: InstancedMesh;
    // `root.count` is also the renderer's visible instance count. Keep the
    // allocator's logical count separate so an editor preview cap cannot
    // corrupt chunk bookkeeping or cause later additions/removals to reuse
    // the wrong slots.
    private logicalCount = 0;
    private static readonly BOUNDS_BOX_RECOMPUTE_INTERVAL = 4;
    private chunkInstances = new Map<string, number[]>();
    private instanceOwner: string[] = []; 
    private instanceIds: string[] = [];
    private readonly tmpMatrix = new Matrix4();
    private readonly victimIndices = new Set<number>();
    private boundsDirty = false;
    private sphereFlushCount = 0;

    constructor(mesh: InstancedMesh) {
        this.root = mesh;
        this.logicalCount = Math.max(0, Math.floor(mesh.count));
    }

    public getObject() { return this.root; }

    public getCount() { return this.logicalCount; }

    public markBoundsDirty() {
        this.boundsDirty = true;
    }

    public updateBounds(forceBox = false) {
        if (!this.boundsDirty && !forceBox) {
            return;
        }

        this.root.computeBoundingSphere();
        this.sphereFlushCount++;

        if (forceBox || this.sphereFlushCount % InstancedMeshManager.BOUNDS_BOX_RECOMPUTE_INTERVAL === 0) {
            this.root.computeBoundingBox();
        }

        this.boundsDirty = false;
    }

    public addInstance(chunkKey: string, matrix: Matrix4, objectId: string) {
        if (this.logicalCount >= this.root.instanceMatrix.count) return -1;
        const index = this.logicalCount;
        this.root.setMatrixAt(index, matrix);
        this.logicalCount++;
        this.root.count = this.logicalCount;
        this.root.instanceMatrix.needsUpdate = true;
        let list = this.chunkInstances.get(chunkKey);
        if (!list) {
            list = [];
            this.chunkInstances.set(chunkKey, list);
        }
        list.push(index);
        this.instanceOwner[index] = chunkKey;
        this.instanceIds[index] = objectId;
        return index;
    }

    public removeChunk(chunkKey: string, onRemove: (objectId: string) => void) {
        const indices = this.chunkInstances.get(chunkKey);
        if (!indices) return false;
        for (const idx of indices) {
            if (this.instanceIds[idx]) onRemove(this.instanceIds[idx]);
        }
        this.victimIndices.clear();
        for (const idx of indices) {
            this.victimIndices.add(idx);
        }
        indices.sort((a, b) => a - b);
        for (let i = 0; i < indices.length; i++) {
            const holeIndex = indices[i];
            if (holeIndex === undefined) continue;
            if (holeIndex >= this.logicalCount) continue;
            while (true) {
                const candidateIndex = this.logicalCount - 1;
                if (candidateIndex < holeIndex) {
                    break;
                }
                if (candidateIndex === holeIndex) {
                    this.logicalCount--;
                    break;
                }
                if (this.victimIndices.has(candidateIndex)) {
                    this.logicalCount--;
                    continue;
                }
                this.root.getMatrixAt(candidateIndex, this.tmpMatrix);
                this.root.setMatrixAt(holeIndex, this.tmpMatrix);
                const keeperOwner = this.instanceOwner[candidateIndex];
                const keeperId = this.instanceIds[candidateIndex];
                if (keeperOwner !== undefined) {
                    this.instanceOwner[holeIndex] = keeperOwner;
                    const ownerList = this.chunkInstances.get(keeperOwner);
                    if (ownerList) {
                        const idxInList = ownerList.indexOf(candidateIndex);
                        if (idxInList !== -1) ownerList[idxInList] = holeIndex;
                    }
                }
                if (keeperId !== undefined) {
                    this.instanceIds[holeIndex] = keeperId;
                }
                this.logicalCount--;
                break; 
            }
        }
        this.root.count = this.logicalCount;
        this.root.instanceMatrix.needsUpdate = true;
        this.chunkInstances.delete(chunkKey);
        return true;
    }
}

export class EndlessTerrainObjects {
    private static readonly MAX_PENDING_PLACEMENT_TASKS = 8;
    private static readonly yAxis = new Vector3(0, 1, 0);
    private static readonly tmpMatrix = new Matrix4();
    private static readonly tmpPosition = new Vector3();
    private static readonly tmpScale = new Vector3();
    private static readonly tmpQuaternion = new Quaternion();
    private static readonly modelCache = new Map<string, Promise<{ geometry: BufferGeometry; material: Material | Material[] }>>();
    private static readonly textureCache = new Map<string, Texture>();
    private static readonly thumbnailCache = new Map<string, string>();
    private static thumbnailRenderer: WebGPURenderer | null = null;
    private static thumbnailRendererInitialized = false;
    // Mutex to serialize thumbnail generation (prevents race conditions with shared renderer)
    private static thumbnailGenerationQueue: Promise<void> = Promise.resolve();
    // Reusable singleton objects for thumbnail generation (prevents Scene/Camera memory leak)
    private static thumbnailScene: Scene | null = null;
    private static thumbnailCamera: PerspectiveCamera | null = null;
    private static thumbnailLight: AmbientLight | null = null;

    public maxInstancesPerModel: number = 2048;
    public updatesPerSecond: number = 20;
    public eagerProcessing: boolean = false;
    public verticalOffset: number = 0;
    public autoLayerSync: boolean = true;
    public debug: boolean = false;
    public onTerrainObjectAdded: OnTerrainObjectAdded | null = null;
    public onTerrainObjectRemoved: OnTerrainObjectRemoved | null = null;

    private managers: TerrainManager[] = [];
    private roots: Object3D[] = [];
    private updateQueue: (UpdateTask | undefined)[] = [];
    private updateQueueHead = 0;
    private pendingChunks = new Set<string>();
    private pendingPlacementTasks = new Map<string, AddTask>();
    private placementResultsQueue: (TerrainPlacementResultMessage | undefined)[] = [];
    private placementResultsQueueHead = 0;
    private dirtyManagers = new Set<TerrainManager>();
    private chunkGenerations = new Map<string, number>();
    private modelsReady = false;
    private addedChunkKeys = new Set<string>();
    private updatesCounter = 0;
    private totalInstancesAdded = 0;
    private readonly modifiedManagersScratch = new Set<TerrainManager>();
    private readonly applyPlacementMatrixScratch = new Matrix4();
    private readonly reprioritizeAddScratch: AddTask[] = [];
    private readonly densityReaddChunkKeysScratch: string[] = [];
    private priorityOrigin: { x: number; z: number } | null = null;
    private queuePriorityDirty = false;
    private workerTerrainModelsPayload: TerrainPlacementTaskMessage['terrainModels'] | null = null;
    private placementWorker: Worker | null = null;
    private placementProxy: Comlink.Remote<TerrainPlacementWorkerAPI> | null = null;
    private readonly forestNoise: Noise;

    constructor(
        private readonly parent: Object3D,
        private readonly heightFn: HeightFn,
        private readonly terrainModels: readonly TerrainObjectModel[],
        private readonly options: TerrainObjectsOptions = {},
    ) {
        this.options.chunkSize = options.chunkSize ?? 32;
        this.options.chunkSegments = options.chunkSegments ?? 20;
        this.options.density = options.density ?? 0.5;
        this.options.seed = options.seed ?? 0;
        this.options.useInstancing = options.useInstancing ?? true;
        this.options.useEnhancedTerrain = options.useEnhancedTerrain ?? true;
        this.options.waterPercentage = options.waterPercentage ?? 15;
        this.options.maxHeight = options.maxHeight ?? 150;
        this.options.grassMaxHeight = options.grassMaxHeight ?? 7;
        // Snow threshold: use provided value, or calculate as 80% of maxHeight
        this.options.rockMaxHeight = options.rockMaxHeight ?? this.options.maxHeight * 0.8;
        this.options.treeDensity = options.treeDensity ?? 50;
        this.options.rockDensity = options.rockDensity ?? 50;
        this.forestNoise = new Noise((this.options.seed ?? 0) + 12345);
    }

    private setupPlacementWorker() {
        if (typeof Worker === 'undefined' || this.placementWorker) return;
        this.placementWorker = new TerrainPlacementWorker();
        this.placementProxy = Comlink.wrap<TerrainPlacementWorkerAPI>(this.placementWorker);
    }

    private getNextChunkGeneration(chunkKey: string): number {
        const generation = (this.chunkGenerations.get(chunkKey) ?? 0) + 1;
        this.chunkGenerations.set(chunkKey, generation);
        return generation;
    }

    private isActiveChunkGeneration(chunkKey: string, generation: number): boolean {
        return this.addedChunkKeys.has(chunkKey) && this.chunkGenerations.get(chunkKey) === generation;
    }

    private handlePlacementResult(result: TerrainPlacementResultMessage) {
        this.pendingPlacementTasks.delete(result.taskId);
        this.placementResultsQueue.push(result);
    }

    private handlePlacementWorkerError(error: unknown) {
        console.warn('[EndlessTerrainObjects] Terrain placement worker failed, falling back to main thread.', error);
        if (this.placementProxy) {
            this.placementProxy[Comlink.releaseProxy]();
            this.placementProxy = null;
        }
        this.placementWorker?.terminate();
        this.placementWorker = null;

        const pendingTasks = Array.from(this.pendingPlacementTasks.values());
        this.pendingPlacementTasks.clear();
        this.placementResultsQueue = [];
        this.placementResultsQueueHead = 0;

        for (const task of pendingTasks) {
            const chunkKey = TerrainUtils.getChunkKey(task.chunkX, task.chunkZ);
            if (this.isActiveChunkGeneration(chunkKey, task.generation)) {
                this.updateQueue.push(task);
            }
        }
    }

    private getWorkerTerrainModelsPayload(): TerrainPlacementTaskMessage['terrainModels'] {
        if (!this.workerTerrainModelsPayload) {
            this.workerTerrainModelsPayload = this.terrainModels.map(model => ({
                minScale: model.minScale,
                maxScale: model.maxScale,
                terrainOffset: model.terrainOffset ?? 0,
                probability: model.probability,
                type: model.type,
            }));
        }

        return this.workerTerrainModelsPayload;
    }

    private getUpdateQueueLength() {
        return this.updateQueue.length - this.updateQueueHead;
    }

    private peekUpdateQueue(): UpdateTask | undefined {
        while (this.updateQueueHead < this.updateQueue.length) {
            const task = this.updateQueue[this.updateQueueHead];
            if (task) {
                return task;
            }
            this.updateQueueHead++;
        }

        if (this.updateQueueHead > 0) {
            this.updateQueue = [];
            this.updateQueueHead = 0;
        }

        return undefined;
    }

    private dequeueUpdateQueue(): UpdateTask | undefined {
        const task = this.peekUpdateQueue();
        if (!task) {
            return undefined;
        }

        this.updateQueue[this.updateQueueHead] = undefined;
        this.updateQueueHead++;
        this.compactUpdateQueueIfNeeded();
        return task;
    }

    private compactUpdateQueueIfNeeded() {
        if (this.updateQueueHead < 512 || this.updateQueueHead * 2 < this.updateQueue.length) {
            return;
        }

        this.updateQueue = this.updateQueue.slice(this.updateQueueHead);
        this.updateQueueHead = 0;
    }

    private dequeuePlacementResultQueue(): TerrainPlacementResultMessage | undefined {
        while (this.placementResultsQueueHead < this.placementResultsQueue.length) {
            const result = this.placementResultsQueue[this.placementResultsQueueHead];
            this.placementResultsQueue[this.placementResultsQueueHead] = undefined;
            this.placementResultsQueueHead++;
            if (!result) {
                continue;
            }

            if (
                this.placementResultsQueueHead >= 512 &&
                this.placementResultsQueueHead * 2 >= this.placementResultsQueue.length
            ) {
                this.placementResultsQueue = this.placementResultsQueue.slice(this.placementResultsQueueHead);
                this.placementResultsQueueHead = 0;
            }

            return result;
        }

        if (this.placementResultsQueueHead > 0) {
            this.placementResultsQueue = [];
            this.placementResultsQueueHead = 0;
        }

        return undefined;
    }

    private hasQueuedPlacementResults() {
        return this.placementResultsQueueHead < this.placementResultsQueue.length;
    }

    private removeQueuedAddTasksForChunk(chunkX: number, chunkZ: number) {
        if (this.getUpdateQueueLength() === 0) {
            return;
        }

        const nextQueue: UpdateTask[] = [];
        for (let i = this.updateQueueHead; i < this.updateQueue.length; i++) {
            const task = this.updateQueue[i];
            if (!task) {
                continue;
            }
            if (task.chunkX === chunkX && task.chunkZ === chunkZ && task.type === 'add') {
                continue;
            }
            nextQueue.push(task);
        }

        this.updateQueue = nextQueue;
        this.updateQueueHead = 0;
    }

    private findAndTakeQueuedRemoveTask(): RemoveTask | undefined {
        for (let i = this.updateQueueHead; i < this.updateQueue.length; i++) {
            const task = this.updateQueue[i];
            if (!task || task.type !== 'remove') {
                continue;
            }

            this.updateQueue[i] = undefined;
            this.compactUpdateQueueIfNeeded();
            return task;
        }

        return undefined;
    }

    private reprioritizeQueuedAddTasks() {
        if (!this.queuePriorityDirty || !this.priorityOrigin || this.getUpdateQueueLength() < 2) {
            return;
        }

        const queue = this.updateQueue;
        const addTasks = this.reprioritizeAddScratch;
        addTasks.length = 0;

        let writeIndex = 0;
        for (let readIndex = this.updateQueueHead; readIndex < queue.length; readIndex++) {
            const task = queue[readIndex];
            if (!task) {
                continue;
            }
            queue[writeIndex++] = task;
            if (task.type === 'add') {
                addTasks.push(task);
            }
        }
        queue.length = writeIndex;
        this.updateQueueHead = 0;

        if (addTasks.length < 2) {
            addTasks.length = 0;
            this.queuePriorityDirty = false;
            return;
        }

        const chunkSize = this.options.chunkSize ?? 0;
        const { x, z } = this.priorityOrigin;
        addTasks.sort((left, right) => {
            const leftDx = left.chunkX * chunkSize - x;
            const leftDz = left.chunkZ * chunkSize - z;
            const rightDx = right.chunkX * chunkSize - x;
            const rightDz = right.chunkZ * chunkSize - z;

            return (leftDx * leftDx + leftDz * leftDz) - (rightDx * rightDx + rightDz * rightDz);
        });

        let addIndex = 0;
        for (let i = 0; i < queue.length; i++) {
            const task = queue[i]!;
            if (task.type === 'add') {
                queue[i] = addTasks[addIndex++]!;
            }
        }
        addTasks.length = 0;
        this.queuePriorityDirty = false;
    }

    private markManagerBoundsDirty(manager: TerrainManager) {
        manager.markBoundsDirty();
        this.dirtyManagers.add(manager);
    }

    private flushDirtyBounds(forceBox = false) {
        if (this.dirtyManagers.size === 0) {
            return;
        }

        this.dirtyManagers.forEach(manager => manager.updateBounds(forceBox));
        this.dirtyManagers.clear();
    }

    public async init() {
        console.warn(`[EndlessTerrainObjects] init() called with ${this.terrainModels.length} models`);
        this.setupPlacementWorker();
        this.managers = new Array<TerrainManager>(this.terrainModels.length);
        this.roots = new Array<Object3D>(this.terrainModels.length);
        await Promise.all(this.terrainModels.map(async (model, index) => {
            try {
                let geometry: BufferGeometry;
                let material: Material | Material[];

                console.warn(`[EndlessTerrainObjects] Loading model ${index}:`, {
                    url: model.url,
                    modelUUID: model.modelUUID,
                    modelAsset: model.modelAsset,
                });

                // Check if this is an asset, scene object (UUID), or URL-based model
                if (model.modelAsset?.assetId && model.modelAsset?.revisionId) {
                    // Load from asset library
                    console.warn(`[EndlessTerrainObjects] Using loadModelFromAsset for index ${index}`);
                    const result = await this.loadModelFromAsset(model.modelAsset.assetId, model.modelAsset.revisionId);
                    if (!result) {
                        console.warn(`[EndlessTerrainObjects] Skipping model at index ${index}: failed to load from asset`);
                        return;
                    }
                    geometry = result.geometry;
                    material = result.material;
                } else if (model.modelUUID) {
                    // Load from scene object (deprecated)
                    const result = this.loadModelFromSceneObject(model.modelUUID);
                    if (!result) {
                        console.warn(`[EndlessTerrainObjects] Skipping model at index ${index}: failed to load from UUID`);
                        return;
                    }
                    geometry = result.geometry;
                    material = result.material;
                } else if (model.url) {
                    // Load from URL (default/bundled models)
                    console.warn(`[EndlessTerrainObjects] Using loadModel (URL) for index ${index}: ${model.url}`);
                    const result = await this.loadModel(model.url);
                    geometry = result.geometry;
                    material = result.material;
                } else {
                    console.warn(`[EndlessTerrainObjects] Skipping model at index ${index}: no URL, UUID, or asset provided`);
                    return;
                }

                // Ensure geometry bottom sits at Y=0 so objects rest on terrain surface
                geometry = geometry.clone();
                geometry.computeBoundingBox();
                if (geometry.boundingBox && Math.abs(geometry.boundingBox.min.y) > 0.01) {
                    geometry.translate(0, -geometry.boundingBox.min.y, 0);
                }

                if (this.options.useInstancing) {
                    const instanceMaterial = Array.isArray(material)
                        ? material.map(m => m.clone())
                        : material.clone();
                    const mesh = new InstancedMesh(geometry, instanceMaterial, this.maxInstancesPerModel);
                    mesh.userData.isRuntimeOnly = true;
                    mesh.count = 0;
                    mesh.castShadow = true;
                    mesh.receiveShadow = true;
                    mesh.frustumCulled = !false;
                    const zero = new Matrix4().set(0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0);
                    for(let i=0; i<this.maxInstancesPerModel; i++) mesh.setMatrixAt(i, zero);
                    if (this.autoLayerSync) {
                        mesh.layers.mask = this.parent.layers.mask;
                    }
                    this.parent.add(mesh);
                    this.roots[index] = mesh;
                    this.managers[index] = new InstancedMeshManager(mesh);
                } else {
                    const manager = new IndividualMeshManager(geometry, material);
                    manager.root.userData.isRuntimeOnly = true;
                    if (this.autoLayerSync) {
                        manager.root.layers.mask = this.parent.layers.mask;
                    }
                    this.parent.add(manager.root);
                    this.roots[index] = manager.root;
                    this.managers[index] = manager;
                }
            } catch (e) {
                console.error(`[EndlessTerrainObjects] Failed to load model at index ${index}`, e);
            }
        }));
        this.modelsReady = true;
        for (const key of this.pendingChunks) {
            const parts = key.split(',');
            if (parts.length < 2) continue;
            const [cx, cz] = parts.map(Number);
            const generation = this.chunkGenerations.get(key);
            if (
                cx !== undefined &&
                cz !== undefined &&
                generation !== undefined &&
                this.isActiveChunkGeneration(key, generation)
            ) {
                this.enqueueAdd(cx, cz, generation);
            }
        }
        this.pendingChunks.clear();
        (globalThis as any)._terrainObjects = this;
    }

    private async loadModel(url: string) {
        if (!EndlessTerrainObjects.modelCache.has(url)) {
            const promise = (async () => {
                console.warn(`[EndlessTerrainObjects] loadModel: Using GLTFLoaderExtended for ${url}`);
                // Use GLTFLoaderExtended for consistent texture handling (KTX2, DRACO support)
                const loader = new GLTFLoaderExtended();
                const scene = await loader.load(url, '', new Map());

                let geometry: BufferGeometry | null = null;
                let material: Material | Material[] | null = null;
                const mesh = findFirstMesh(scene);
                if (mesh) {
                    // Apply parent node transforms (e.g. cm→m scale) to geometry
                    mesh.updateWorldMatrix(true, false);
                    geometry = mesh.geometry.clone();
                    geometry.applyMatrix4(mesh.matrixWorld);
                    if (!geometry.attributes.normal) geometry.computeVertexNormals();

                    material = mesh.material;
                    this.applyMaterialFixes(material);
                }
                if (!geometry || !material) throw new Error(`No mesh found in ${url}`);

                // Generate and cache thumbnail if not already cached
                if (!EndlessTerrainObjects.thumbnailCache.has(url)) {
                    try {
                        const thumbnail = await EndlessTerrainObjects.generateThumbnail(scene, 64);
                        EndlessTerrainObjects.thumbnailCache.set(url, thumbnail);
                    } catch (e) {
                        console.warn(`[EndlessTerrainObjects] Failed to generate thumbnail for ${url}:`, e);
                    }
                }

                return { geometry, material };
            })();
            EndlessTerrainObjects.modelCache.set(url, promise);
        }
        return EndlessTerrainObjects.modelCache.get(url)!;
    }

    /**
     * Generate a thumbnail from a 3D model
     * Uses a queue to serialize generation (shared renderer can't handle concurrent renders)
     * @param model
     * @param size
     */
    private static async generateThumbnail(model: Object3D, size = 64): Promise<string> {
        // Queue this thumbnail generation to prevent race conditions
        const result = EndlessTerrainObjects.thumbnailGenerationQueue.then(async () => {
            // Initialize renderer if needed (reuse for performance)
            if (!EndlessTerrainObjects.thumbnailRenderer) {
                const {WebGPURenderer} = await import('three/webgpu');
                EndlessTerrainObjects.thumbnailRenderer = new WebGPURenderer({ antialias: true, alpha: true });
                EndlessTerrainObjects.thumbnailRenderer.setSize(size, size);
                await EndlessTerrainObjects.thumbnailRenderer.init();
                EndlessTerrainObjects.thumbnailRendererInitialized = true;
            } else if (!EndlessTerrainObjects.thumbnailRendererInitialized) {
                await EndlessTerrainObjects.thumbnailRenderer.init();
                EndlessTerrainObjects.thumbnailRendererInitialized = true;
            }

            const renderer = EndlessTerrainObjects.thumbnailRenderer;
            renderer.setSize(size, size);

            // Use singleton scene (lazily created, prevents memory leak)
            if (!EndlessTerrainObjects.thumbnailScene) {
                EndlessTerrainObjects.thumbnailScene = new Scene();
                EndlessTerrainObjects.thumbnailScene.name = "EndlessTerrainThumbnailScene";
                EndlessTerrainObjects.thumbnailScene.background = null;
            }
            const scene = EndlessTerrainObjects.thumbnailScene;

            // Clear any previous children from the scene
            while (scene.children.length > 0) {
                const child = scene.children[0];
                if (!child) {
                    break;
                }
                scene.remove(child);
            }

            // Clone the model to avoid modifying the original
            const modelClone = model.clone();
            scene.add(modelClone);

            // Use singleton light (lazily created)
            if (!EndlessTerrainObjects.thumbnailLight) {
                EndlessTerrainObjects.thumbnailLight = new AmbientLight(0xffffff, 2.0);
            }
            scene.add(EndlessTerrainObjects.thumbnailLight);

            // Use singleton camera (lazily created)
            if (!EndlessTerrainObjects.thumbnailCamera) {
                EndlessTerrainObjects.thumbnailCamera = new PerspectiveCamera(20, 1, 0.1, 1000);
            }
            const camera = EndlessTerrainObjects.thumbnailCamera;

            // Fit model to view
            const box = new Box3().setFromObject(modelClone);
            const boxSize = box.getSize(new Vector3());
            const center = box.getCenter(new Vector3());

            const maxDim = Math.max(boxSize.x, boxSize.y, boxSize.z);
            const fov = camera.fov * (Math.PI / 180);
            let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
            cameraZ *= 1.5; // Add margin

            camera.position.set(center.x + cameraZ * 0.3, center.y + cameraZ * 0.2, center.z + cameraZ);
            camera.lookAt(center);

            renderer.render(scene, camera);
            const dataUrl = renderer.domElement.toDataURL("image/png");

            scene.remove(modelClone);

            return dataUrl;
        });

        // Update the queue to wait for this generation to complete
        EndlessTerrainObjects.thumbnailGenerationQueue = result.then(() => {}, () => {});

        return result;
    }

    /**
     * Get cached thumbnail for a model URL, or null if not yet generated
     * @param url
     */
    public static getThumbnail(url: string): string | null {
        return EndlessTerrainObjects.thumbnailCache.get(url) || null;
    }

    /**
     * Get all cached thumbnails
     */
    public static getAllThumbnails(): Map<string, string> {
        return new Map(EndlessTerrainObjects.thumbnailCache);
    }

    /**
     * Dispose all thumbnail-related resources.
     * Should be called when terrain behavior is stopped or disposed.
     */
    public static disposeThumbnailResources(): void {
        // Dispose the singleton scene
        if (EndlessTerrainObjects.thumbnailScene) {
            // Clear any children
            while (EndlessTerrainObjects.thumbnailScene.children.length > 0) {
                const child = EndlessTerrainObjects.thumbnailScene.children[0];
                if (!child) {
                    break;
                }
                EndlessTerrainObjects.thumbnailScene.remove(child);
            }
            EndlessTerrainObjects.thumbnailScene = null;
        }

        // Dispose the singleton camera
        if (EndlessTerrainObjects.thumbnailCamera) {
            EndlessTerrainObjects.thumbnailCamera = null;
        }

        // Dispose the singleton light
        if (EndlessTerrainObjects.thumbnailLight) {
            EndlessTerrainObjects.thumbnailLight.dispose();
            EndlessTerrainObjects.thumbnailLight = null;
        }

        // Dispose the renderer
        if (EndlessTerrainObjects.thumbnailRenderer) {
            EndlessTerrainObjects.thumbnailRenderer.dispose();
            EndlessTerrainObjects.thumbnailRenderer = null;
            EndlessTerrainObjects.thumbnailRendererInitialized = false;
        }

        // Clear the thumbnail cache
        EndlessTerrainObjects.thumbnailCache.clear();
    }

    /**
     * Generate and cache thumbnail for a scene object by UUID
     * @param uuid The UUID of the scene object
     * @param sceneRoot The scene root to search for the object
     * @returns The data URL of the generated thumbnail, or null if failed
     */
    public static async generateThumbnailForSceneObject(uuid: string, sceneRoot: Object3D): Promise<string | null> {
        const cacheKey = `uuid:${uuid}`;

        // Check cache first
        if (EndlessTerrainObjects.thumbnailCache.has(cacheKey)) {
            return EndlessTerrainObjects.thumbnailCache.get(cacheKey) || null;
        }

        const foundObject = findObjectByUuid(sceneRoot, uuid);

        if (!foundObject) {
            console.warn(`[EndlessTerrainObjects] Object not found with UUID: ${uuid}`);
            return null;
        }

        try {
            const thumbnail = await EndlessTerrainObjects.generateThumbnail(foundObject, 64);
            EndlessTerrainObjects.thumbnailCache.set(cacheKey, thumbnail);
            return thumbnail;
        } catch (e) {
            console.warn(`[EndlessTerrainObjects] Failed to generate thumbnail for UUID ${uuid}:`, e);
            return null;
        }
    }

    /**
     * Generate and cache thumbnail for a model asset by assetId/revisionId
     * Uses GLB derivatives when available (assets may be in formats like USDZ that require conversion)
     * @param assetId The asset ID
     * @param revisionId The revision ID
     * @returns The data URL of the generated thumbnail, or null if failed
     */
    public static async generateThumbnailForAsset(assetId: string, revisionId: string): Promise<string | null> {
        const cacheKey = `asset:${assetId}:${revisionId}`;

        // Check cache first
        if (EndlessTerrainObjects.thumbnailCache.has(cacheKey)) {
            return EndlessTerrainObjects.thumbnailCache.get(cacheKey) || null;
        }

        try {
            let modelUrl: string | null = null;

            // First, try to get a GLB derivative
            try {
                const derivatives = await getAssetDerivatives(assetId, revisionId, { includeDataUrl: true });
                const modelDerivatives = derivatives.filter(derivative => derivative.type === AssetDerivativeType.Model);
                const glbDerivative = modelDerivatives.find(
                    derivative => derivative.format === 'glb' && (derivative.lodLevel === 0 || derivative.lodLevel === 1),
                ) || modelDerivatives.find(derivative => derivative.format === 'glb');

                if (glbDerivative?.dataUrl) {
                    modelUrl = glbDerivative.dataUrl;
                }
            } catch {
                // Ignore, will try revision data next
            }

            // Fallback to revision data
            if (!modelUrl) {
                const revision = await getAssetRevision(assetId, revisionId, { includeDataUrl: true });
                if (revision.format === 'glb' || revision.format === 'gltf') {
                    modelUrl = revision.dataUrl ?? null;
                }
            }

            if (!modelUrl) {
                console.warn(`[EndlessTerrainObjects] No loadable URL for thumbnail ${assetId}:${revisionId}`);
                return null;
            }

            // Load the model to generate thumbnail using GLTFLoaderExtended for consistent handling
            const loader = new GLTFLoaderExtended();
            const scene = await loader.load(modelUrl, '', new Map());

            const thumbnail = await EndlessTerrainObjects.generateThumbnail(scene, 64);
            EndlessTerrainObjects.thumbnailCache.set(cacheKey, thumbnail);
            return thumbnail;
        } catch (e) {
            console.warn(`[EndlessTerrainObjects] Failed to generate thumbnail for asset ${assetId}:`, e);
            return null;
        }
    }

    /**
     * Load model from a scene object by UUID
     * @param uuid
     */
    private loadModelFromSceneObject(uuid: string): { geometry: BufferGeometry; material: Material | Material[] } | null {
        const cacheKey = `uuid:${uuid}`;

        // Check cache first
        const cached = EndlessTerrainObjects.modelCache.get(cacheKey);
        if (cached) {
            // Return a resolved promise-like result synchronously
            // We need to handle this differently since it's sync
            return null; // Will be handled in init
        }

        const sceneRoot = this.options.sceneRoot;
        if (!sceneRoot) {
            console.warn(`[EndlessTerrainObjects] No scene root provided for UUID lookup: ${uuid}`);
            return null;
        }

        const foundObject = findObjectByUuid(sceneRoot, uuid);

        if (!foundObject) {
            console.warn(`[EndlessTerrainObjects] Object not found with UUID: ${uuid}`);
            return null;
        }

        // Extract geometry and material from the found object
        let geometry: BufferGeometry | null = null;
        let material: Material | Material[] | null = null;

        const sceneObject: Object3D = foundObject;
        const mesh = (sceneObject as Mesh).isMesh ? sceneObject as Mesh : findFirstMesh(sceneObject);

        if (mesh) {
            geometry = mesh.geometry.clone();
            if (!geometry.attributes.normal) geometry.computeVertexNormals();
            material = Array.isArray(mesh.material)
                ? mesh.material.map(m => m.clone())
                : mesh.material.clone();
            this.applyMaterialFixes(material);
        }

        if (!geometry || !material) {
            console.warn(`[EndlessTerrainObjects] No mesh found in scene object: ${uuid}`);
            return null;
        }

        return { geometry, material };
    }

    /**
     * Load model from an asset reference (assetId + revisionId)
     * Returns the geometry and material for instancing
     * Uses the same loading infrastructure as scene models (handles KTX2, DRACO, meshopt)
     * @param assetId
     * @param revisionId
     */
    private async loadModelFromAsset(assetId: string, revisionId: string): Promise<{ geometry: BufferGeometry; material: Material | Material[] } | null> {
        const cacheKey = `asset:${assetId}:${revisionId}`;

        // Check cache first
        if (EndlessTerrainObjects.modelCache.has(cacheKey)) {
            return EndlessTerrainObjects.modelCache.get(cacheKey)!;
        }

        // Create promise for loading and cache it immediately to prevent duplicate loads
        const loadPromise = (async () => {
            try {
                // Create asset resolution context for this specific asset
                const context = {
                    assetIdToRevisionId: {
                        [assetId]: revisionId,
                    },
                };

                // Use existing asset loader or create a temporary one
                const assetLoader = this.options.assetLoader || new AssetLoader();

                // Load model using the standard infrastructure (handles KTX2, DRACO, meshopt compression)
                // Use LOD 0 (highest quality) to ensure textures are included
                const loadedObject = await loadModelWithLoader(assetId, context, assetLoader, {
                    preferLod: 0,
                });

                // Extract geometry and material from the loaded object
                let geometry: BufferGeometry | null = null;
                let material: Material | Material[] | null = null;
                const mesh = findFirstMesh(loadedObject);
                if (mesh) {
                    // Apply parent node transforms (e.g. cm→m scale) to geometry
                    mesh.updateWorldMatrix(true, false);
                    geometry = mesh.geometry.clone();
                    geometry.applyMatrix4(mesh.matrixWorld);
                    if (!geometry.attributes.normal) geometry.computeVertexNormals();

                    // Clone the material to ensure textures are preserved even if loaded object is GC'd
                    material = Array.isArray(mesh.material)
                        ? mesh.material.map(mat => mat.clone())
                        : mesh.material.clone();
                    this.applyMaterialFixes(material);
                }

                if (!geometry || !material) {
                    console.warn(`[EndlessTerrainObjects] No mesh found in asset ${assetId}:${revisionId}`);
                    return null;
                }

                // Generate thumbnail for the asset
                if (!EndlessTerrainObjects.thumbnailCache.has(cacheKey)) {
                    try {
                        const thumbnail = await EndlessTerrainObjects.generateThumbnail(loadedObject, 64);
                        EndlessTerrainObjects.thumbnailCache.set(cacheKey, thumbnail);
                    } catch (e) {
                        console.warn(`[EndlessTerrainObjects] Failed to generate thumbnail for asset ${assetId}:`, e);
                    }
                }

                return { geometry, material };
            } catch (e) {
                console.error(`[EndlessTerrainObjects] Failed to load asset ${assetId}:${revisionId}:`, e);
                return null;
            }
        })();

        EndlessTerrainObjects.modelCache.set(cacheKey, loadPromise as any);
        return loadPromise;
    }

    private applyMaterialFixes(material: Material | Material[]) {
        const fix = (m: Material) => {
             const mat = m as any;
             if (mat.map) {
                 if (!EndlessTerrainObjects.textureCache.has(mat.map.uuid)) {
                     mat.map.anisotropy = 4;
                     mat.map.minFilter = LinearMipmapLinearFilter;
                     mat.map.magFilter = LinearFilter;
                     EndlessTerrainObjects.textureCache.set(mat.map.uuid, mat.map);
                 }
                 mat.map = EndlessTerrainObjects.textureCache.get(mat.map.uuid);
                 if (mat.name.toLowerCase().includes('grass') || mat.name.toLowerCase().includes('leaf')) {
                     mat.side = DoubleSide;
                 }
             } else {
                 mat.side = FrontSide;
             }
             if (mat.metalness !== undefined) mat.metalness = 0;
             if (mat.roughness !== undefined) mat.roughness = 1;
             if (mat.envMapIntensity !== undefined) mat.envMapIntensity = 0.1;
        };
        if (Array.isArray(material)) material.forEach(fix);
        else fix(material);
    }

    public addObjectsForChunk(chunkX: number, chunkZ: number) {
        const key = `${chunkX},${chunkZ}`;
        if (this.addedChunkKeys.has(key)) return;
        const generation = this.getNextChunkGeneration(key);
        this.addedChunkKeys.add(key);
        if (!this.modelsReady) {
            this.pendingChunks.add(key);
            return;
        }
        this.enqueueAdd(chunkX, chunkZ, generation);
    }

    private enqueueAdd(chunkX: number, chunkZ: number, generation: number) {
        const density = this.options.density!;
        const totalInChunk = Math.floor(this.options.chunkSize! * this.options.chunkSize! * density);
        const batchSize = 64;
        for (let i = 0; i < totalInChunk; i += batchSize) {
            this.updateQueue.push({
                type: 'add',
                chunkX,
                chunkZ,
                start: i,
                count: Math.min(batchSize, totalInChunk - i),
                totalInChunk,
                generation,
            });
        }
        if (this.priorityOrigin) {
            this.queuePriorityDirty = true;
        }
    }

    public removeObjectsForChunk(chunkX: number, chunkZ: number) {
        const key = `${chunkX},${chunkZ}`;
        if (!this.addedChunkKeys.has(key)) return;
        this.addedChunkKeys.delete(key);
        this.pendingChunks.delete(key);
        this.removeQueuedAddTasksForChunk(chunkX, chunkZ);
        this.updateQueue.push({ type: 'remove', chunkX, chunkZ });
    }

    public update(dt: number) {
        this.updatesCounter++;
        const maxTime = 4; 
        const startTime = performance.now();
        const placementResultsBudgetMs = 16;
        let processed = 0;
        const targetProcessed = this.eagerProcessing ? Infinity : Math.ceil(this.updatesPerSecond * Math.max(0.016, dt) * 10); 
        const placementStartTime = performance.now();
        this.reprioritizeQueuedAddTasks();
        while (this.hasQueuedPlacementResults()) {
            const placementResult = this.dequeuePlacementResultQueue();
            if (!placementResult) {
                break;
            }

            this.applyPlacementResult(placementResult);
            processed++;

            if (!this.eagerProcessing && performance.now() - placementStartTime >= placementResultsBudgetMs) {
                break;
            }
        }
        while (this.getUpdateQueueLength() > 0) {
            const task = this.peekUpdateQueue();
            if (!task) break;
            if (task.type === 'add') {
                if (this.placementProxy) {
                    if (this.pendingPlacementTasks.size >= EndlessTerrainObjects.MAX_PENDING_PLACEMENT_TASKS) {
                        const removeTask = this.findAndTakeQueuedRemoveTask();
                        if (!removeTask) {
                            break;
                        }
                        this.processRemove(removeTask);
                        processed++;
                        if (!this.eagerProcessing && (processed >= targetProcessed || performance.now() - startTime > maxTime)) {
                            break;
                        }
                        continue;
                    }
                    this.dispatchPlacementTask(task);
                } else {
                    this.processAdd(task);
                }
                this.dequeueUpdateQueue();
            } else {
                this.processRemove(task);
                this.dequeueUpdateQueue();
            }
            processed++;
            if (!this.eagerProcessing && (processed >= targetProcessed || performance.now() - startTime > maxTime)) {
                break;
            }
        }

        this.flushDirtyBounds(false);
    }

    private dispatchPlacementTask(task: AddTask) {
        if (!this.placementProxy) {
            this.processAdd(task);
            return;
        }

        const taskId = `${task.chunkX}:${task.chunkZ}:${task.generation}:${task.start}:${task.count}:${task.totalInChunk}`;
        this.pendingPlacementTasks.set(taskId, task);
        const message: TerrainPlacementTaskMessage = {
            taskId,
            chunkX: task.chunkX,
            chunkZ: task.chunkZ,
            generation: task.generation,
            start: task.start,
            count: task.count,
            totalInChunk: task.totalInChunk,
            options: {
                chunkSize: this.options.chunkSize!,
                chunkSegments: this.options.chunkSegments!,
                seed: this.options.seed!,
                maxHeight: this.options.maxHeight!,
                grassMaxHeight: this.options.grassMaxHeight!,
                rockMaxHeight: this.options.rockMaxHeight!,
                treeDensity: this.options.treeDensity!,
                rockDensity: this.options.rockDensity!,
                useEnhancedTerrain: this.options.useEnhancedTerrain!,
                waterPercentage: this.options.waterPercentage!,
                verticalOffset: this.verticalOffset,
            },
            terrainModels: this.getWorkerTerrainModelsPayload(),
        };
        this.placementProxy.processPlacementTask(message)
            .then(result => this.handlePlacementResult(result))
            .catch(error => {
                this.pendingPlacementTasks.delete(taskId);
                this.handlePlacementWorkerError(error);
            });
    }

    private applyPlacementResult(result: TerrainPlacementResultMessage) {
        const chunkKey = TerrainUtils.getChunkKey(result.chunkX, result.chunkZ);
        if (!this.isActiveChunkGeneration(chunkKey, result.generation)) {
            return;
        }

        const modifiedManagers = this.modifiedManagersScratch;
        modifiedManagers.clear();
        const matrix = this.applyPlacementMatrixScratch;

        for (let i = 0; i < result.modelIndices.length; i++) {
            const modelIndex = result.modelIndices[i] ?? 0;
            const manager = this.managers[modelIndex];
            const modelDef = this.terrainModels[modelIndex];
            const objectId = result.objectIds[i];

            if (!manager || !modelDef || !objectId) {
                continue;
            }

            matrix.fromArray(result.matrices, i * 16);
            const instanceId = manager.addInstance(chunkKey, matrix, objectId);
            if (instanceId === -1) {
                continue;
            }

            modifiedManagers.add(manager);
            if (this.onTerrainObjectAdded) {
                const obj = manager.getObject(instanceId);
                this.onTerrainObjectAdded(obj, instanceId, objectId, modelDef.type);
            }
            this.totalInstancesAdded++;
        }

        modifiedManagers.forEach(manager => this.markManagerBoundsDirty(manager));
        modifiedManagers.clear();
    }

    private processAdd(task: AddTask) {
        const chunkKey = TerrainUtils.getChunkKey(task.chunkX, task.chunkZ);
        const chunkSize = this.options.chunkSize!;
        const modifiedManagers = this.modifiedManagersScratch;
        modifiedManagers.clear();
        const grassMaxHeight = this.options.grassMaxHeight ?? 7;
        const rockMaxHeight = this.options.rockMaxHeight ?? 120;

        for (let i = 0; i < task.count; i++) {
            const objectIndex = task.start + i;

            // Generate random position, scale, and rotation using seeded RNG
            const seed = `${this.options.seed}:${task.chunkX}:${task.chunkZ}:${objectIndex}`;
            const rng = seedrandom(seed);
            const rx = rng() - 0.5;
            const rz = rng() - 0.5;
            const rScale = rng();
            const rRot = rng();
            const rModel = rng();

            const x = (task.chunkX + rx) * chunkSize;
            const z = (task.chunkZ + rz) * chunkSize;
            const y = this.heightFn(x, z);

            // Determine height zone, then choose a compatible model
            const isDitchArea = y < 0;
            const isGrassArea = y >= 0 && y <= grassMaxHeight;
            const isRockArea = y > grassMaxHeight && y <= rockMaxHeight;
            const isSnowArea = y > rockMaxHeight;

            const modelIndex = this.chooseModelForZone(isDitchArea, isGrassArea, isRockArea, isSnowArea, rModel);
            if (modelIndex === -1) continue;

            const manager = this.managers[modelIndex];
            if (!manager) continue;
            const modelDef = this.terrainModels[modelIndex];
            if (!modelDef) continue;

            // Forest clustering: trees only spawn in forest patches
            if (modelDef.type === TerrainObjectType.Tree) {
                const coarse = this.forestNoise.perlin2(x * 0.012, z * 0.012);
                const fine = this.forestNoise.perlin2(x * 0.06, z * 0.06);
                const forestSample = coarse + fine * 0.3;
                // Map treeDensity [0, 100] to noise offset [-0.5, 0.8]
                // At 0: offset = -0.5 (almost no trees), At 50: offset ~0.15 (current behavior), At 100: offset = 0.8 (very dense)
                const treeOffset = (this.options.treeDensity! / 100) * 1.3 - 0.5;
                const minForestDensity = this.options.treeDensity! > 0 ? 0.08 : 0;
                const forestDensity = Math.max(minForestDensity, (forestSample + treeOffset) / (1 + treeOffset));
                // Use a separate RNG call so we don't shift the main sequence
                const rForest = seedrandom(`${this.options.seed}:forest:${task.chunkX}:${task.chunkZ}:${objectIndex}`)();
                if (rForest > forestDensity) continue;
            }

            // Rock density filter
            if (modelDef.type === TerrainObjectType.Rock) {
                const rRockDensity = seedrandom(`${this.options.seed}:rock:${task.chunkX}:${task.chunkZ}:${objectIndex}`)();
                if (rRockDensity > this.options.rockDensity! / 50) continue;
            }

            const scale = MathUtils.lerp(modelDef.minScale, modelDef.maxScale, rScale);
            const terrainOffset = modelDef.terrainOffset ?? 0;
            EndlessTerrainObjects.tmpPosition.set(x, y + this.verticalOffset - terrainOffset, z);
            EndlessTerrainObjects.tmpScale.set(scale, scale, scale);
            EndlessTerrainObjects.tmpQuaternion.setFromAxisAngle(EndlessTerrainObjects.yAxis, rRot * Math.PI * 2);
            EndlessTerrainObjects.tmpMatrix.compose(EndlessTerrainObjects.tmpPosition, EndlessTerrainObjects.tmpQuaternion, EndlessTerrainObjects.tmpScale);
            const uniqueId = `${task.chunkX}:${task.chunkZ}:${modelIndex}:${objectIndex}`;
            const instanceId = manager.addInstance(chunkKey, EndlessTerrainObjects.tmpMatrix, uniqueId);
            if (instanceId !== -1) {
                modifiedManagers.add(manager);
                if (this.onTerrainObjectAdded) {
                    const obj = manager.getObject(instanceId);
                    this.onTerrainObjectAdded(obj, instanceId, uniqueId, modelDef.type);
                }
            }
            this.totalInstancesAdded++;
        }

        modifiedManagers.forEach(m => this.markManagerBoundsDirty(m));
        modifiedManagers.clear();
    }

    /**
     * Choose a model compatible with the given height zone using weighted random selection.
     * This ensures every valid position gets an object and distribution is correct within each zone.
     * @param isDitch
     * @param isGrass
     * @param isRock
     * @param isSnow
     * @param rand
     */
    private chooseModelForZone(isDitch: boolean, isGrass: boolean, isRock: boolean, isSnow: boolean, rand: number): number {
        let totalWeight = 0;
        let lastCompatibleIndex = -1;

        for (let i = 0; i < this.terrainModels.length; i++) {
            const model = this.terrainModels[i];
            if (!model || !this.managers[i]) continue;

            // Check zone compatibility
            if (model.type === TerrainObjectType.Plant && !isGrass) continue;
            if (model.type === TerrainObjectType.Tree && (isDitch || isSnow)) continue;
            if (model.type === TerrainObjectType.Rock && !isRock && !isSnow) continue;

            const weight = model.probability;
            if (weight <= 0) continue;

            lastCompatibleIndex = i;
            totalWeight += weight;
        }

        if (lastCompatibleIndex === -1 || totalWeight === 0) return -1;

        // Weighted random selection among compatible models
        let acc = 0;
        const target = rand * totalWeight;
        for (let i = 0; i < this.terrainModels.length; i++) {
            const model = this.terrainModels[i];
            if (!model || !this.managers[i]) continue;

            if (model.type === TerrainObjectType.Plant && !isGrass) continue;
            if (model.type === TerrainObjectType.Tree && (isDitch || isSnow)) continue;
            if (model.type === TerrainObjectType.Rock && !isRock && !isSnow) continue;

            const weight = model.probability;
            if (weight <= 0) continue;

            acc += weight;
            if (target <= acc) return i;
        }

        return lastCompatibleIndex;
    }

    private processRemove(task: { chunkX: number, chunkZ: number }) {
        const chunkKey = TerrainUtils.getChunkKey(task.chunkX, task.chunkZ);
        for (let m = 0; m < this.managers.length; m++) {
            const manager = this.managers[m];
            if (!manager) continue;
             const removed = manager.removeChunk(chunkKey, (objectId) => {
                 this.onTerrainObjectRemoved?.(manager.root, objectId);
             });
             if (removed) this.markManagerBoundsDirty(manager);
        }
    }

    /** Retained for compatibility; model selection no longer uses a per-chunk distribution cache. */
    public clearDistributionCache(): void {}

    public forceFlushQueue(limit = Infinity) {
        let p = 0;
        this.reprioritizeQueuedAddTasks();
        while(this.getUpdateQueueLength() > 0 && p < limit) {
             const t = this.peekUpdateQueue();
             if (!t) break;
             if(t.type === 'add') {
                 this.processAdd(t);
                 this.dequeueUpdateQueue();
             } else {
                 this.processRemove(t);
                 this.dequeueUpdateQueue();
             }
             p++;
        }

        this.flushDirtyBounds(true);
    }

    public setDensity(d: number, readd=false) {
        this.options.density = d;
        if(readd) {
            const keys = this.densityReaddChunkKeysScratch;
            keys.length = 0;
            this.addedChunkKeys.forEach(key => keys.push(key));
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i]!;
                const commaIndex = key.indexOf(',');
                if (commaIndex <= 0 || commaIndex >= key.length - 1) continue;
                const x = Number(key.slice(0, commaIndex));
                const z = Number(key.slice(commaIndex + 1));
                if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
                this.removeObjectsForChunk(x, z);
                this.addObjectsForChunk(x, z);
            }
            keys.length = 0;
        }
    }

    public setDebug(v: boolean) { this.debug = v; }

    public getStatus() {
        return this.managers.map((m, i) => ({
             modelIndex: i,
             count: m ? m.getCount() : 0,
             type: m ? m.root.type : 'Unknown',
        }));
    }

    public spawnTestInstance(modelIndex=0, pos={x:0, y:5, z:0}) {
         const m = this.managers[modelIndex];
         if(!m) return false;
         const mat = new Matrix4().compose(
             new Vector3(pos.x, pos.y + this.verticalOffset, pos.z),
             new Quaternion(),
             new Vector3(1,1,1),
         );
         m.addInstance('debug', mat, 'debug-instance');
            this.markManagerBoundsDirty(m);
         return true;
    }

    public syncLayersFrom(source: Object3D) {
        this.roots.forEach(m => { if(m) m.layers.mask = source.layers.mask; });
    }

    public setPriorityOrigin(x: number, z: number) {
        if (!Number.isFinite(x) || !Number.isFinite(z)) {
            return;
        }

        if (this.priorityOrigin && this.priorityOrigin.x === x && this.priorityOrigin.z === z) {
            return;
        }

        this.priorityOrigin = { x, z };
        this.queuePriorityDirty = true;
    }

    public dispose() {
        this.roots.forEach(m => {
            if(m) {
                m.removeFromParent();
                if (m instanceof InstancedMesh) MeshUtils.dispose(m);
            }
        });
        this.managers = [];
        this.roots = [];
        this.updateQueue = [];
        this.updateQueueHead = 0;
        this.addedChunkKeys.clear();
        this.chunkGenerations.clear();
        this.pendingPlacementTasks.clear();
        this.placementResultsQueue = [];
        this.placementResultsQueueHead = 0;
        this.dirtyManagers.clear();
        this.workerTerrainModelsPayload = null;
        if (this.placementProxy) {
            this.placementProxy[Comlink.releaseProxy]();
            this.placementProxy = null;
        }
        this.placementWorker?.terminate();
        this.placementWorker = null;
    }

    public getDebugStats() {
        return {
            modelsReady: this.modelsReady,
            queue: this.getUpdateQueueLength(),
            instances: this.totalInstancesAdded,
        };
    }

    public printDebugSnapshot() {
        console.table(this.getStatus());
    }
}
