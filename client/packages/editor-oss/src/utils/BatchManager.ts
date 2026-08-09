import {extendBatchedMeshPrototype, getBatchedMeshCount} from "@three.ez/batched-mesh-extensions";
import {
    Mesh,
    MeshStandardMaterial,
    Object3D,
    Group,
    Scene,
    BatchedMesh,
    BufferGeometry,
    Matrix4,
    Color,
    Vector2,
    Raycaster,
    Intersection,
} from "three";

import {DetectDevice} from "./DetectDevice";
import {
    createGeometryRevisionSnapshot,
    getGeometryHashSignature,
    hashGeometry,
    isGeometryRevisionCurrent,
    type GeometryRevisionSnapshot,
} from "./geometryHash";
import MaterialUtils, {convertMeshStandardToNodeMaterial, hasCustomTSLNodes, patchNodeMaterialSetup} from "./MaterialUtils";
import MeshUtils from "./MeshUtils";
import global from "../global";
import {getOrCreateDynamicRoot} from "@stem/editor-oss/scene/dynamicRoots";
import {
    hashBatchMaterial,
    hasPerInstanceBatchMaterialChange,
    hasSignificantBatchMaterialChange,
    isBatchMaterialSupported,
    snapshotBatchMaterial,
    type MaterialProperties,
} from "./BatchMaterialCompatibility";

extendBatchedMeshPrototype();

const BATCHABLE_EDITOR_GEOMETRY_TYPES = new Set([
    "BoxGeometry",
    "CircleGeometry",
    "ConeGeometry",
    "CylinderGeometry",
    "IcosahedronGeometry",
    "LatheGeometry",
    "PlaneGeometry",
    "SphereGeometry",
    "TetrahedronGeometry",
    "TeapotGeometry",
    "TorusGeometry",
    "TorusKnotGeometry",
]);

const BATCH_MAX_INSTANCES = 200;
const BATCH_MIN_VERTICES_COUNT = 10000;
const BATCH_MIN_INDICES_COUNT = 10000;
const BATCH_MIN_NEW_MESHES_PER_GROUP = 2;

type UniformValue = number | Color | Vector2 | null;

type BatchedMeshWithOriginals = BatchedMesh & {
    // optional helpers provided by @three.ez batched mesh extensions
    initUniformsPerInstance?: (spec: {vertex: Record<string, string>; fragment: Record<string, string>}) => void;
    uniformsTexture?: {needsUpdate?: boolean};
    setUniformAt?: (id: number, name: string, value: UniformValue) => void;
};

interface SceneWithBatchingUserData {
    userData?: {rendering?: {batching?: {enableDynamic?: boolean}}};
}

type MaterialCloneable = MeshStandardMaterial & {clone?: () => MeshStandardMaterial};
type BatchedRaycastIntersection = Intersection & {batchId?: number};

interface BatchedMeshData {
    originalMesh: Mesh;
    instanceId: number;
    geometryId: number;
    geometry: BufferGeometry;
    geometryUsage: GeometryUsage;
    geometryRevision: GeometryRevisionSnapshot;
    castShadow: boolean;
    receiveShadow: boolean;
    layersMask: number;
    renderOrder: number;
    material: MeshStandardMaterial;
    materialUsage: MaterialUsage;
    transform: Matrix4;
    materialProperties: MaterialProperties;
    lastUpdateSerial: number;
}

type MeshBatchEntry = {batchGroup: BatchGroup; meshData: BatchedMeshData};
type MaterialFrameChange = {serial: number; significant: boolean; perInstance: boolean};
type MaterialUsage = {count: number};
type GeometryUsage = {count: number; latestRevision: GeometryRevisionSnapshot};
type GeometryFrameRevision = {serial: number; current: boolean};
type ProgressiveBatchCandidate = {mesh: Mesh; batchKey: string};

interface BatchGroup {
    key: string;
    material: MeshStandardMaterial;
    batchedMesh: BatchedMesh;
    meshes: Map<Mesh, BatchedMeshData>;
    instanceIdToMesh: Map<number, Mesh>;
    materialHash: string;

    lodEnabled: boolean;
    customUniformsEnabled: boolean;
    geometries: Map<number, BufferGeometry>;
    boundsDirty: boolean;
    filled?: boolean;
}

interface BatchStat {
    batchKey: string; // batchKey with map sections removed
    geometryHashes: string[]; // hashes of geometries in the batch
    instanceCount: number;
    geometryCount: number;
    usedVertexCount: number;
    usedIndexCount: number;
}

interface GeometryHashCacheEntry {
    signature: string;
    hash: string;
}

/**
 * BatchManager
 *
 * Manages dynamic runtime batching of compatible Three.js meshes into BatchedMesh
 * groups. It scans the provided `Scene` for batchable meshes, creates and
 * maintains batch groups, and keeps per-instance transforms and per-instance
 * uniforms (when available) updated. Designed to be used by render systems
 * that need to reduce draw calls by merging many small meshes.
 */
export default class BatchManager {
    public readonly scene: Scene;

    private batchGroups: Map<string, BatchGroup[]> = new Map();
    private dirtyBatchBounds: Set<BatchGroup> = new Set();

    private sceneMeshes: Mesh[] = [];
    private sceneMeshSet: Set<Mesh> = new Set();
    private newMeshScratch: Mesh[] = [];
    private newMeshGroupScratch: Map<string, Mesh[]> = new Map();
    private progressiveCandidateGroups: Map<string, ProgressiveBatchCandidate[]> = new Map();
    private progressiveNewMeshes: ProgressiveBatchCandidate[] = [];
    private progressiveAnalysisCursor: number = 0;
    private progressiveQueueCursor: number = 0;
    private progressiveQueuePrepared: boolean = false;
    private sceneMeshRevision: number = 0;
    private progressiveWorkRevision: number = -1;
    private staleMeshRemovalPending: boolean = false;
    private retryableMeshes: Set<Mesh> = new Set();
    private materialFrameChanges: WeakMap<MeshStandardMaterial, MaterialFrameChange> = new WeakMap();
    private materialUsageByMaterial: WeakMap<MeshStandardMaterial, MaterialUsage> = new WeakMap();
    private geometryFrameRevisions: WeakMap<BufferGeometry, GeometryFrameRevision> = new WeakMap();
    private geometryUsageByGeometry: WeakMap<BufferGeometry, GeometryUsage> = new WeakMap();
    private batchUpdateSerial: number = 0;
    // Meshes that are under a static subtree (self or any ancestor has userData.isStatic === true)
    private staticMeshes: Set<Mesh> = new Set();

    private meshDataMap: Map<Mesh, MeshBatchEntry> = new Map();

    // Cache of geometry UUID to its full render-attribute batch hash.
    private geometryHashCache: Map<string, GeometryHashCacheEntry> = new Map();

    private nonBatchableMeshes: WeakSet<Mesh> = new WeakSet();

    // Root object for batched meshes
    private batchRoot: Object3D | null = null;

    // Objects that should be excluded from batching (e.g., currently selected/outlined)
    private excludedObjects: Set<Object3D> = new Set();

    private usedStatsBatchKeys: Set<string> = new Set();
    private statsIntervalId: ReturnType<typeof setInterval> | null = null;

    private readonly isPublishMode: boolean;

    private static readonly MAX_NEW_MESHES_PER_UPDATE = DetectDevice.getOS() === "iOS" ? 3 : Infinity;
    private static readonly MAX_PROGRESSIVE_MESHES_PER_UPDATE = DetectDevice.getOS() === "iOS" ? 3 : 64;
    private static readonly PROGRESSIVE_BATCH_TIME_BUDGET_MS = DetectDevice.getOS() === "iOS" ? 2 : 4;
    private static readonly PROGRESSIVE_TIME_CHECK_INTERVAL = 8;

    private _isWebGPU: boolean = false;

    public set isWebGPU(value: boolean) {
        this._isWebGPU = value;
    }
    public get isWebGPU(): boolean {
        return this._isWebGPU;
    }

    public getBatchRoot(): Object3D | null {
        return this.batchRoot;
    }

    private usesExternalSceneMeshes: boolean = false;
    private externalSceneMeshesDirty: boolean = false;
    private externalSceneMeshSource: readonly Mesh[] | null = null;
    private externalSceneMeshSourceRevision: number | null = null;

    private hiddenOriginalMeshes: Map<Mesh, boolean> = new Map();

