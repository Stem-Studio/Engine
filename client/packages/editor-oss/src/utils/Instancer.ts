/*
 * Copyright: StemStudio Maintainers
 * Portions of this code are derived from the Shadow Editor (MIT License)
 */
import {Box3, BufferGeometry, InstancedMesh, Material, Matrix4, Mesh, Object3D, Scene, Sphere} from "three";

import {createProgressiveYieldController, type ProgressiveYieldOptions} from "./progressiveYield";
import {traverseObjectDepthFirst} from "./SceneTraverser";

type AssetKey = string;
type PoolKey = string;

interface MeshCandidate {
    assetKey: AssetKey;
    mesh: Mesh;
    meshPath: string;
    transparent: boolean;
}

interface PoolState {
    instancedMesh: InstancedMesh;
    capacity: number;
    materialOwned: boolean;
}

const INITIAL_INSTANCE_CAPACITY = 16;
const OPAQUE_INSTANCE_THRESHOLD = 4;
const TRANSPARENT_INSTANCE_THRESHOLD = 12;
const MIN_POOL_CAPACITY = 16;
const SHRINK_THRESHOLD_DIVISOR = 8;
const SHRINK_COOLDOWN_MS = 5000;
const INSTANCER_PROGRESS_DEFAULTS = {
    batchSize: 32,
    frameBudgetMs: 4,
};

class Instancer {
    private readonly pools: Map<PoolKey, PoolState> = new Map();
    private readonly storedObjects: Object3D[] = [];

    private readonly _tmpMatrix = new Matrix4();
    private readonly _tmpBox = new Box3();
    private readonly _tmpSphere = new Sphere();
    private _lastShrinkTime = 0;

    public convertMeshesToInstancedMeshes(scene: Scene) {
        const candidatesByPool = new Map<PoolKey, MeshCandidate[]>();
        const roots: Object3D[] = [];

        traverseObjectDepthFirst(scene, object => {
            if (this.canBeInstancedRoot(object)) {
                roots.push(object);
            }
        });

        for (const root of roots) {
            const rootCandidates = this.collectCandidatesForRoot(root);
            for (const candidate of rootCandidates) {
                const poolKey = this.getPoolKey(candidate);
                if (!candidatesByPool.has(poolKey)) {
                    candidatesByPool.set(poolKey, []);
                }
                candidatesByPool.get(poolKey)?.push(candidate);
            }
        }

        for (const [poolKey, candidates] of candidatesByPool) {
            if (candidates.length < this.getThreshold(candidates[0])) {
                continue;
            }

            let pool = this.pools.get(poolKey);
            if (!pool) {
                pool = this.createPool(poolKey, candidates[0]!, scene, candidates.length);
                this.pools.set(poolKey, pool);
            }

            for (const candidate of candidates) {
                if (pool.instancedMesh.count >= pool.capacity) {
                    pool = this.resizePool(poolKey, pool, scene);
                    this.pools.set(poolKey, pool);
                }

                const placeholder = this.swapMeshToInstance(candidate.mesh, pool.instancedMesh, poolKey);
                this.storedObjects.push(placeholder);
                this.writeInstanceMatrix(placeholder, false);
            }

            this.refreshInstancedMeshBounds(pool.instancedMesh);
        }
    }

    public async convertMeshesToInstancedMeshesProgressive(
        scene: Scene,
        options: ProgressiveYieldOptions = {},
    ): Promise<void> {
        const maybeYield = createProgressiveYieldController(options, INSTANCER_PROGRESS_DEFAULTS);
        const candidatesByPool = new Map<PoolKey, MeshCandidate[]>();
        const roots: Object3D[] = [];
        const stack: Object3D[] = [scene];

        while (stack.length > 0) {
            const object = stack.pop();
            if (!object) {
                continue;
            }

            if (this.canBeInstancedRoot(object)) {
                roots.push(object);
            }

            for (let i = object.children.length - 1; i >= 0; i--) {
                const child = object.children[i];
                if (child) stack.push(child);
            }

            await maybeYield();
        }

        for (let i = 0; i < roots.length; i++) {
            const rootCandidates = await this.collectCandidatesForRootProgressive(roots[i]!, maybeYield);
            for (let j = 0; j < rootCandidates.length; j++) {
                const candidate = rootCandidates[j]!;
                const poolKey = this.getPoolKey(candidate);
                if (!candidatesByPool.has(poolKey)) {
                    candidatesByPool.set(poolKey, []);
                }
                candidatesByPool.get(poolKey)?.push(candidate);
            }

            await maybeYield();
        }

        for (const [poolKey, candidates] of candidatesByPool) {
            if (candidates.length < this.getThreshold(candidates[0])) {
                continue;
            }

            let pool = this.pools.get(poolKey);
            if (!pool) {
                pool = this.createPool(poolKey, candidates[0]!, scene, candidates.length);
                this.pools.set(poolKey, pool);
            }

            for (let i = 0; i < candidates.length; i++) {
                const candidate = candidates[i]!;
                if (pool.instancedMesh.count >= pool.capacity) {
                    pool = this.resizePool(poolKey, pool, scene);
                    this.pools.set(poolKey, pool);
                }

                const placeholder = this.swapMeshToInstance(candidate.mesh, pool.instancedMesh, poolKey);
                this.storedObjects.push(placeholder);
                this.writeInstanceMatrix(placeholder, false);

                await maybeYield();
            }

            this.refreshInstancedMeshBounds(pool.instancedMesh);
            await maybeYield(true);
        }
    }

