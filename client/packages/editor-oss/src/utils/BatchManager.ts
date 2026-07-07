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
    Texture,
} from "three/webgpu";

import {DetectDevice} from "./DetectDevice";
import GeometryUtils from "./GeometryUtils";
import MaterialUtils, {convertMeshStandardToNodeMaterial, hasCustomTSLNodes, patchNodeMaterialSetup} from "./MaterialUtils";
import MeshUtils from "./MeshUtils";
import global from "../global";
import Box from "../object/geometry/Box";
import Circle from "../object/geometry/Circle";
import Cone from "../object/geometry/Cone";
import Cylinder from "../object/geometry/Cylinder";
import Icosahedron from "../object/geometry/Icosahedron";
import Lathe from "../object/geometry/Lathe";
import Plane from "../object/geometry/Plane";
import Sphere from "../object/geometry/Sphere";
import Sprite from "../object/geometry/Sprite";
import Teapot from "../object/geometry/Teapot";
import Torus from "../object/geometry/Torus";
import TorusKnot from "../object/geometry/TorusKnot";
import Triangle from "../object/geometry/Triangle";
import {getOrCreateDynamicRoot} from "@stem/editor-oss/scene/dynamicRoots";

extendBatchedMeshPrototype();

const BATCHABLE_MESHES = [
    Mesh,
    Box,
    Group,
    Sphere,
    TorusKnot,
    Circle,
    Icosahedron,
    Sprite,
    Triangle,
    Cone,
    Lathe,
    Teapot,
    Cylinder,
    Plane,
    Torus,
];

const BATCH_MAX_INSTANCES = 200;
const BATCH_MIN_VERTICES_COUNT = 10000;
const BATCH_MIN_INDICES_COUNT = 10000;

type UniformValue = number | Color | Vector2 | null;

type BatchedMeshWithOriginals = BatchedMesh & {
    // optional helpers provided by @three.ez batched mesh extensions
    initUniformsPerInstance?: (spec: {vertex: Record<string, string>; fragment: Record<string, string>}) => void;
    uniformsTexture?: {needsUpdate?: boolean};
    setUniformAt?: (id: number, name: string, value: UniformValue) => void;
};

interface MaterialProperties {
    color?: Color | null;
    roughness?: number | null;
    metalness?: number | null;
    opacity?: number | null;
    fog?: boolean | null;
    transparent?: boolean | null;
    visible?: boolean | null;
    emissive?: Color | null;
    emissiveIntensity?: number | null;

    side?: number | null;
    depthWrite?: boolean | null;
    depthTest?: boolean | null;
    blending?: number | null;

    map?: Texture | null;
    normalMap?: Texture | null;
    bumpMap?: Texture | null;
    displacementMap?: Texture | null;
    roughnessMap?: Texture | null;
    metalnessMap?: Texture | null;
    emissiveMap?: Texture | null;
    aoMap?: Texture | null;
    alphaMap?: Texture | null;
    envMap?: Texture | null;
    lightMap?: Texture | null;

    normalScale?: Vector2 | null;
    bumpScale?: number | null;
    displacementScale?: number | null;
    displacementBias?: number | null;
    envMapIntensity?: number | null;
    lightMapIntensity?: number | null;
}

interface SceneWithBatchingUserData {
    userData?: {rendering?: {batching?: {enableDynamic?: boolean}}};
}

type MaterialCloneable = MeshStandardMaterial & {clone?: () => MeshStandardMaterial};

interface BatchedMeshData {
    originalMesh: Mesh;
    instanceId: number;
    geometryId: number;
    transform: Matrix4;
    materialProperties: MaterialProperties;
}

interface BatchGroup {
    material: MeshStandardMaterial;
    batchedMesh: BatchedMesh;
    meshes: Map<Mesh, BatchedMeshData>;
    materialHash: string;

    lodEnabled: boolean;
    customUniformsEnabled: boolean;
    geometries: Map<number, BufferGeometry>;
    key?: string;
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

    private sceneMeshes: Mesh[] = [];
    // Meshes that are under a static subtree (self or any ancestor has userData.isStatic === true)
    private staticMeshes: Set<Mesh> = new Set();

    private meshDataMap: Map<Mesh, {batchGroup: BatchGroup; meshData: BatchedMeshData}> = new Map();