    constructor(scene: Scene) {
        this.scene = scene;
        this.isPublishMode = !!global.app?.options?.isPlayModeOnly;
        this.findOrCreateBatchRoot();

        // Editor-only persistence used to size future batches after scene edits.
        // Published/play-only runtimes should not wake up just to mutate scene metadata.
        if (!this.isPublishMode) {
            this.statsIntervalId = setInterval(() => {
                this.storeBatchStats();
            }, 5000);
        }
    }

    /**
     * Batch all eligible meshes currently in the scene.
     * Scans the scene, collects batchable meshes and adds them to batches.
     * @returns {number} The number of meshes newly added to batches
     */
    public batchSceneMeshes(): number {
        if (!this.isDynamicBatchingEnabled()) {
            return 0;
        }

        this.collectSceneMeshes();
        return this.addNewMeshesFromList(BatchManager.MAX_NEW_MESHES_PER_UPDATE);
    }

    /**
     * Update the set of objects that should be excluded from batching.
     * Their descendants will also be excluded.
     * @param {Set<Object3D>|Object3D[]|null|undefined} objects Objects to exclude (set or array)
     * @returns {void}
     */
    public setExcludedObjects(objects: Set<Object3D> | Object3D[] | null | undefined): void {
        if (objects instanceof Set) {
            // Use the provided set directly to avoid copying large selections
            this.excludedObjects = objects;
        } else {
            this.excludedObjects.clear();
            if (Array.isArray(objects)) {
                for (let i = 0; i < objects.length; i++) {
                    const obj = objects[i];
                    if (obj) this.excludedObjects.add(obj);
                }
            }
        }
        if (this.usesExternalSceneMeshes) {
            this.refreshExternalSceneAnalysis();
            this.invalidateProgressiveBatchWork();
            this.externalSceneMeshesDirty = true;
        }
        // The renderer supplies its external mesh snapshot before the next draw and then
        // reconciles under the progressive budget. Running a scene traversal here would
        // make outline setup synchronously batch the whole scene during startup.
    }

    /**
     * Re-evaluate the scene and update batches to handle new/removed meshes.
     * This will add new batchable meshes and remove stale ones.
     * @returns {void}
     */
    public updateBatchesForSceneChanges(): void {
        if (!this.isDynamicBatchingEnabled()) {
            return;
        }

        if (this.usesExternalSceneMeshes) {
            if (!this.externalSceneMeshesDirty && !this.hasRetryableMeshBecomeBatchable()) return;
        } else {
            this.collectSceneMeshes();
            this.addNewMeshesFromList(BatchManager.MAX_NEW_MESHES_PER_UPDATE);
            this.removeStaleMeshes();
            return;
        }

        const pending = this.addNewMeshesProgressively(
            BatchManager.MAX_PROGRESSIVE_MESHES_PER_UPDATE,
            BatchManager.PROGRESSIVE_BATCH_TIME_BUDGET_MS,
        );

        if (this.staleMeshRemovalPending) {
            this.removeStaleMeshes();
            this.staleMeshRemovalPending = false;
        }

        this.externalSceneMeshesDirty = pending;
    }

    /**
     * Clear all batches and release batched resources.
     * @returns {void}
     */
    public clear(): void {
        this.showOriginalMeshes();
        for (const batchGroups of this.batchGroups.values()) {
            for (const batchGroup of batchGroups) {
                try {
                    this.disposeBatchedMesh(batchGroup);
                } catch {
                    /* ignore per-batchGroup dispose errors */
                }

                // Clear per-group collections to drop references
                try {
                    batchGroup.meshes.clear();
                    batchGroup.instanceIdToMesh.clear();
                } catch {
                    /* ignore */
                }
                try {
                    batchGroup.geometries.clear();
                } catch {
                    /* ignore */
                }
            }
        }
        this.batchGroups.clear();
        this.dirtyBatchBounds.clear();

        // Drop references to original meshes and analysis caches
        this.meshDataMap.clear();
        this.sceneMeshes.length = 0;
        this.sceneMeshSet.clear();
        this.newMeshScratch.length = 0;
        this.newMeshGroupScratch.clear();
        this.progressiveCandidateGroups.clear();
        this.progressiveNewMeshes.length = 0;
        this.progressiveAnalysisCursor = 0;
        this.progressiveQueueCursor = 0;
        this.progressiveQueuePrepared = false;
        this.sceneMeshRevision = 0;
        this.progressiveWorkRevision = -1;
        this.staleMeshRemovalPending = false;
        this.retryableMeshes.clear();
        this.hiddenOriginalMeshes.clear();
        this.usedStatsBatchKeys.clear();
        this.usesExternalSceneMeshes = false;
        this.externalSceneMeshesDirty = false;
        this.externalSceneMeshSource = null;
        this.externalSceneMeshSourceRevision = null;
    }

    /**
     * Dispose the BatchManager and remove its batch root from the scene.
     * This also clears all batches.
     * @returns {void}
     */
    public dispose(): void {
        this.showOriginalMeshes();
        this.clear();
        if (this.batchRoot && this.batchRoot.parent) {
            this.batchRoot.parent.remove(this.batchRoot);
        }
        this.batchRoot = null;

        if (this.statsIntervalId) {
            clearInterval(this.statsIntervalId);
            this.statsIntervalId = null;
        }

        // Ensure all remaining references are dropped for GC friendliness
        this.excludedObjects.clear();
        this.geometryHashCache.clear();
    }

    public setSceneMeshes(meshes: Mesh[], sourceRevision?: number): void {
        this.usesExternalSceneMeshes = true;
        if (
            sourceRevision !== undefined &&
            meshes === this.externalSceneMeshSource &&
            sourceRevision === this.externalSceneMeshSourceRevision
        ) {
            return;
        }
        if (sourceRevision === undefined && this.hasSameSceneMeshes(meshes)) return;

        this.sceneMeshes.length = meshes.length;
        for (let i = 0; i < this.sceneMeshes.length; i++) {
            this.sceneMeshes[i] = meshes[i]!;
        }
        this.externalSceneMeshSource = meshes;
        this.externalSceneMeshSourceRevision = sourceRevision ?? null;
        this.refreshExternalSceneAnalysis();
        this.invalidateProgressiveBatchWork();
        this.externalSceneMeshesDirty = true;
    }

    private hasSameSceneMeshes(meshes: Mesh[]): boolean {
        if (meshes.length !== this.sceneMeshes.length) return false;
        for (let i = 0; i < this.sceneMeshes.length; i++) {
            if (meshes[i] !== this.sceneMeshes[i]) return false;
        }
        return true;
    }

    private refreshExternalSceneAnalysis(): void {
        this.sceneMeshSet.clear();
        this.staticMeshes.clear();

        for (let i = 0; i < this.sceneMeshes.length; i++) {
            const mesh = this.sceneMeshes[i];
            if (!mesh || this.isExcludedOrDescendant(mesh)) continue;
            this.sceneMeshSet.add(mesh);

            let current: Object3D | null = mesh;
            while (current) {
                if (current.userData?.isStatic === true) {
                    this.staticMeshes.add(mesh);
                    break;
                }
                current = current.parent;
            }
        }
    }

    /**
     * Returns true if the provided mesh is currently part of an active batch group.
     * Useful for traversal code (e.g. SceneTraverser) to skip / hide original meshes
     * that are already represented by a BatchedMesh draw call.
     * @param mesh The mesh to test.
     * @returns Whether the mesh is currently batched.
     */
    public isMeshBatched(mesh: Mesh): boolean {
        return this.meshDataMap.has(mesh);
    }

    /**
     * Hide the original (source) meshes for all batches and show the batched meshes instead.
     * @returns {void}
     */
    public hideOriginalMeshes(): void {
        if (!this.isDynamicBatchingEnabled()) return;

        // A newly-created or moved batch must have a valid aggregate bound before
        // it becomes renderable. If bound computation fails we deliberately leave
        // whole-batch culling disabled while retaining safe per-object culling.
        this.flushDirtyBatchBounds();

        for (const batchGroups of this.batchGroups.values()) {
            for (const batchGroup of batchGroups) {
                for (const meshData of batchGroup.meshes.values()) {
                    const mesh = meshData.originalMesh;
                    if (!this.hiddenOriginalMeshes.has(mesh)) {
                        this.hiddenOriginalMeshes.set(mesh, mesh.visible);
                    }
                    mesh.visible = false;
                }
                batchGroup.batchedMesh.visible = true;
            }
        }
    }