    private canBeInstancedRoot(object: Object3D): boolean {
        const behaviors = object.userData.behaviors as unknown[] | undefined;
        return (
            !object.userData.isInstancedMesh &&
            !object.userData.instanceData &&
            object.userData.isStemObject &&
            !(behaviors?.length ?? 0) &&
            !object.userData.isSelectable &&
            !object.userData.physics &&
            !!this.getAssetKey(object)
        );
    }

    private getAssetKey(object: Object3D): AssetKey | null {
        const modelId = object.userData.modelId as string | undefined;
        const revisionId = object.userData.modelRevisionId as string | undefined;
        const url = object.userData.Url as string | undefined;

        if (modelId && revisionId) {
            return `asset:${modelId}:${revisionId}`;
        }

        if (modelId) {
            return `asset:${modelId}`;
        }

        if (url) {
            return `url:${url}`;
        }

        return null;
    }

    private collectCandidatesForRoot(root: Object3D): MeshCandidate[] {
        const assetKey = this.getAssetKey(root);
        if (!assetKey) {
            return [];
        }

        const candidates: MeshCandidate[] = [];
        const stack: Array<{object: Object3D; path: string}> = [{object: root, path: "root"}];

        while (stack.length > 0) {
            const current = stack.pop();
            if (!current) {
                continue;
            }

            const {object, path} = current;
            for (let i = 0; i < object.children.length; i++) {
                const child = object.children[i];
                if (!child) {
                    continue;
                }

                const childPath = `${path}/${i}`;
                if (child.type === "Bone") {
                    return [];
                }

                if (child instanceof Mesh) {
                    child.userData.parentUUID = object.uuid;
                    candidates.push({
                        assetKey,
                        mesh: child,
                        meshPath: childPath,
                        transparent: this.isTransparentMesh(child),
                    });
                }

                stack.push({object: child, path: childPath});
            }
        }

        return candidates;
    }

    private async collectCandidatesForRootProgressive(
        root: Object3D,
        maybeYield: (force?: boolean) => Promise<void>,
    ): Promise<MeshCandidate[]> {
        const assetKey = this.getAssetKey(root);
        if (!assetKey) {
            return [];
        }

        const candidates: MeshCandidate[] = [];
        const stack: Array<{object: Object3D; path: string}> = [{object: root, path: "root"}];

        while (stack.length > 0) {
            const current = stack.pop();
            if (!current) {
                continue;
            }

            const {object, path} = current;
            for (let i = 0; i < object.children.length; i++) {
                const child = object.children[i];
                if (!child) {
                    continue;
                }

                const childPath = `${path}/${i}`;
                if (child.type === "Bone") {
                    return [];
                }

                if (child instanceof Mesh) {
                    child.userData.parentUUID = object.uuid;
                    candidates.push({
                        assetKey,
                        mesh: child,
                        meshPath: childPath,
                        transparent: this.isTransparentMesh(child),
                    });
                }

                stack.push({object: child, path: childPath});
            }

            await maybeYield();
        }

        return candidates;
    }

    private isTransparentMesh(mesh: Mesh): boolean {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        return materials.some(material => !!material?.transparent || (material?.opacity ?? 1) < 1);
    }

    private getPoolKey(candidate: MeshCandidate): PoolKey {
        const transparency = candidate.transparent ? "transparent" : "opaque";
        return `${candidate.assetKey}|${candidate.meshPath}|${transparency}`;
    }

    private getThreshold(candidate: MeshCandidate | undefined): number {
        if (!candidate) {
            return OPAQUE_INSTANCE_THRESHOLD;
        }

        return candidate.transparent ? TRANSPARENT_INSTANCE_THRESHOLD : OPAQUE_INSTANCE_THRESHOLD;
    }