    // Cache of geometry uuid -> computed batch hash (position + optional index)
    private geometryHashCache: Map<string, string> = new Map();

    private nonBatchableMeshes: WeakSet<Mesh> = new WeakSet();

    // Root object for batched meshes
    private batchRoot: Object3D | null = null;

    // Objects that should be excluded from batching (e.g., currently selected/outlined)
    private excludedObjects: Set<Object3D> = new Set();

    private usedStatsBatchKeys: Set<string> = new Set();
    private statsIntervalId: ReturnType<typeof setInterval> | null = null;

    private readonly isPublishMode: boolean;

    private static readonly MAX_NEW_MESHES_PER_UPDATE = DetectDevice.getOS() === "iOS" ? 3 : Infinity;

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

    private _externalMeshes: boolean = false;

    private hiddenMaterials: Set<string> = new Set();
    private materialsToKeepVisible: Set<string> = new Set();

    constructor(scene: Scene) {
        this.scene = scene;
        this.findOrCreateBatchRoot();

        // Start periodic stats storage
        this.statsIntervalId = setInterval(() => {
            this.storeBatchStats();
        }, 5000);

        this.isPublishMode = !!global.app?.options?.isPlayModeOnly;
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
        // Re-evaluate current batches: remove any now-excluded meshes and try batching newly allowed ones
        this.updateBatchesForSceneChanges();
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

        if (this._externalMeshes) {
            // Meshes provided externally via setSceneMeshes — skip scene traversal.
            // Still collect materials for excluded objects so hideOriginalMeshes works.
            this.staticMeshes.clear();
            this.materialsToKeepVisible.clear();
            for (const obj of this.excludedObjects) {
                this.collectMaterialsRecursively(obj);
            }
            this._externalMeshes = false;
        } else {
            this.collectSceneMeshes();
        }

        this.addNewMeshesFromList(BatchManager.MAX_NEW_MESHES_PER_UPDATE);

        // remove meshes no longer in scene
        this.removeStaleMeshes();

        // Temporary disable static geometry CPU cleanup during batch updates
        // this.cleanStaticGeometriesCPU();
    }

    /**
     * Clear all batches and release batched resources.
     * @returns {void}
     */
    public clear(): void {
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

        // Drop references to original meshes and analysis caches
        this.meshDataMap.clear();
        this.sceneMeshes.length = 0;
        this.usedStatsBatchKeys.clear();
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

    public setSceneMeshes(meshes: Mesh[]): void {
        this.sceneMeshes = meshes;
        this._externalMeshes = true;
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

        this.hiddenMaterials.clear();
        for (const batchGroups of this.batchGroups.values()) {
            for (const batchGroup of batchGroups) {
                for (const meshData of batchGroup.meshes.values()) {
                    if (meshData.originalMesh.material) {
                        const materials = Array.isArray(meshData.originalMesh.material) ? meshData.originalMesh.material : [meshData.originalMesh.material];
                        for (let i = 0; i < materials.length; i++) {
                            const mat = materials[i]!;
                            if (mat.visible && !this.materialsToKeepVisible.has(mat.uuid)) {
                                this.hiddenMaterials.add(mat.uuid);
                                mat.visible = false;
                            }
                        }
                    }
                }
                batchGroup.batchedMesh.visible = true;
            }
        }

        // Temporary disable static geometry CPU cleanup during batch updates
        // this.cleanStaticGeometriesCPU();
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

        for (const batchGroups of this.batchGroups.values()) {
            for (const batchGroup of batchGroups) {
                for (const meshData of batchGroup.meshes.values()) {
                    if (meshData.originalMesh.material) {
                        const materials = Array.isArray(meshData.originalMesh.material) ? meshData.originalMesh.material : [meshData.originalMesh.material];
                        for (let i = 0; i < materials.length; i++) {
                            const mat = materials[i]!;
                            if (this.hiddenMaterials.has(mat.uuid)) {
                                mat.visible = true;
                            }
                        }
                    }
                }
            }
        }

        this.hiddenMaterials.clear();
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

    private updateMeshTransform(mesh: Mesh): void {
        // In publish mode, static subtrees are batched once and never updated
        if (this.isPublishMode && this.staticMeshes.has(mesh)) return;
        const result = this.findBatchGroupForMesh(mesh);
        if (!result) return;

        const {batchGroup} = result;
        const meshData = batchGroup.meshes.get(mesh);
        if (!meshData) return;

        if (this.hasMatrixChangedSinceLastUpdate(mesh.matrixWorld, meshData.transform)) {
            meshData.transform.copy(mesh.matrixWorld);
            batchGroup.batchedMesh.setMatrixAt(meshData.instanceId, meshData.transform);
        }
    }

    private updateMeshMaterial(mesh: Mesh): void {
        if (this.isPublishMode && this.staticMeshes.has(mesh)) return;
        const entry = this.meshDataMap.get(mesh);
        if (!entry) return;
        const {batchGroup, meshData} = entry;

        const material = mesh.material as MeshStandardMaterial;
        const oldProps = meshData.materialProperties;

        // Detect whether "big" material features changed (textures, blending, etc.)
        const significantChange = this.hasSignificantMaterialChange(oldProps, material);

        if (significantChange) {
            // Re-batch for changes that alter the material program or textures
            this.removeMesh(mesh);
            this.addMesh(mesh);
            return;
        }

        const perInstanceChanged = this.hasPerInstanceMaterialChange(oldProps, material);

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
                meshData.materialProperties = this.extractMaterialProperties(material);
            }
            return;
        }
    }