    /**
     * Restore visibility of original meshes (do not show batched meshes).
     * @returns {void}
     */
    public showOriginalMeshes(): void {
        for (const batchGroups of this.batchGroups.values()) {
            for (const batchGroup of batchGroups) {
                batchGroup.batchedMesh.visible = false;
            }
        }

        for (const [mesh, visible] of this.hiddenOriginalMeshes) {
            mesh.visible = visible;
        }

        this.hiddenOriginalMeshes.clear();
    }

    private isDynamicBatchingEnabled(): boolean {
        try {
            const userData = (this.scene as SceneWithBatchingUserData).userData;
            return !(userData?.rendering?.batching?.enableDynamic === false);
        } catch {
            return true;
        }
    }

    /**
     * Collects stats about all BatchedMeshes managed by this BatchManager.
     * Returns an array of stats for each batch group.
     * @returns {Array<BatchStat>} Array of batch stats objects
     */
    public getBatchStats(): Array<BatchStat> {
        const stats: Array<BatchStat> = [];
        for (const [batchKey, batchGroups] of this.batchGroups.entries()) {
            let sumInstanceCount = 0;
            let sumGeometryCount = 0;
            let sumUsedVertexCount = 0;
            let sumUsedIndexCount = 0;
            for (const batchGroup of batchGroups) {
                const bm = batchGroup.batchedMesh;
                sumInstanceCount += bm.instanceCount;
                const stats = this.getBatchedMeshStats(bm);
                sumGeometryCount += stats.geometryCount;
                sumUsedVertexCount += stats.usedVertexCount;
                sumUsedIndexCount += stats.usedIndexCount;
            }
            stats.push({
                batchKey,
                instanceCount: sumInstanceCount,
                geometryCount: sumGeometryCount,
                geometryHashes: [],
                usedVertexCount: Math.max(BATCH_MIN_VERTICES_COUNT, sumUsedVertexCount),
                usedIndexCount: Math.max(BATCH_MIN_INDICES_COUNT, sumUsedIndexCount),
            });
        }
        return stats;
    }

    private findOrCreateBatchRoot(): void {
        const dynamicObject = getOrCreateDynamicRoot(this.scene);

        this.batchRoot = new Group();
        this.batchRoot.name = "BatchRoot";
        dynamicObject.add(this.batchRoot);

        this.batchRoot.userData.isRuntimeOnly = true;
        this.batchRoot.userData.isSelectable = false;
    }

    private updateMeshTransform(mesh: Mesh, entry: MeshBatchEntry): void {
        // In publish mode, static subtrees are batched once and never updated
        if (this.isPublishMode && this.staticMeshes.has(mesh)) return;
        const {batchGroup, meshData} = entry;

        if (this.hasMatrixChangedSinceLastUpdate(mesh.matrixWorld, meshData.transform)) {
            meshData.transform.copy(mesh.matrixWorld);
            batchGroup.batchedMesh.setMatrixAt(meshData.instanceId, meshData.transform);
            this.markBatchBoundsDirty(batchGroup);
        }
    }

    private updateMeshMaterial(mesh: Mesh, entry: MeshBatchEntry): void {
        if (this.isPublishMode && this.staticMeshes.has(mesh)) return;
        const {batchGroup, meshData} = entry;

        const material = mesh.material as MeshStandardMaterial;
        const oldProps = meshData.materialProperties;
        const useFrameCache = material === meshData.material && meshData.materialUsage.count > 1;
        const cachedChange = useFrameCache ? this.materialFrameChanges.get(material) : undefined;
        let significantChange: boolean;
        let perInstanceChanged: boolean;
        if (cachedChange?.serial === this.batchUpdateSerial) {
            significantChange = cachedChange.significant;
            perInstanceChanged = cachedChange.perInstance;
        } else {
            significantChange = this.hasSignificantMaterialChange(oldProps, material);
            perInstanceChanged = !significantChange && this.hasPerInstanceMaterialChange(oldProps, material);
            if (useFrameCache) {
                this.materialFrameChanges.set(material, {
                    serial: this.batchUpdateSerial,
                    significant: significantChange,
                    perInstance: perInstanceChanged,
                });
            }
        }

        if (significantChange) {
            // Re-batch for changes that alter the material program or textures
            this.removeMesh(mesh);
            this.addMesh(mesh);
            return;
        }

        if (perInstanceChanged) {
            if (batchGroup.customUniformsEnabled) {
                try {
                    const batchedMesh = batchGroup.batchedMesh as BatchedMeshWithOriginals;

                    // Determine exactly which uniforms changed
                    const o = oldProps;
                    const n = material;

                    // Helper to compare colors safely
                    const colorChanged = (() => {
                        const oc = o.color ?? null;
                        const nc = n.color ?? null;
                        if (oc === null && nc === null) return false;
                        if (oc === null || nc === null) return true;
                        return !(oc.equals && oc.equals(nc));
                    })();

                    const emissiveChanged = (() => {
                        const oe = o.emissive ?? null;
                        const ne = n.emissive ?? null;
                        if (oe === null && ne === null) return false;
                        if (oe === null || ne === null) return true;
                        return !(oe.equals && oe.equals(ne));
                    })();

                    let anyUpdated = false;
                    const id = meshData.instanceId;

                    if (o.metalness !== n.metalness) {
                        batchedMesh.setUniformAt?.(id, "metalness", material.metalness);
                        anyUpdated = true;
                    }
                    if (o.roughness !== n.roughness) {
                        batchedMesh.setUniformAt?.(id, "roughness", material.roughness);
                        anyUpdated = true;
                    }
                    if (o.opacity !== n.opacity) {
                        batchedMesh.setUniformAt?.(id, "opacity", material.opacity);
                        anyUpdated = true;
                    }
                    if (colorChanged) {
                        batchedMesh.setUniformAt?.(id, "diffuse", material.color);
                        anyUpdated = true;
                    }
                    if (emissiveChanged) {
                        batchedMesh.setUniformAt?.(id, "emissive", material.emissive);
                        anyUpdated = true;
                    }
                    if (o.emissiveIntensity !== n.emissiveIntensity) {
                        batchedMesh.setUniformAt?.(id, "emissiveIntensity", material.emissiveIntensity);
                        anyUpdated = true;
                    }

                    if (anyUpdated) {
                        // There is a bug in @three.ez/batched-mesh-extensions, so we need to update uniformsTexture manually
                        if (batchedMesh.uniformsTexture) {
                            batchedMesh.uniformsTexture.needsUpdate = true;
                        }
                    }

                    // Refresh cached properties regardless so future diffs are correct
                    this.setTrackedMeshMaterial(meshData, material);
                    meshData.materialProperties = this.extractMaterialProperties(material);
                } catch {
                    // As a fallback, re-batch this mesh to a group that can accommodate its material
                    this.removeMesh(mesh);
                    this.addMesh(mesh);
                }
            } else {
                // Per-instance uniforms are not available for this batch (likely due to textures).
                // We update the cached properties but cannot reflect per-instance color without rebatching
                // into a texture-less/custom-uniforms-enabled group.
                this.setTrackedMeshMaterial(meshData, material);
                meshData.materialProperties = this.extractMaterialProperties(material);
            }
            return;
        }

        this.setTrackedMeshMaterial(meshData, material);
    }

    private setTrackedMeshMaterial(meshData: BatchedMeshData, material: MeshStandardMaterial): void {
        if (meshData.material === material) return;
        this.decrementMaterialUsage(meshData.materialUsage);
        meshData.material = material;
        meshData.materialUsage = this.incrementMaterialUsage(material);
    }

    private incrementMaterialUsage(material: MeshStandardMaterial): MaterialUsage {
        let usage = this.materialUsageByMaterial.get(material);
        if (!usage) {
            usage = {count: 0};
            this.materialUsageByMaterial.set(material, usage);
        }
        usage.count++;
        return usage;
    }

    private decrementMaterialUsage(usage: MaterialUsage): void {
        usage.count = Math.max(0, usage.count - 1);
    }

    private trackGeometry(geometry: BufferGeometry): {
        usage: GeometryUsage;
        revision: GeometryRevisionSnapshot;
    } {
        let usage = this.geometryUsageByGeometry.get(geometry);
        if (!usage) {
            usage = {count: 0, latestRevision: createGeometryRevisionSnapshot(geometry)};
            this.geometryUsageByGeometry.set(geometry, usage);
        } else if (!isGeometryRevisionCurrent(geometry, usage.latestRevision)) {
            usage.latestRevision = createGeometryRevisionSnapshot(geometry);
        }
        usage.count++;
        return {usage, revision: usage.latestRevision};
    }