    private createPool(poolKey: PoolKey, candidate: MeshCandidate, scene: Scene, initialCount: number): PoolState {
        const capacity = Math.max(INITIAL_INSTANCE_CAPACITY, initialCount);
        const material = this.cloneMaterial(candidate.mesh.material);
        const instancedMesh = this.createInstancedMesh(candidate.mesh.geometry, material, capacity);
        instancedMesh.count = 0;
        instancedMesh.name = `Instanced_${poolKey}`;
        instancedMesh.userData = {
            isInstancedMesh: true,
            poolKey,
            assetKey: candidate.assetKey,
        };
        instancedMesh.castShadow = candidate.mesh.castShadow;
        instancedMesh.receiveShadow = candidate.mesh.receiveShadow;
        scene.add(instancedMesh);

        return {
            instancedMesh,
            capacity,
            materialOwned: true,
        };
    }

    private swapMeshToInstance(mesh: Mesh, instancedMesh: InstancedMesh, poolKey: PoolKey): Object3D {
        const newObject = new Object3D();
        newObject.position.copy(mesh.position);
        newObject.rotation.copy(mesh.rotation);
        newObject.scale.copy(mesh.scale);
        newObject.name = mesh.name;

        newObject.userData = {
            ...mesh.userData,
            isInstance: true,
            instanceData: {
                poolKey,
                id: instancedMesh.count,
                instancedMesh,
            },
        };

        instancedMesh.count++;

        const meshParent = mesh.parent;
        if (meshParent) {
            meshParent.remove(mesh);
            meshParent.add(newObject);
        }

        while (mesh.children.length > 0) {
            const child = mesh.children[0];
            if (!child) {
                break;
            }
            mesh.remove(child);
            newObject.add(child);
        }

        return newObject;
    }

    public updateInstancePosition(object: Object3D) {
        this.writeInstanceMatrix(object, true);
    }

    private writeInstanceMatrix(object: Object3D, refreshBounds: boolean): void {
        const instanceData = object.userData.instanceData as
            | {id: number; instancedMesh: InstancedMesh}
            | undefined;
        if (!instanceData) {
            return;
        }

        object.updateWorldMatrix(true, true);
        instanceData.instancedMesh.setMatrixAt(instanceData.id, object.matrixWorld);
        instanceData.instancedMesh.instanceMatrix.needsUpdate = true;
        if (refreshBounds) {
            this.refreshInstancedMeshBounds(instanceData.instancedMesh);
        }
    }

    private createInstancedMesh(
        geometry: BufferGeometry,
        material: Material | Material[],
        capacity: number,
    ): InstancedMesh {
        const instancedMesh = new InstancedMesh(geometry, material, capacity);
        instancedMesh.matrixAutoUpdate = false;
        instancedMesh.matrixWorldAutoUpdate = false;
        instancedMesh.frustumCulled = true;
        return instancedMesh;
    }