    private handleBatchOverflow(
        batchKey: string,
        geometry: BufferGeometry,
        material: MeshStandardMaterial,
    ): BatchGroup {
        // console.warn(`[BatchManager] Batch group ${batchKey} is full, creating new batch group`);

        const batchGroup = this.createBatchGroup(geometry, material, batchKey);

        let batchGroups = this.batchGroups.get(batchKey);
        if (!batchGroups) {
            batchGroups = [];
            this.batchGroups.set(batchKey, batchGroups);
        }
        batchGroups.push(batchGroup);

        // console.log(`[BatchManager] Created new batch group: ${newBatchKey}`);
        return batchGroup;
    }

    private addMesh(mesh: Mesh): boolean {
        if (!this.canBatch(mesh)) return false;

        const material = mesh.material as MeshStandardMaterial;
        const geometry = mesh.geometry;
        const baseKey = this.createBatchKey(geometry, material);
        // Include shadow flags in key so each shadow combination gets its own group
        const batchKey = `${baseKey}_cs${mesh.castShadow ? 1 : 0}_rs${mesh.receiveShadow ? 1 : 0}`;

        let batchGroup = this.getOrCreateBatchGroup(batchKey, geometry, material);

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

                batchGroup = this.handleBatchOverflow(batchKey, geometry, material);
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

        const meshData: BatchedMeshData = {
            originalMesh: mesh,
            instanceId,
            geometryId,
            transform,
            materialProperties: this.extractMaterialProperties(material),
        };

        batchGroup.meshes.set(mesh, meshData);
        this.meshDataMap.set(mesh, {batchGroup, meshData});

        batchGroup.batchedMesh.visible = false;

        // Set batched mesh shadow flags based on this mesh
        batchGroup.batchedMesh.castShadow = mesh.castShadow;
        batchGroup.batchedMesh.receiveShadow = mesh.receiveShadow;

        // Print batch stats after adding a mesh

        return true;
    }

    private removeMesh(mesh: Mesh): void {
        const result = this.findBatchGroupForMesh(mesh);
        if (!result) return;

        const {batchGroup} = result;

        const batchKey = this.getBatchKeyForGroup(batchGroup);
        if (!batchKey) {
            // If we cannot resolve a batch key, abort cleanup for safety
            return;
        }

        const meshData = batchGroup.meshes.get(mesh);
        if (!meshData) return;

        batchGroup.batchedMesh.deleteInstance(meshData.instanceId);
        batchGroup.meshes.delete(mesh);
        this.meshDataMap.delete(mesh);

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
            !mesh.visible ||
            !mesh.geometry ||
            !mesh.material ||
            !mesh.geometry.getAttribute("position")
        ) {
            return false;
        }

        if (this.nonBatchableMeshes.has(mesh)) {
            return false;
        }

        if (mesh.userData?.isBatchable === false) {
            this.nonBatchableMeshes.add(mesh);
            return false;
        }

        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

        // Authored TSL node graphs cannot be reproduced by the batching path,
        // which rebuilds its own node material for per-instance uniforms.
        if (materials.some(material => hasCustomTSLNodes(material))) {
            this.nonBatchableMeshes.add(mesh);
            return false;
        }