    private decrementGeometryUsage(usage: GeometryUsage): void {
        usage.count = Math.max(0, usage.count - 1);
    }

    private handleBatchOverflow(
        batchKey: string,
        geometry: BufferGeometry,
        material: MeshStandardMaterial,
        layersMask: number,
        renderOrder: number,
    ): BatchGroup {
        // console.warn(`[BatchManager] Batch group ${batchKey} is full, creating new batch group`);

        const batchGroup = this.createBatchGroup(geometry, material, batchKey, layersMask, renderOrder);

        let batchGroups = this.batchGroups.get(batchKey);
        if (!batchGroups) {
            batchGroups = [];
            this.batchGroups.set(batchKey, batchGroups);
        }
        batchGroups.push(batchGroup);

        // console.log(`[BatchManager] Created new batch group: ${newBatchKey}`);
        return batchGroup;
    }

    private addMesh(mesh: Mesh, validatedBatchKey?: string): boolean {
        if (validatedBatchKey === undefined && !this.canBatch(mesh)) return false;

        const batchKey = validatedBatchKey ?? this.createMeshBatchKey(mesh);
        if (!batchKey) return false;

        const material = mesh.material as MeshStandardMaterial;
        const geometry = mesh.geometry;

        let batchGroup = this.getOrCreateBatchGroup(
            batchKey,
            geometry,
            material,
            mesh.layers.mask,
            mesh.renderOrder,
        );

        let geometryId = this.findGeometryIdInBatchGroup(batchGroup, geometry);
        if (geometryId === -1) {
            try {
                geometryId = batchGroup.batchedMesh.addGeometry(geometry);
                batchGroup.geometries.set(geometryId, geometry);
            } catch {
                // console.warn(
                //     `[BatchManager] Geometry overflow in batch group ${batchKey}, creating new batch group`,
                //     error,
                // );

                batchGroup.filled = true;

                batchGroup = this.handleBatchOverflow(
                    batchKey,
                    geometry,
                    material,
                    mesh.layers.mask,
                    mesh.renderOrder,
                );
                try {
                    geometryId = batchGroup.batchedMesh.addGeometry(geometry);
                } catch {
                    geometryId = -1;
                }
            }
        }

        if (geometryId === -1) {
            console.error(
                `Something went wrong when adding geometry to batch group. Batch key: ${batchKey}`,
                JSON.stringify(this.getBatchStats()),
            );
            return false;
        }

        let instanceId: number;
        try {
            instanceId = batchGroup.batchedMesh.addInstance(geometryId);
        } catch {
            // console.error(`[BatchManager] Failed to add instance to batch group:`);
            return false;
        }

        const transform = mesh.matrixWorld.clone();
        batchGroup.batchedMesh.setMatrixAt(instanceId, transform);

        if (batchGroup.customUniformsEnabled) {
            try {
                const batchedMesh = batchGroup.batchedMesh as BatchedMeshWithOriginals;

                if (batchedMesh.setUniformAt) {
                    batchedMesh.setUniformAt(instanceId, "metalness", material.metalness);
                    batchedMesh.setUniformAt(instanceId, "roughness", material.roughness);
                    batchedMesh.setUniformAt(instanceId, "opacity", material.opacity);
                    batchedMesh.setUniformAt(instanceId, "diffuse", material.color);
                    batchedMesh.setUniformAt(instanceId, "emissive", material.emissive);
                    batchedMesh.setUniformAt(instanceId, "emissiveIntensity", material.emissiveIntensity);
                }
                // There is a bug in @three.ez/batched-mesh-extensions, so we need to update uniformsTexture manually
                if (batchedMesh.uniformsTexture) {
                    batchedMesh.uniformsTexture.needsUpdate = true;
                }
            } catch {
                // console.warn(`[BatchManager] Failed to set per-instance uniforms for mesh ${mesh.id}`);
            }
        }

        const geometryTracking = this.trackGeometry(geometry);
        const meshData: BatchedMeshData = {
            originalMesh: mesh,
            instanceId,
            geometryId,
            geometry,
            geometryUsage: geometryTracking.usage,
            geometryRevision: geometryTracking.revision,
            castShadow: mesh.castShadow,
            receiveShadow: mesh.receiveShadow,
            layersMask: mesh.layers.mask,
            renderOrder: mesh.renderOrder,
            material,
            materialUsage: this.incrementMaterialUsage(material),
            transform,
            materialProperties: this.extractMaterialProperties(material),
            lastUpdateSerial: this.batchUpdateSerial,
        };

        batchGroup.meshes.set(mesh, meshData);
        batchGroup.instanceIdToMesh.set(instanceId, mesh);
        this.meshDataMap.set(mesh, {batchGroup, meshData});
        this.markBatchBoundsDirty(batchGroup);

        batchGroup.batchedMesh.visible = false;

        // Set batched mesh shadow flags based on this mesh
        batchGroup.batchedMesh.castShadow = mesh.castShadow;
        batchGroup.batchedMesh.receiveShadow = mesh.receiveShadow;

        // Print batch stats after adding a mesh

        return true;
    }

    private removeMesh(mesh: Mesh): void {
        const entry = this.meshDataMap.get(mesh);
        if (!entry) return;

        const {batchGroup, meshData} = entry;
        const batchKey = batchGroup.key;

        batchGroup.batchedMesh.deleteInstance(meshData.instanceId);
        batchGroup.meshes.delete(mesh);
        batchGroup.instanceIdToMesh.delete(meshData.instanceId);
        this.meshDataMap.delete(mesh);
        if (batchGroup.meshes.size > 0) {
            this.markBatchBoundsDirty(batchGroup);
        } else {
            this.dirtyBatchBounds.delete(batchGroup);
        }
        this.decrementMaterialUsage(meshData.materialUsage);
        this.decrementGeometryUsage(meshData.geometryUsage);

        // If there are no remaining instances using this geometry, remove the geometry from the BatchedMesh
        const removedGeometryId = meshData.geometryId;
        let geometryStillUsed = false;
        for (const remaining of batchGroup.meshes.values()) {
            if (remaining.geometryId === removedGeometryId) {
                geometryStillUsed = true;
                break;
            }
        }
        if (!geometryStillUsed) {
            try {
                batchGroup.batchedMesh.deleteGeometry(removedGeometryId);
                batchGroup.batchedMesh.optimize();

                if (batchGroup.batchedMesh.geometry.attributes) {
                    for (const attribute of Object.values(batchGroup.batchedMesh.geometry.attributes)) {
                        attribute.needsUpdate = true;
                    }

                    if (batchGroup.batchedMesh.geometry.index) {
                        batchGroup.batchedMesh.geometry.index.needsUpdate = true;
                    }
                }
            } catch {
                // console.warn(`[BatchManager] Failed to delete geometry ${removedGeometryId} from batched mesh:`);
            }
            batchGroup.geometries.delete(removedGeometryId);
            batchGroup.filled = false;
        }

        if (batchGroup.meshes.size === 0) {
            // Remove BatchedMesh from the scene and dispose it when the group is empty
            this.disposeBatchedMesh(batchGroup);
            const batchGroups = this.batchGroups.get(batchKey);
            if (batchGroups) {
                const index = batchGroups.indexOf(batchGroup);
                if (index > -1) {
                    batchGroups.splice(index, 1);
                }
                if (batchGroups.length === 0) {
                    this.batchGroups.delete(batchKey);
                }
            }
        }
    }

    /**
     * Fully dispose a BatchedMesh and associated GPU resources to prevent memory leaks.
     * - Removes the mesh from the scene graph
     * - Disposes cloned/material copies if different from the group's original material
     * - Disposes uniformsTexture (DataTexture) if present
     * - Disposes batched mesh geometry buffers
     * - Calls batchedMesh.dispose() as a final safeguard
     *
     * @param batchGroup The batch group holding the BatchedMesh to dispose.
     */
    private disposeBatchedMesh(batchGroup: BatchGroup): void {
        const bm = batchGroup.batchedMesh as BatchedMesh & {
            material?: MeshStandardMaterial | {dispose?: () => void};
            uniformsTexture?: {dispose?: () => void};
            geometry?: {dispose?: () => void};
            dispose?: () => void;
        };

        try {
            if (bm.parent) bm.parent.remove(bm);
        } catch {
            /* ignore */
        }

        // If BatchedMesh uses a cloned material (not the original shared in the group), dispose it
        try {
            bm.material.dispose?.();
        } catch {
            /* ignore */
        }

        // Dispose per-instance uniforms texture if the extension provided one
        try {
            bm.uniformsTexture?.dispose?.();
        } catch {
            /* ignore */
        }

        // Dispose batched geometry buffers (attributes, index) to free GPU memory
        try {
            bm.geometry.dispose?.();
        } catch {
            /* ignore */
        }

        // Final safeguard
        try {
            bm.dispose?.();
        } catch {
            /* ignore */
        }
    }