    private resizePool(poolKey: PoolKey, pool: PoolState, scene: Scene): PoolState {
        const old = pool.instancedMesh;
        const newCapacity = pool.capacity * 2;
        const replacement = this.createInstancedMesh(old.geometry, old.material, newCapacity);
        replacement.userData = {...old.userData};
        replacement.count = old.count;
        replacement.castShadow = old.castShadow;
        replacement.receiveShadow = old.receiveShadow;

        replacement.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, old.count * 16));
        replacement.instanceMatrix.needsUpdate = true;

        if (old.instanceColor && replacement.instanceColor) {
            replacement.instanceColor.array.set(old.instanceColor.array.subarray(0, old.count * 3));
            replacement.instanceColor.needsUpdate = true;
        }

        for (const obj of this.storedObjects) {
            if (obj.userData.instanceData?.instancedMesh === old) {
                obj.userData.instanceData.instancedMesh = replacement;
            }
        }

        scene.remove(old);
        old.dispose();
        scene.add(replacement);
        this.refreshInstancedMeshBounds(replacement);

        this.pools.set(poolKey, {
            instancedMesh: replacement,
            capacity: newCapacity,
            materialOwned: pool.materialOwned,
        });

        return {
            instancedMesh: replacement,
            capacity: newCapacity,
            materialOwned: pool.materialOwned,
        };
    }

    public removeInstance(object: Object3D): void {
        const instanceData = object.userData?.instanceData as
            | {id: number; instancedMesh: InstancedMesh}
            | undefined;
        if (!instanceData) {
            return;
        }

        const instancedMesh = instanceData.instancedMesh;
        const removeIndex = instanceData.id;
        const lastIndex = instancedMesh.count - 1;

        if (removeIndex < lastIndex) {
            instancedMesh.getMatrixAt(lastIndex, this._tmpMatrix);
            instancedMesh.setMatrixAt(removeIndex, this._tmpMatrix);

            for (const candidate of this.storedObjects) {
                if (
                    candidate.userData.instanceData?.instancedMesh === instancedMesh &&
                    candidate.userData.instanceData.id === lastIndex
                ) {
                    candidate.userData.instanceData.id = removeIndex;
                    break;
                }
            }
        }

        instancedMesh.count--;
        instancedMesh.instanceMatrix.needsUpdate = true;
        this.refreshInstancedMeshBounds(instancedMesh);

        delete object.userData.instanceData;

        const index = this.storedObjects.indexOf(object);
        if (index !== -1) {
            const lastObjectIndex = this.storedObjects.length - 1;
            if (index < lastObjectIndex) {
                this.storedObjects[index] = this.storedObjects[lastObjectIndex]!;
            }
            this.storedObjects.pop();
        }

        // Shrink pool if heavily underutilized (hysteresis prevents thrashing)
        const poolKey = instancedMesh.userData.poolKey as PoolKey | undefined;
        if (poolKey) {
            this.maybeShrinkPool(poolKey, instancedMesh);
        }
    }

    private maybeShrinkPool(poolKey: PoolKey, instancedMesh: InstancedMesh): void {
        const now = performance.now();
        if (now - this._lastShrinkTime < SHRINK_COOLDOWN_MS) return;

        const pool = this.pools.get(poolKey);
        if (!pool) return;
        const newCapacity = Math.floor(pool.capacity / 2);
        if (newCapacity < MIN_POOL_CAPACITY) return;
        if (instancedMesh.count >= pool.capacity / SHRINK_THRESHOLD_DIVISOR) return;

        // Shrink: rebuild with halved capacity
        const scene = instancedMesh.parent;
        if (!scene) return;
        const replacement = this.createInstancedMesh(instancedMesh.geometry, instancedMesh.material, newCapacity);
        replacement.userData = {...instancedMesh.userData};
        replacement.count = instancedMesh.count;
        replacement.castShadow = instancedMesh.castShadow;
        replacement.receiveShadow = instancedMesh.receiveShadow;
        replacement.instanceMatrix.array.set(instancedMesh.instanceMatrix.array.subarray(0, instancedMesh.count * 16));
        replacement.instanceMatrix.needsUpdate = true;
        if (instancedMesh.instanceColor && replacement.instanceColor) {
            replacement.instanceColor.array.set(instancedMesh.instanceColor.array.subarray(0, instancedMesh.count * 3));
            replacement.instanceColor.needsUpdate = true;
        }
        for (const obj of this.storedObjects) {
            if (obj.userData.instanceData?.instancedMesh === instancedMesh) {
                obj.userData.instanceData.instancedMesh = replacement;
            }
        }
        scene.remove(instancedMesh);
        instancedMesh.dispose();
        scene.add(replacement);
        this.refreshInstancedMeshBounds(replacement);
        this.pools.set(poolKey, {instancedMesh: replacement, capacity: newCapacity, materialOwned: pool.materialOwned});
        this._lastShrinkTime = now;
    }

    private refreshInstancedMeshBounds(instancedMesh: InstancedMesh): void {
        if (instancedMesh.count === 0) {
            instancedMesh.boundingBox = null;
            instancedMesh.boundingSphere = null;
            return;
        }

        try {
            instancedMesh.computeBoundingBox();
            instancedMesh.computeBoundingSphere();

            if (!instancedMesh.boundingBox) {
                instancedMesh.geometry.computeBoundingBox();
                if (instancedMesh.geometry.boundingBox) {
                    this._tmpBox.copy(instancedMesh.geometry.boundingBox);
                    instancedMesh.boundingBox = this._tmpBox.clone();
                }
            }

            if (!instancedMesh.boundingSphere) {
                instancedMesh.geometry.computeBoundingSphere();
                if (instancedMesh.geometry.boundingSphere) {
                    this._tmpSphere.copy(instancedMesh.geometry.boundingSphere);
                    instancedMesh.boundingSphere = this._tmpSphere.clone();
                }
            }
        } catch {
            instancedMesh.frustumCulled = false;
        }
    }

    private cloneMaterial(material: Material | Material[]): Material | Material[] {
        if (Array.isArray(material)) {
            return material.map(entry => entry.clone());
        }
        return material.clone();
    }

    public dispose(scene: Scene) {
        for (const pool of this.pools.values()) {
            const instancedMesh = pool.instancedMesh;
            if (instancedMesh.parent) {
                instancedMesh.parent.remove(instancedMesh);
            }

            if (pool.materialOwned) {
                if (Array.isArray(instancedMesh.material)) {
                    instancedMesh.material.forEach(material => material.dispose());
                } else {
                    instancedMesh.material.dispose();
                }
            }

            scene.remove(instancedMesh);
        }

        this.storedObjects.length = 0;
        this.pools.clear();
    }
}

export default Instancer;