        if (!BATCHABLE_MESHES.includes(mesh.constructor as typeof Mesh)) {
            this.nonBatchableMeshes.add(mesh);
            return false;
        }

        if (Array.isArray(mesh.material)) {
            return materials.every(material => MaterialUtils.isMeshStandardMaterial(material));
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

        return MaterialUtils.isMeshStandardMaterial(mesh.material);
    }

    public isExcluded(object: Object3D): boolean {
        return this.excludedObjects.has(object);
    }

    private createBatchKey(geometry: BufferGeometry, material: MeshStandardMaterial): string {
        // TODO: temporarily using full geometry hash to disable batching objects with different geometries
        const geometryHash = this.hashGeometry(geometry);
        const materialHash = this.hashMaterial(material);

        return `${geometryHash}_${materialHash}`;
    }

    private hashStructureGeometry(geometry: BufferGeometry): string {
        const attributes = geometry.attributes;
        const hashParts: string[] = [];

        for (const [key, attr] of Object.entries(attributes)) {
            hashParts.push(`${key}:${attr.itemSize}:`);
        }

        if (geometry.index) {
            const indexType = geometry.index.constructor.name;
            hashParts.push(`idx:${indexType}:`);
        }

        return hashParts.join("|");
    }

    private hashMaterial(material: MeshStandardMaterial): string {
        const hashParts: string[] = [];

        hashParts.push(`type:${this.classifyMaterialType(material)}`);
        hashParts.push(`side:${material.side}`);
        hashParts.push(`transparent:${material.transparent ? "1" : "0"}`);
        hashParts.push(`opacity:${Math.round(material.opacity * 100)}`);
        hashParts.push(`fog:${material.fog ? "1" : "0"}`);
        hashParts.push(`depthWrite:${material.depthWrite ? "1" : "0"}`);
        hashParts.push(`depthTest:${material.depthTest ? "1" : "0"}`);
        hashParts.push(`blending:${material.blending}`);

        if (material.map) {
            hashParts.push(`map:${material.map.uuid}`);
            if (material.map.wrapS) hashParts.push(`wrapS:${material.map.wrapS}`);
            if (material.map.wrapT) hashParts.push(`wrapT:${material.map.wrapT}`);
            if (material.map.repeat) {
                hashParts.push(`repeatX:${Math.round(material.map.repeat.x * 100)}`);
                hashParts.push(`repeatY:${Math.round(material.map.repeat.y * 100)}`);
            }
            if (material.map.offset) {
                hashParts.push(`offsetX:${Math.round(material.map.offset.x * 100)}`);
                hashParts.push(`offsetY:${Math.round(material.map.offset.y * 100)}`);
            }
        } else {
            hashParts.push(`map:null`);
        }

        if (material.normalMap) {
            hashParts.push(`normalMap:${material.normalMap.uuid}`);
            hashParts.push(
                `normalScale:${Math.round(material.normalScale.x * 100)}_${Math.round(material.normalScale.y * 100)}`,
            );
            if (material.normalMap.wrapS) hashParts.push(`normalWrapS:${material.normalMap.wrapS}`);
            if (material.normalMap.wrapT) hashParts.push(`normalWrapT:${material.normalMap.wrapT}`);
            if (material.normalMap.repeat) {
                hashParts.push(`normalRepeatX:${Math.round(material.normalMap.repeat.x * 100)}`);
                hashParts.push(`normalRepeatY:${Math.round(material.normalMap.repeat.y * 100)}`);
            }
        } else {
            hashParts.push(`normalMap:null`);
        }

        if (material.bumpMap) {
            hashParts.push(`bumpMap:${material.bumpMap.uuid}`);
            hashParts.push(`bumpScale:${Math.round(material.bumpScale * 100)}`);
            if (material.bumpMap.wrapS) hashParts.push(`bumpWrapS:${material.bumpMap.wrapS}`);
            if (material.bumpMap.wrapT) hashParts.push(`bumpWrapT:${material.bumpMap.wrapT}`);
            if (material.bumpMap.repeat) {
                hashParts.push(`bumpRepeatX:${Math.round(material.bumpMap.repeat.x * 100)}`);
                hashParts.push(`bumpRepeatY:${Math.round(material.bumpMap.repeat.y * 100)}`);
            }
        } else {
            hashParts.push(`bumpMap:null`);
        }

        if (material.displacementMap) {
            hashParts.push(`displacementMap:${material.displacementMap.uuid}`);
            hashParts.push(`displacementScale:${Math.round(material.displacementScale * 100)}`);
            hashParts.push(`displacementBias:${Math.round(material.displacementBias * 100)}`);
            if (material.displacementMap.wrapS) hashParts.push(`displacementWrapS:${material.displacementMap.wrapS}`);
            if (material.displacementMap.wrapT) hashParts.push(`displacementWrapT:${material.displacementMap.wrapT}`);
            if (material.displacementMap.repeat) {
                hashParts.push(`displacementRepeatX:${Math.round(material.displacementMap.repeat.x * 100)}`);
                hashParts.push(`displacementRepeatY:${Math.round(material.displacementMap.repeat.y * 100)}`);
            }
        } else {
            hashParts.push(`displacementMap:null`);
        }

        if (material.roughnessMap) hashParts.push(`roughnessMap:${material.roughnessMap.uuid}`);
        if (material.metalnessMap) hashParts.push(`metalnessMap:${material.metalnessMap.uuid}`);
        if (material.emissiveMap) hashParts.push(`emissiveMap:${material.emissiveMap.uuid}`);
        if (material.aoMap) hashParts.push(`aoMap:${material.aoMap.uuid}`);
        if (material.alphaMap) hashParts.push(`alphaMap:${material.alphaMap.uuid}`);
        if (material.envMap) hashParts.push(`envMap:${material.envMap.uuid}`);

        hashParts.push(`envMapIntensity:${Math.round(material.envMapIntensity * 100)}`);

        if (material.lightMap) hashParts.push(`lightMap:${material.lightMap.uuid}`);
        if (material.lightMapIntensity !== undefined)
            hashParts.push(`lightMapIntensity:${Math.round(material.lightMapIntensity * 100)}`);

        return hashParts.join("|");
    }