    public canBatch(mesh: Mesh): boolean {
        if (
            (mesh as BatchedMesh).isBatchedMesh ||
            (mesh as Mesh & {isInstancedMesh?: boolean}).isInstancedMesh ||
            (mesh as Mesh & {isSkinnedMesh?: boolean}).isSkinnedMesh ||
            Array.isArray((mesh as Mesh & {morphTargetInfluences?: number[]}).morphTargetInfluences) ||
            !mesh.visible ||
            !mesh.geometry ||
            !mesh.material ||
            !mesh.geometry.getAttribute("position")
        ) {
            if (
                (mesh as Mesh & {isInstancedMesh?: boolean}).isInstancedMesh ||
                (mesh as Mesh & {isSkinnedMesh?: boolean}).isSkinnedMesh ||
                Array.isArray((mesh as Mesh & {morphTargetInfluences?: number[]}).morphTargetInfluences)
            ) {
                this.nonBatchableMeshes.add(mesh);
            }
            return false;
        }

        if (this.nonBatchableMeshes.has(mesh)) {
            return false;
        }

        if (mesh.userData?.isBatchable === false) {
            return false;
        }

        const material = mesh.material;

        // Authored TSL node graphs cannot be reproduced by the batching path,
        // which rebuilds its own node material for per-instance uniforms.
        if (Array.isArray(material)) {
            for (let i = 0; i < material.length; i++) {
                const entry = material[i];
                if (entry && hasCustomTSLNodes(entry)) {
                    this.nonBatchableMeshes.add(mesh);
                    return false;
                }
            }
        } else if (hasCustomTSLNodes(material)) {
            this.nonBatchableMeshes.add(mesh);
            return false;
        }

        if (mesh.constructor !== Mesh && !BATCHABLE_EDITOR_GEOMETRY_TYPES.has(mesh.geometry.type)) {
            this.nonBatchableMeshes.add(mesh);
            return false;
        }

        if (Array.isArray(material)) {
            return false;
        }

        if (this.isWebGPU) {
            // NOTE: WebGPU requires attribute data to be 4-byte aligned
            // Check all attributes for alignment, skip if any are misaligned
            // TODO: fix it on the THREE.js side
            for (const attrName in mesh.geometry.attributes) {
                const attr = mesh.geometry.attributes[attrName];
                if ((attr?.itemSize ?? 0) * (attr?.array?.BYTES_PER_ELEMENT ?? 0) % 4 !== 0) {
                    this.nonBatchableMeshes.add(mesh);
                    console.warn(
                        `BatchManager: cannot batch mesh ${mesh.id} due to unaligned attribute ${attrName}. Object:`,
                        mesh,
                    );
                    return false;
                }
            }
        }

        return MaterialUtils.isMeshStandardMaterial(material) && isBatchMaterialSupported(material);
    }

    public isExcluded(object: Object3D): boolean {
        return this.excludedObjects.has(object);
    }

    private isExcludedOrDescendant(object: Object3D): boolean {
        let current: Object3D | null = object;
        while (current) {
            if (this.excludedObjects.has(current)) {
                return true;
            }
            current = current.parent;
        }
        return false;
    }

    private createBatchKey(geometry: BufferGeometry, material: MeshStandardMaterial): string {
        // TODO: temporarily using full geometry hash to disable batching objects with different geometries
        const geometryHash = this.hashGeometry(geometry);
        const materialHash = this.hashMaterial(material);

        return `${geometryHash}_${materialHash}`;
    }

    private createMeshBatchKey(mesh: Mesh): string | null {
        if (Array.isArray(mesh.material)) {
            return null;
        }

        if (!MaterialUtils.isMeshStandardMaterial(mesh.material)) {
            return null;
        }

        const baseKey = this.createBatchKey(mesh.geometry, mesh.material);
        // Camera layers and render order are draw-level properties on BatchedMesh.
        // They must be identical across sources or authored visibility/order is lost.
        return `${baseKey}_cs${mesh.castShadow ? 1 : 0}_rs${mesh.receiveShadow ? 1 : 0}_ly${mesh.layers.mask}_ro${mesh.renderOrder}`;
    }

    private hashMaterial(material: MeshStandardMaterial): string {
        return hashBatchMaterial(material);
    }

    private findGeometryIdInBatchGroup(batchGroup: BatchGroup, geometry: BufferGeometry): number {
        for (const [geometryId, existingGeometry] of batchGroup.geometries) {
            if (this.areGeometriesEquivalent(geometry, existingGeometry)) {
                return geometryId;
            }
        }
        return -1;
    }

    private areGeometriesEquivalent(geometry1: BufferGeometry, geometry2: BufferGeometry): boolean {
        return this.hashGeometry(geometry1) === this.hashGeometry(geometry2);
    }

    private hashGeometry(geometry: BufferGeometry): string {
        const signature = getGeometryHashSignature(geometry);
        const cached = this.geometryHashCache.get(geometry.uuid);
        if (cached && cached.signature === signature) return cached.hash;

        const hash = hashGeometry(geometry);
        this.geometryHashCache.set(geometry.uuid, {signature, hash});
        return hash;
    }

    private createBatchGroup(
        geometry: BufferGeometry,
        material: MeshStandardMaterial,
        batchKey: string,
        layersMask: number,
        renderOrder: number,
    ): BatchGroup {
        const {maxInstanceCount, maxVertexCount, maxIndexCount} = this.getOptimalBatchCapacity(batchKey, [geometry]);

        const nodeMaterial = convertMeshStandardToNodeMaterial(material);

        const batchedMesh = new BatchedMesh(maxInstanceCount, maxVertexCount, maxIndexCount, nodeMaterial);

        // Per-instance bounds are maintained by BatchedMesh from the source
        // geometries. Whole-batch culling is enabled only after we compute the
        // aggregate sphere, so an incomplete batch can never disappear.
        batchedMesh.perObjectFrustumCulled = true;
        batchedMesh.frustumCulled = false;
        // Opaque draw order has no visual effect and sorting it is O(N log N).
        batchedMesh.sortObjects = material.transparent;
        batchedMesh.layers.mask = layersMask;
        batchedMesh.renderOrder = renderOrder;

        // Make dispose idempotent: guard against double-dispose calls which may throw
        try {
            const bmInternal = batchedMesh as BatchedMeshWithOriginals;
            // eslint-disable-next-line
            const originalDispose = bmInternal.dispose;
            let isDisposed = false;
            bmInternal.dispose = (function () {
                return function (): BatchedMeshWithOriginals {
                    if (isDisposed) return bmInternal;
                    isDisposed = true;
                    try {
                        if (originalDispose) originalDispose();
                    } catch {
                        // swallow errors during dispose to keep idempotent behaviour
                    }
                    return bmInternal;
                };
            })();
        } catch {
            // ignore - best-effort only
        }

        const batchGroup: BatchGroup = {
            key: batchKey,
            material,
            batchedMesh,
            meshes: new Map(),
            instanceIdToMesh: new Map(),
            materialHash: this.hashMaterial(material),
            lodEnabled: false,
            customUniformsEnabled: false,
            geometries: new Map(),
            boundsDirty: true,
        };

        // Name the batched material as Batched_<materialHash> for easier debugging/inspection.
        try {
            const bmInternal = batchedMesh as BatchedMeshWithOriginals;
            // Avoid mutating the original material name: clone if it's the same instance.
            if (bmInternal.material === material) {
                const materialWithClone = material as MaterialCloneable;
                if (typeof materialWithClone.clone === "function") {
                    const cloned = materialWithClone.clone();
                    bmInternal.material = cloned || material;
                } else {
                    bmInternal.material = material;
                }
            }
            if (bmInternal.material && typeof bmInternal.material === "object") {
                // name is not strongly typed on material, use a safe assignment
                (bmInternal.material as {name?: string}).name = `Batched_${batchGroup.materialHash}`;
            }
        } catch {
            // ignore
        }

        const uniformsInit = (batchedMesh as BatchedMeshWithOriginals).initUniformsPerInstance;
        if (typeof uniformsInit === "function") {
            try {
                uniformsInit.call(batchedMesh, {
                    vertex: {},
                    fragment: {
                        metalness: "float",
                        roughness: "float",
                        opacity: "float",
                        diffuse: "vec3",
                        emissive: "vec3",
                        emissiveIntensity: "float",
                    },
                });
                batchGroup.customUniformsEnabled = true;

                patchNodeMaterialSetup(nodeMaterial, batchedMesh);

                batchedMesh.material.needsUpdate = true;

                // console.log(`[BatchManager] Initialized per-instance uniforms for batch group: ${batchKey}`);
            } catch {
                // console.warn(`[BatchManager] Error initializing per-instance uniforms`);
                batchGroup.customUniformsEnabled = false;
            }
        } else {
            batchGroup.customUniformsEnabled = false;
        }

        if (this.batchRoot) {
            this.batchRoot.add(batchedMesh);
        }

        const originalBatchedRaycast = batchedMesh.raycast.bind(batchedMesh);
        const tempIntersects: BatchedRaycastIntersection[] = [];
        batchedMesh.raycast = (raycaster: Raycaster, intersects: Intersection[]) => {
            tempIntersects.length = 0;
            originalBatchedRaycast(raycaster, tempIntersects);
            for (const inter of tempIntersects) {
                const instanceId = typeof inter.instanceId === "number" ? inter.instanceId : inter.batchId;
                const mesh = typeof instanceId === "number" ? batchGroup.instanceIdToMesh.get(instanceId) : undefined;
                if (mesh) {
                    intersects.push(Object.assign({}, inter, {object: mesh, instanceId}));
                }
            }
            tempIntersects.length = 0;
        };

        // track key on the batchGroup for quick lookups
        batchGroup.key = batchKey;
        return batchGroup;
    }

    private collectSceneMeshes(): void {
        this.usesExternalSceneMeshes = false;
        this.externalSceneMeshesDirty = false;
        this.externalSceneMeshSource = null;
        this.externalSceneMeshSourceRevision = null;
        this.sceneMeshes.length = 0;
        this.sceneMeshSet.clear();
        this.staticMeshes.clear();
        this.traverseSceneAnalysis(this.scene, this.sceneMeshes, false);
    }

    private addNewMeshesFromList(limit?: number): number {
        let added = 0;
        const newMeshes = this.newMeshScratch;
        const candidateGroups = this.newMeshGroupScratch;
        newMeshes.length = 0;
        candidateGroups.clear();

        for (let i = 0; i < this.sceneMeshes.length; i++) {
            const mesh = this.sceneMeshes[i];
            if (!mesh || this.meshDataMap.has(mesh) || this.isExcludedOrDescendant(mesh)) {
                continue;
            }
            if (!this.canBatch(mesh)) {
                if (!this.nonBatchableMeshes.has(mesh)) this.retryableMeshes.add(mesh);
                continue;
            }
            this.retryableMeshes.delete(mesh);

            const batchKey = this.createMeshBatchKey(mesh);
            if (!batchKey) {
                continue;
            }

            let groupedMeshes = candidateGroups.get(batchKey);
            if (!groupedMeshes) {
                groupedMeshes = [];
                candidateGroups.set(batchKey, groupedMeshes);
            }
            groupedMeshes.push(mesh);
        }

        for (const [batchKey, groupedMeshes] of candidateGroups) {
            if (
                groupedMeshes.length >= BATCH_MIN_NEW_MESHES_PER_GROUP ||
                this.findAvailableBatchGroup(batchKey)
            ) {
                for (let i = 0; i < groupedMeshes.length; i++) {
                    const mesh = groupedMeshes[i];
                    if (mesh) newMeshes.push(mesh);
                }
            }
        }

        // NOTE: This sorting is important to ensure larger meshes are batched first
        // this helps avoid overflow issues with smaller meshes, and decrease memory usage and draw calls (win-win)
        if (newMeshes.length > 1) {
            newMeshes.sort((a, b) => (b.geometry.attributes.position?.count ?? 0) - (a.geometry.attributes.position?.count ?? 0));
        }

        for (const mesh of newMeshes) {
            if (limit !== undefined && added >= limit) break;
            if (this.addMesh(mesh)) {
                added++;
            }
        }

        newMeshes.length = 0;
        candidateGroups.clear();
        return added;
    }

    private invalidateProgressiveBatchWork(): void {
        this.sceneMeshRevision++;
        this.staleMeshRemovalPending = true;
        this.progressiveWorkRevision = -1;
        this.progressiveAnalysisCursor = 0;
        this.progressiveQueueCursor = 0;
        this.progressiveQueuePrepared = false;
        this.progressiveCandidateGroups.clear();
        this.progressiveNewMeshes.length = 0;
    }

    private now(): number {
        return globalThis.performance?.now() ?? Date.now();
    }

    private addNewMeshesProgressively(limit: number, timeBudgetMs: number): boolean {
        if (this.progressiveWorkRevision !== this.sceneMeshRevision) {
            this.progressiveWorkRevision = this.sceneMeshRevision;
            this.progressiveAnalysisCursor = 0;
            this.progressiveQueueCursor = 0;
            this.progressiveQueuePrepared = false;
            this.progressiveCandidateGroups.clear();
            this.progressiveNewMeshes.length = 0;
        }

        const startTime = this.now();
        let workSinceTimeCheck = 0;

        while (this.progressiveAnalysisCursor < this.sceneMeshes.length) {
            const mesh = this.sceneMeshes[this.progressiveAnalysisCursor++];
            if (mesh && !this.meshDataMap.has(mesh) && !this.isExcludedOrDescendant(mesh)) {
                if (!this.canBatch(mesh)) {
                    if (!this.nonBatchableMeshes.has(mesh)) this.retryableMeshes.add(mesh);
                } else {
                    this.retryableMeshes.delete(mesh);
                    const batchKey = this.createMeshBatchKey(mesh);
                    if (batchKey) {
                        let groupedMeshes = this.progressiveCandidateGroups.get(batchKey);
                        if (!groupedMeshes) {
                            groupedMeshes = [];
                            this.progressiveCandidateGroups.set(batchKey, groupedMeshes);
                        }
                        groupedMeshes.push({mesh, batchKey});
                    }
                }
            }

            workSinceTimeCheck++;
            if (
                workSinceTimeCheck >= BatchManager.PROGRESSIVE_TIME_CHECK_INTERVAL &&
                this.now() - startTime >= timeBudgetMs
            ) {
                return true;
            }
            if (workSinceTimeCheck >= BatchManager.PROGRESSIVE_TIME_CHECK_INTERVAL) workSinceTimeCheck = 0;
        }

        if (!this.progressiveQueuePrepared) {
            for (const [batchKey, groupedMeshes] of this.progressiveCandidateGroups) {
                if (
                    groupedMeshes.length >= BATCH_MIN_NEW_MESHES_PER_GROUP ||
                    this.findAvailableBatchGroup(batchKey)
                ) {
                    for (let i = 0; i < groupedMeshes.length; i++) {
                        const candidate = groupedMeshes[i];
                        if (candidate) this.progressiveNewMeshes.push(candidate);
                    }
                }
            }
            if (this.progressiveNewMeshes.length > 1) {
                this.progressiveNewMeshes.sort((a, b) =>
                    (b.mesh.geometry.attributes.position?.count ?? 0) -
                    (a.mesh.geometry.attributes.position?.count ?? 0));
            }
            this.progressiveCandidateGroups.clear();
            this.progressiveQueuePrepared = true;
            if (
                this.sceneMeshes.length >= BatchManager.PROGRESSIVE_TIME_CHECK_INTERVAL &&
                this.now() - startTime >= timeBudgetMs &&
                this.progressiveNewMeshes.length > 0
            ) return true;
        }

        let added = 0;
        let drainWork = 0;
        while (this.progressiveQueueCursor < this.progressiveNewMeshes.length) {
            const candidate = this.progressiveNewMeshes[this.progressiveQueueCursor++];
            if (!candidate) continue;
            drainWork++;
            const mesh = candidate.mesh;
            if (
                !this.sceneMeshSet.has(mesh) ||
                this.meshDataMap.has(mesh) ||
                this.isExcludedOrDescendant(mesh)
            ) continue;
            if (!this.canBatch(mesh)) {
                if (!this.nonBatchableMeshes.has(mesh)) this.retryableMeshes.add(mesh);
                continue;
            }
            const currentBatchKey = this.createMeshBatchKey(mesh);
            if (currentBatchKey !== candidate.batchKey) {
                this.invalidateProgressiveBatchWork();
                return true;
            }
            if (this.addMesh(mesh, currentBatchKey)) added++;
            if (
                added >= limit ||
                drainWork >= BatchManager.PROGRESSIVE_TIME_CHECK_INTERVAL &&
                this.now() - startTime >= timeBudgetMs
            ) return true;
            if (drainWork >= BatchManager.PROGRESSIVE_TIME_CHECK_INTERVAL) drainWork = 0;
        }

        this.progressiveNewMeshes.length = 0;
        this.progressiveQueueCursor = 0;
        return false;
    }