    private classifyMaterialType(material: MeshStandardMaterial): string {
        if (material.transparent) return "transparent";
        if (material.metalness > 0.5) return "metal";
        if (material.roughness < 0.3) return "glossy";
        return "matte";
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
        const cached = this.geometryHashCache.get(geometry.uuid);
        if (cached) return cached;

        const hash = GeometryUtils.hashGeometry(geometry);
        this.geometryHashCache.set(geometry.uuid, hash);
        return hash;
    }

    private createBatchGroup(geometry: BufferGeometry, material: MeshStandardMaterial, batchKey: string): BatchGroup {
        const {maxInstanceCount, maxVertexCount, maxIndexCount} = this.getOptimalBatchCapacity(batchKey, [geometry]);

        const nodeMaterial = convertMeshStandardToNodeMaterial(material);

        const batchedMesh = new BatchedMesh(maxInstanceCount, maxVertexCount, maxIndexCount, nodeMaterial);

        // FIXME: Temporarily set frustumCulled to false to avoid issues with bounding box not being set yet
        // For example, characters in GaF can lose their hats.
        batchedMesh.perObjectFrustumCulled = false;
        batchedMesh.frustumCulled = false;
        batchedMesh.sortObjects = !false;

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
            material,
            batchedMesh,
            meshes: new Map(),
            materialHash: this.hashMaterial(material),
            lodEnabled: false,
            customUniformsEnabled: false,
            geometries: new Map(),
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
        batchedMesh.raycast = (raycaster: Raycaster, intersects: Intersection[]) => {
            const tempIntersects: Intersection[] = [];
            originalBatchedRaycast(raycaster, tempIntersects);
            for (const inter of tempIntersects) {
                const instanceId = inter.instanceId;
                for (const [mesh, meshData] of batchGroup.meshes.entries()) {
                    if (meshData.instanceId === instanceId) {
                        intersects.push(Object.assign({}, inter, {object: mesh}));
                        break;
                    }
                }
            }
        };

        // track key on the batchGroup for quick lookups
        batchGroup.key = batchKey;
        return batchGroup;
    }

    private collectSceneMeshes(): void {
        this.sceneMeshes.length = 0;
        this.staticMeshes.clear();
        this.materialsToKeepVisible.clear();
        this.traverseSceneAnalysis(this.scene, this.sceneMeshes, false);
    }