    private removeStaleMeshes(): void {
        if (this.meshDataMap.size === 0) return;
        for (const mesh of this.meshDataMap.keys()) {
            if (!this.sceneMeshSet.has(mesh)) this.removeMesh(mesh);
        }
    }

    private extractMaterialProperties(material: MeshStandardMaterial): MaterialProperties {
        return snapshotBatchMaterial(material);
    }

    private hasSignificantMaterialChange(oldProps: MaterialProperties, newProps: MeshStandardMaterial): boolean {
        return hasSignificantBatchMaterialChange(oldProps, newProps);
    }

    /**
     * Checks for changes in material properties that can be updated per-instance via uniforms
     * without requiring a full re-batch. This intentionally ignores properties that affect
     * program compilation (e.g., transparent) or textures.
     *
     * @param oldProps Previous material snapshot
     * @param newProps Current material snapshot
     * @returns true if any per-instance-updatable property changed
     */
    private hasPerInstanceMaterialChange(oldProps: MaterialProperties, newProps: MaterialProperties): boolean {
        return hasPerInstanceBatchMaterialChange(oldProps, newProps);
    }

    private getOptimalBatchCapacity(
        batchKey: string,
        geometries: BufferGeometry[],
    ): {
        maxInstanceCount: number;
        maxVertexCount: number;
        maxIndexCount: number;
    } {
        if (!this.usedStatsBatchKeys.has(batchKey)) {
            const stat = this.selectBatchStatFromUserData(batchKey, geometries);
            if (stat) {
                this.usedStatsBatchKeys.add(batchKey);
                return {
                    maxInstanceCount: Math.max(stat.instanceCount ?? BATCH_MAX_INSTANCES, BATCH_MAX_INSTANCES),
                    maxVertexCount: stat.usedVertexCount ?? 10000,
                    maxIndexCount: stat.usedIndexCount ?? 10000,
                };
            }
        }

        try {
            const {vertexCount, indexCount} = getBatchedMeshCount(geometries);

            return {
                maxInstanceCount: BATCH_MAX_INSTANCES,
                maxVertexCount: Math.max(BATCH_MIN_VERTICES_COUNT, Math.min(1_000_000, vertexCount * 3), vertexCount),
                maxIndexCount: Math.max(BATCH_MIN_INDICES_COUNT, Math.min(1_000_000, indexCount * 3), indexCount),
            };
        } catch {
            let totalVertices = 0;
            let totalIndices = 0;

            for (const geometry of geometries) {
                if (geometry.attributes.position) {
                    totalVertices += geometry.attributes.position.count;
                }
                if (geometry.index) {
                    totalIndices += geometry.index.count;
                }
            }

            return {
                maxInstanceCount: BATCH_MAX_INSTANCES,
                maxVertexCount: Math.max(
                    BATCH_MIN_VERTICES_COUNT,
                    Math.min(1_000_000, totalVertices * 3),
                    totalVertices,
                ),
                maxIndexCount: Math.max(BATCH_MIN_INDICES_COUNT, Math.min(1_000_000, totalIndices * 3), totalIndices),
            };
        }
    }

    /**
     * Selects a BatchStat from scene.userData.rendering.batching.stats matching the normalized batchKey and geometry hashes.
     * Used for batch sizing and can be reused in other methods.
     * @param batchKey The batch key to normalize and match.
     * @param geometries The array of BufferGeometry to match geometry hashes.
     * @returns The matching BatchStat if found, otherwise undefined.
     */
    private selectBatchStatFromUserData(batchKey: string, geometries: BufferGeometry[]): BatchStat | undefined {
        const modifiedBatchKey = this.normalizeBatchStatKey(batchKey);
        const inputGeometryHashes = geometries.map(g => this.hashGeometry(g));
        return this.selectBatchStatFromUserDataByHashes(modifiedBatchKey, inputGeometryHashes);
    }

    private normalizeBatchStatKey(batchKey: string): string {
        return batchKey
            .split("|")
            .filter(part => !this.isTextureMapBatchKeyPart(part))
            .join("|");
    }

    private isTextureMapBatchKeyPart(part: string): boolean {
        const separatorIndex = part.indexOf(":");
        if (separatorIndex === -1) {
            return false;
        }

        const key = part.slice(0, separatorIndex);
        return key === "map" || key.endsWith("Map");
    }

    private selectBatchStatFromUserDataByHashes(batchKey: string, inputGeometryHashes: string[]): BatchStat | undefined {
        const userData = (this.scene as SceneWithBatchingUserData).userData;
        const batchingObj = userData?.rendering?.batching as {stats?: BatchStat[]} | undefined;
        const statsArr = batchingObj?.stats;
        if (Array.isArray(statsArr)) {
            return statsArr.find(
                (s: BatchStat) =>
                    s.batchKey === batchKey &&
                    Array.isArray(s.geometryHashes) &&
                    inputGeometryHashes.some(hash => s.geometryHashes.includes(hash)),
            );
        }
        return undefined;
    }

    private selectBatchStatFromUserDataByKey(batchKey: string): BatchStat | undefined {
        const userData = (this.scene as SceneWithBatchingUserData).userData;
        const batchingObj = userData?.rendering?.batching as {stats?: BatchStat[]} | undefined;
        const statsArr = batchingObj?.stats;
        return Array.isArray(statsArr) ? statsArr.find((s: BatchStat) => s.batchKey === batchKey) : undefined;
    }

    private hasMatrixChangedSinceLastUpdate(currentMatrix: Matrix4, storedMatrix: Matrix4): boolean {
        const epsilon = 0.0001;

        for (let i = 0; i < 16; i++) {
            if (Math.abs((currentMatrix.elements[i] ?? 0) - (storedMatrix.elements[i] ?? 0)) > epsilon) {
                return true;
            }
        }

        return false;
    }

    private findAvailableBatchGroup(batchKey: string): BatchGroup | null {
        const batchGroups = this.batchGroups.get(batchKey);
        if (!batchGroups || batchGroups.length === 0) {
            return null;
        }

        for (const batchGroup of batchGroups) {
            // Skip batch groups marked as filled
            if (batchGroup.filled) continue;

            const currentInstanceCount = batchGroup.meshes.size;
            const maxInstanceCount = batchGroup.batchedMesh.maxInstanceCount;

            if (currentInstanceCount < maxInstanceCount) {
                return batchGroup;
            }
        }

        return null;
    }

    private getOrCreateBatchGroup(
        batchKey: string,
        geometry: BufferGeometry,
        material: MeshStandardMaterial,
        layersMask: number,
        renderOrder: number,
    ): BatchGroup {
        let batchGroup = this.findAvailableBatchGroup(batchKey);

        if (batchGroup) {
            return batchGroup;
        }

        // console.log(`[BatchManager] All batch groups for ${batchKey} are full, creating new batch group`);
        batchGroup = this.createBatchGroup(geometry, material, batchKey, layersMask, renderOrder);

        let batchGroups = this.batchGroups.get(batchKey);
        if (!batchGroups) {
            batchGroups = [];
            this.batchGroups.set(batchKey, batchGroups);
        }
        batchGroups.push(batchGroup);

        return batchGroup;
    }