    private addNewMeshesFromList(limit?: number): number {
        let added = 0;
        const newMeshes: Mesh[] = [];
        for (let i = 0; i < this.sceneMeshes.length; i++) {
            const mesh = this.sceneMeshes[i];
            if (mesh && !this.meshDataMap.has(mesh) && this.canBatch(mesh)) {
                newMeshes.push(mesh);
            }
        }

        // NOTE: This sorting is important to ensure larger meshes are batched first
        // this helps avoid overflow issues with smaller meshes, and decrease memory usage and draw calls (win-win)
        newMeshes.sort((a, b) => (b.geometry.attributes.position?.count ?? 0) - (a.geometry.attributes.position?.count ?? 0));

        for (const mesh of newMeshes) {
            if (limit !== undefined && added >= limit) break;
            if (this.addMesh(mesh)) {
                added++;
            }
        }

        return added;
    }

    private removeStaleMeshes(): void {
        if (this.meshDataMap.size === 0) return;
        const present = new Set(this.sceneMeshes);
        for (const mesh of this.meshDataMap.keys()) {
            if (!present.has(mesh)) this.removeMesh(mesh);
        }
    }

    private extractMaterialProperties(material: MeshStandardMaterial): MaterialProperties {
        const props: MaterialProperties = {
            color: material.color?.clone(),
            roughness: material.roughness,
            metalness: material.metalness,
            opacity: material.opacity,
            fog: material.fog,
            transparent: material.transparent,
            visible: material.visible,
            emissive: material.emissive?.clone(),
            emissiveIntensity: material.emissiveIntensity,

            side: material.side,
            depthWrite: material.depthWrite,
            depthTest: material.depthTest,
            blending: material.blending,

            map: material.map,
            normalMap: material.normalMap,
            bumpMap: material.bumpMap,
            displacementMap: material.displacementMap,
            roughnessMap: material.roughnessMap,
            metalnessMap: material.metalnessMap,
            emissiveMap: material.emissiveMap,
            aoMap: material.aoMap,
            alphaMap: material.alphaMap,
            envMap: material.envMap,
            lightMap: material.lightMap,

            normalScale: new Vector2().copy(material.normalScale),
            bumpScale: material.bumpScale,
            displacementScale: material.displacementScale,
            displacementBias: material.displacementBias,
            envMapIntensity: material.envMapIntensity,
            lightMapIntensity: material.lightMapIntensity,
        };

        return props;
    }