    private updateBatchedMeshes(): void {
        this.batchUpdateSerial++;
        for (const [mesh, entry] of this.meshDataMap) {
            if (entry.meshData.lastUpdateSerial === this.batchUpdateSerial) continue;
            entry.meshData.lastUpdateSerial = this.batchUpdateSerial;

            // Static publish-mode meshes are immutable by contract. They still
            // need the cheap eligibility and structural checks below so a hidden,
            // disabled, malformed, or structurally edited mesh can safely leave
            // the batch, but they do not need the full canBatch/material/transform
            // reconciliation on every frame. Dynamic meshes retain the complete
            // path below.
            if (
                this.isPublishMode &&
                this.staticMeshes.has(mesh) &&
                mesh.visible &&
                mesh.userData?.isBatchable !== false &&
                mesh.geometry &&
                !Array.isArray(mesh.material) &&
                mesh.material &&
                mesh.geometry.getAttribute("position") &&
                !this.hasBatchStructureChanged(mesh, entry.meshData)
            ) {
                continue;
            }

            if (!this.canBatch(mesh)) {
                if (!this.nonBatchableMeshes.has(mesh)) this.retryableMeshes.add(mesh);
                this.removeMesh(mesh);
                continue;
            }
            if (this.hasBatchStructureChanged(mesh, entry.meshData)) {
                this.removeMesh(mesh);
                this.addMesh(mesh);
                continue;
            }
            this.updateMeshTransform(mesh, entry);
            this.updateMeshMaterial(mesh, entry);
        }
        this.flushDirtyBatchBounds();
    }

    /**
     * Recompute aggregate culling spheres only for batches whose membership or
     * transforms changed. BatchedMesh performs per-instance culling itself, but
     * the renderer needs this aggregate sphere to reject an entirely offscreen
     * batch before invoking BatchedMesh.onBeforeRender().
     */
    private flushDirtyBatchBounds(): void {
        for (const batchGroup of this.dirtyBatchBounds) {
            this.dirtyBatchBounds.delete(batchGroup);
            if (!batchGroup.boundsDirty || batchGroup.meshes.size === 0) continue;

            const batchedMesh = batchGroup.batchedMesh;
            try {
                batchedMesh.computeBoundingSphere();
                batchGroup.boundsDirty = false;
                batchedMesh.frustumCulled = true;
            } catch {
                // Fail open: per-object culling remains valid and rendering the
                // batch is preferable to dropping visible gameplay objects.
                batchedMesh.frustumCulled = false;
            }
        }
    }

    private markBatchBoundsDirty(batchGroup: BatchGroup): void {
        batchGroup.boundsDirty = true;
        this.dirtyBatchBounds.add(batchGroup);
    }

    private hasRetryableMeshBecomeBatchable(): boolean {
        for (const mesh of this.retryableMeshes) {
            if (!this.sceneMeshSet.has(mesh) || this.meshDataMap.has(mesh) || this.nonBatchableMeshes.has(mesh)) {
                this.retryableMeshes.delete(mesh);
                continue;
            }
            if (this.canBatch(mesh)) {
                this.invalidateProgressiveBatchWork();
                this.externalSceneMeshesDirty = true;
                return true;
            }
        }
        return false;
    }

    private hasBatchStructureChanged(mesh: Mesh, meshData: BatchedMeshData): boolean {
        const geometry = mesh.geometry;
        let geometryRevisionChanged = false;
        if (geometry === meshData.geometry) {
            const useFrameCache = meshData.geometryUsage.count > 1;
            const cachedRevision = useFrameCache ? this.geometryFrameRevisions.get(geometry) : undefined;
            let current: boolean;
            if (cachedRevision?.serial === this.batchUpdateSerial) {
                current = cachedRevision.current;
            } else {
                current = isGeometryRevisionCurrent(geometry, meshData.geometryRevision);
                if (useFrameCache) {
                    this.geometryFrameRevisions.set(geometry, {serial: this.batchUpdateSerial, current});
                }
            }
            geometryRevisionChanged = !current;
        }
        return (
            geometry !== meshData.geometry ||
            geometryRevisionChanged ||
            mesh.castShadow !== meshData.castShadow ||
            mesh.receiveShadow !== meshData.receiveShadow ||
            mesh.layers.mask !== meshData.layersMask ||
            mesh.renderOrder !== meshData.renderOrder
        );
    }

    private traverseSceneAnalysis(object: Object3D, meshes: Mesh[], isStaticInherited: boolean): void {
        const stack: Array<{object: Object3D; isStaticInherited: boolean}> = [{object, isStaticInherited}];

        while (stack.length > 0) {
            const frame = stack.pop();
            if (!frame) continue;

            const current = frame.object;
            if (!current.visible) continue;

            // We use === false because by default userData.isBatchable is undefined and meshes are batchable
            if (current.userData.isBatchable === false || this.isExcluded(current)) {
                continue;
            }

            const selfStatic = frame.isStaticInherited || current.userData?.isStatic === true;

            if (MeshUtils.isMesh(current) && (this.meshDataMap.has(current) || this.canBatch(current))) {
                meshes.push(current);
                this.sceneMeshSet.add(current);
                if (selfStatic) this.staticMeshes.add(current);
            }

            const children = current.children;
            for (let i = children.length - 1; i >= 0; i--) {
                const child = children[i];
                if (child) stack.push({object: child, isStaticInherited: selfStatic});
            }
        }
    }

    private getBatchedMeshStats(bm: BatchedMesh): {
        geometryCount: number;
        usedVertexCount: number;
        usedIndexCount: number;
        maxVertexCount: number;
        maxIndexCount: number;
    } {
        const bmAny = bm as BatchedMesh & {
            _geometryCount?: number;
            _nextVertexStart?: number;
            _nextIndexStart?: number;
            maxVertexCount?: number;
            maxIndexCount?: number;
        };
        return {
            geometryCount: bmAny._geometryCount ?? 0,
            usedVertexCount: bmAny._nextVertexStart ?? 0,
            usedIndexCount: bmAny._nextIndexStart ?? 0,
            maxVertexCount: bmAny.maxVertexCount ?? 0,
            maxIndexCount: bmAny.maxIndexCount ?? 0,
        };
    }

    /**
     * Stores batch stats in scene.userData.rendering.batching.stats every 5 seconds.
     * If previous stats exist, merges by batchKey, taking max of each value.
     */
    private storeBatchStats(): void {
        const stats = this.getBatchStats();
        const sceneAny = this.scene as SceneWithBatchingUserData;
        if (!sceneAny.userData) sceneAny.userData = {};
        const userData = sceneAny.userData;
        userData.rendering = userData.rendering || {};
        if (typeof userData.rendering.batching !== "object" || userData.rendering.batching === null) {
            userData.rendering.batching = {};
        }
        const batchingObj = userData.rendering.batching as {stats?: BatchStat[]};
        if (!Array.isArray(batchingObj.stats)) {
            batchingObj.stats = [];
        }

        const mergedStats: BatchStat[] = [];
        for (const stat of stats) {
            const modifiedBatchKey = this.normalizeBatchStatKey(stat.batchKey);
            const batchGroups = this.batchGroups.get(stat.batchKey) || [];
            const geometryHashes: string[] = [];
            for (const group of batchGroups) {
                for (const geom of group.geometries.values()) {
                    geometryHashes.push(this.hashGeometry(geom));
                }
            }

            const prev = this.selectBatchStatFromUserDataByHashes(
                modifiedBatchKey,
                geometryHashes,
            ) ?? this.selectBatchStatFromUserDataByKey(modifiedBatchKey);
            if (prev) {
                const prevGeometryHashes = Array.isArray(prev.geometryHashes) ? prev.geometryHashes : [];
                mergedStats.push({
                    batchKey: modifiedBatchKey,
                    geometryHashes: [...new Set([...geometryHashes, ...prevGeometryHashes])],
                    instanceCount: Math.max(stat.instanceCount, prev.instanceCount),
                    geometryCount: Math.max(stat.geometryCount, prev.geometryCount),
                    usedVertexCount: Math.max(stat.usedVertexCount, prev.usedVertexCount),
                    usedIndexCount: Math.max(stat.usedIndexCount, prev.usedIndexCount),
                });
            } else {
                mergedStats.push({
                    batchKey: modifiedBatchKey,
                    geometryHashes,
                    instanceCount: stat.instanceCount,
                    geometryCount: stat.geometryCount,
                    usedVertexCount: stat.usedVertexCount,
                    usedIndexCount: stat.usedIndexCount,
                });
            }
        }
        // Also keep any previous batchKeys not present in current stats
        for (const stat of batchingObj.stats ?? []) {
            const modifiedBatchKey = this.normalizeBatchStatKey(stat.batchKey);
            if (!mergedStats.find(s => s.batchKey === modifiedBatchKey)) {
                mergedStats.push(
                    modifiedBatchKey === stat.batchKey ? stat : {
                        ...stat,
                        batchKey: modifiedBatchKey,
                    },
                );
            }
        }
        batchingObj.stats = mergedStats;
    }

}