    private hasSignificantMaterialChange(oldProps: MaterialProperties, newProps: MeshStandardMaterial): boolean {
        if (oldProps.fog !== newProps.fog) return true;
        if (oldProps.side !== newProps.side) return true;
        if (oldProps.depthWrite !== newProps.depthWrite) return true;
        if (oldProps.depthTest !== newProps.depthTest) return true;
        if (oldProps.blending !== newProps.blending) return true;

        if (oldProps.map !== newProps.map) return true;
        if (oldProps.normalMap !== newProps.normalMap) return true;
        if (oldProps.bumpMap !== newProps.bumpMap) return true;
        if (oldProps.displacementMap !== newProps.displacementMap) return true;
        if (oldProps.roughnessMap !== newProps.roughnessMap) return true;
        if (oldProps.metalnessMap !== newProps.metalnessMap) return true;
        if (oldProps.emissiveMap !== newProps.emissiveMap) return true;
        if (oldProps.aoMap !== newProps.aoMap) return true;
        if (oldProps.alphaMap !== newProps.alphaMap) return true;
        if (oldProps.envMap !== newProps.envMap) return true;
        if (oldProps.lightMap !== newProps.lightMap) return true;

        const nsOld = oldProps.normalScale;
        const nsNew = newProps.normalScale;
        if ((nsOld === null || nsOld === undefined) !== (nsNew === null || nsNew === undefined)) return true;
        if (nsOld && nsNew && !nsOld.equals(nsNew)) return true;
        if (oldProps.bumpScale !== newProps.bumpScale) return true;
        if (oldProps.displacementScale !== newProps.displacementScale) return true;
        if (oldProps.displacementBias !== newProps.displacementBias) return true;
        if (oldProps.envMapIntensity !== newProps.envMapIntensity) return true;
        if (oldProps.lightMapIntensity !== newProps.lightMapIntensity) return true;

        return false;
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
        // Compare colors safely (handle nulls and optional equals)
        const oColor: Color | null = oldProps.color ?? null;
        const nColor: Color | null = newProps.color ?? null;
        const colorChanged =
            oColor === null && nColor !== null ||
            oColor !== null && nColor === null ||
            oColor !== null && nColor !== null && !(oColor.equals && oColor.equals(nColor));

        const oEm: Color | null = oldProps.emissive ?? null;
        const nEm: Color | null = newProps.emissive ?? null;
        const emissiveChanged =
            oEm === null && nEm !== null ||
            oEm !== null && nEm === null ||
            oEm !== null && nEm !== null && !(oEm.equals && oEm.equals(nEm));

        return (
            colorChanged ||
            emissiveChanged ||
            oldProps.roughness !== newProps.roughness ||
            oldProps.metalness !== newProps.metalness ||
            oldProps.opacity !== newProps.opacity ||
            oldProps.emissiveIntensity !== newProps.emissiveIntensity
        );
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
        // Remove all map sections from batchKey that contain unique texture UUIDs
        const modifiedBatchKey = batchKey.replace(/\|[^|]*?(m|M)ap:[^|]*?\|/g, "|");
        const inputGeometryHashes = geometries.map(g => this.hashGeometry(g));
        const userData = (this.scene as SceneWithBatchingUserData).userData;
        const batchingObj = userData?.rendering?.batching as {stats?: BatchStat[]} | undefined;
        const statsArr = batchingObj?.stats;
        if (Array.isArray(statsArr)) {
            return statsArr.find(
                (s: BatchStat) =>
                    s.batchKey === modifiedBatchKey &&
                    inputGeometryHashes.some(hash => s.geometryHashes.includes(hash)),
            );
        }
        return undefined;
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
    ): BatchGroup {
        let batchGroup = this.findAvailableBatchGroup(batchKey);

        if (batchGroup) {
            return batchGroup;
        }

        // console.log(`[BatchManager] All batch groups for ${batchKey} are full, creating new batch group`);
        batchGroup = this.createBatchGroup(geometry, material, batchKey);

        let batchGroups = this.batchGroups.get(batchKey);
        if (!batchGroups) {
            batchGroups = [];
            this.batchGroups.set(batchKey, batchGroups);
        }
        batchGroups.push(batchGroup);

        return batchGroup;
    }

    private findBatchGroupForMesh(mesh: Mesh): {batchGroup: BatchGroup} | null {
        const entry = this.meshDataMap.get(mesh);
        if (!entry) return null;

        const {batchGroup} = entry;

        return {batchGroup};
    }

    private getBatchKeyForGroup(batchGroup: BatchGroup): string | null {
        const existing = batchGroup.key;
        if (existing) return existing;
        for (const [key, groups] of this.batchGroups.entries()) {
            if (groups.includes(batchGroup)) {
                // cache it for future fast lookup
                batchGroup.key = key;
                return key;
            }
        }
        return null;
    }

    private updateBatchedMeshes(): void {
        for (const mesh of [...this.meshDataMap.keys()]) {
            if (!this.canBatch(mesh)) {
                this.removeMesh(mesh);
                continue;
            }
            this.updateMeshTransform(mesh);
            this.updateMeshMaterial(mesh);
        }
    }

    private traverseSceneAnalysis(object: Object3D, meshes: Mesh[], isStaticInherited: boolean): void {
        if (!object.visible) return;

        // We use === false because by default userData.isBatchable is undefined and meshes are batchable
        if (object.userData.isBatchable === false || this.isExcluded(object)) {
            this.collectMaterialsRecursively(object);
            return;
        }

        const selfStatic = isStaticInherited || object.userData?.isStatic === true;

        if (MeshUtils.isMesh(object) && (this.meshDataMap.has(object) || this.canBatch(object))) {
            meshes.push(object);
            if (selfStatic) this.staticMeshes.add(object);
        }

        for (let i = 0; i < object.children.length; i++) {
            const child = object.children[i];
            if (child) this.traverseSceneAnalysis(child, meshes, selfStatic);
        }
    }

    private collectMaterialsRecursively(object: Object3D): void {
        if (!object.visible) return;

        if (MeshUtils.isMesh(object)) {
            if (!Array.isArray(object.material)) {
                if (object.material) this.materialsToKeepVisible.add(object.material.uuid);
            } else {
                const materials = object.material;
                for (let i = 0; i < materials.length; i++) {
                    const mat = materials[i];
                    if (mat) this.materialsToKeepVisible.add(mat.uuid);
                }
            }
        }

        for (let i = 0; i < object.children.length; i++) {
            const child = object.children[i];
            if (child) this.collectMaterialsRecursively(child);
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
            // Remove map sections from batchKey that contain unique texture UUIDs
            const modifiedBatchKey = stat.batchKey.replace(/(m|M)ap:[^|]*?\|/g, "|");
            const batchGroups = this.batchGroups.get(stat.batchKey) || [];
            const geometryHashes: string[] = [];
            for (const group of batchGroups) {
                for (const geom of group.geometries.values()) {
                    geometryHashes.push(this.hashGeometry(geom));
                }
            }

            const prev = this.selectBatchStatFromUserData(
                modifiedBatchKey,
                batchGroups.flatMap(g => Array.from(g.geometries.values())),
            );
            if (prev) {
                mergedStats.push({
                    batchKey: modifiedBatchKey,
                    geometryHashes: [...new Set([...stat.geometryHashes, ...prev.geometryHashes])],
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
            if (!mergedStats.find(s => s.batchKey === stat.batchKey)) {
                mergedStats.push(stat);
            }
        }
        batchingObj.stats = mergedStats;
    }

    private isUnderStatic(object: Object3D | null | undefined): boolean {
        let current: Object3D | null | undefined = object;
        while (current) {
            const ud = current.userData as {isStatic?: boolean} | undefined;
            if (ud && ud.isStatic === true) return true;
            current = current.parent;
        }
        return false;
    }

    private findMeshesUsingGeometry(geometry: BufferGeometry): Mesh[] {
        const result: Mesh[] = [];
        this.scene.traverse(obj => {
            if (MeshUtils.isMesh(obj)) {
                if (obj.geometry === geometry) result.push(obj);
            }
        });
        return result;
    }

    private isGeometryFullyBatchedAndStatic(geometry: BufferGeometry): boolean {
        const meshes = this.findMeshesUsingGeometry(geometry);
        if (meshes.length === 0) return false;
        for (const m of meshes) {
            if (!this.isUnderStatic(m)) return false;
            if (!this.meshDataMap.has(m)) return false;
        }
        return true;
    }

    private cleanGeometryCPU(geometry: BufferGeometry): void {
        const ud = geometry.userData as {cpuCleaned?: boolean; nonCloneable?: boolean};
        if (ud.cpuCleaned) return;

        try {
            const names = Object.keys(geometry.attributes || {});
            for (const name of names) {
                if (name === "position") continue;
                try {
                    geometry.deleteAttribute(name);
                } catch {
                    /* ignore */
                }
            }
            try {
                geometry.setIndex(null);
            } catch {
                /* ignore */
            }
        } catch {
            // ignore
        }

        ud.cpuCleaned = true;
        ud.nonCloneable = true;

        // Prevent clone/copy to avoid rehydrating CPU data
        try {
            (geometry as unknown as {copy: (...args: unknown[]) => BufferGeometry}).copy = function (): BufferGeometry {
                try {
                    console.warn("[BatchManager] Suppressed copy() for CPU-cleaned static geometry.");
                } catch {
                    /* noop */
                }
                return this as BufferGeometry;
            };
        } catch {
            /* ignore */
        }
        try {
            (geometry as unknown as {clone: (...args: unknown[]) => BufferGeometry}).clone =
                function (): BufferGeometry {
                    try {
                        console.warn("[BatchManager] Suppressed clone() for CPU-cleaned static geometry.");
                    } catch {
                        /* noop */
                    }
                    return this as BufferGeometry;
                };
        } catch {
            /* ignore */
        }
    }

    private cleanStaticGeometriesCPU(): void {
        if (this.isPublishMode) {
            return;
        }

        for (const groups of this.batchGroups.values()) {
            for (const group of groups) {
                for (const geom of group.geometries.values()) {
                    try {
                        if (this.isGeometryFullyBatchedAndStatic(geom)) {
                            this.cleanGeometryCPU(geom);
                        }
                    } catch {
                        // ignore
                    }
                }
            }
        }
    }
}
