import {
    BoxGeometry,
    BufferAttribute,
    BufferGeometry,
    InterleavedBuffer,
    InterleavedBufferAttribute,
    Mesh,
    MeshStandardMaterial,
    Object3D,
    Raycaster,
    Scene,
    Vector3,
    type BatchedMesh,
    type Intersection,
} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import global from "../global";
import BatchManager from "./BatchManager";

type BatchStatLike = {
    batchKey: string;
    geometryHashes: string[];
    instanceCount: number;
    geometryCount: number;
    usedVertexCount: number;
    usedIndexCount: number;
};

type BatchManagerHashInternals = {
    hashGeometry(geometry: BufferGeometry): string;
    geometryHashCache: Map<string, unknown>;
    batchGroups: Map<string, Array<{
        batchedMesh: {
            visible: boolean;
            instanceCount: number;
            _geometryCount: number;
            _nextVertexStart: number;
            _nextIndexStart: number;
        };
        meshes: Map<unknown, unknown>;
        instanceIdToMesh: Map<number, Mesh>;
        geometries: Map<number, BufferGeometry>;
    }>>;
    meshDataMap: Map<Mesh, {batchGroup: unknown; meshData: {instanceId: number}}>;
    sceneMeshSet: Set<Mesh>;
    newMeshScratch: Mesh[];
    retryableMeshes: Set<Mesh>;
    progressiveAnalysisCursor: number;
    progressiveQueueCursor: number;
    progressiveQueuePrepared: boolean;
    externalSceneMeshesDirty: boolean;
    sceneMeshes: Mesh[];
    staticMeshes: Set<Mesh>;
    hiddenOriginalMeshes: Map<Mesh, boolean>;
    setSceneMeshes(meshes: Mesh[], sourceRevision?: number): void;
    setExcludedObjects(objects: Set<Mesh> | Mesh[] | null | undefined): void;
    updateBatchesForSceneChanges(): void;
    updateBatchedMeshes(): void;
    now(): number;
    addNewMeshesFromList(limit?: number): number;
    removeStaleMeshes(): void;
    hasSignificantMaterialChange(oldProps: unknown, material: MeshStandardMaterial): boolean;
    collectSceneMeshes(): void;
    traverseSceneAnalysis(object: Object3D, meshes: Mesh[], isStaticInherited: boolean): void;
    hideOriginalMeshes(): void;
    showOriginalMeshes(): void;
    storeBatchStats(): void;
    dispose(): void;
    statsIntervalId: ReturnType<typeof setInterval> | null;
    scene: Scene;
};

function withBatchManager(run: (manager: BatchManagerHashInternals) => void): void {
    const manager = new BatchManager(new Scene());
    try {
        run(manager as unknown as BatchManagerHashInternals);
    } finally {
        manager.dispose();
    }
}

function addDeepChain(root: Object3D, depth = 12_000): Object3D {
    let cursor = root;
    for (let i = 0; i < depth; i++) {
        const child = new Object3D();
        cursor.add(child);
        cursor = child;
    }
    return cursor;
}

describe("BatchManager geometry hash cache", () => {
    const previousApp = global.app;

    afterEach(() => {
        global.app = previousApp;
    });

    it("keeps editor stats persistence out of play-only runtimes", () => {
        global.app = {options: {isPlayModeOnly: true}} as unknown as typeof global.app;
        const playOnlyManager = new BatchManager(new Scene()) as unknown as BatchManagerHashInternals;
        try {
            expect(playOnlyManager.statsIntervalId).toBeNull();
        } finally {
            playOnlyManager.dispose();
        }

        global.app = {options: {isPlayModeOnly: false}} as unknown as typeof global.app;
        const editorManager = new BatchManager(new Scene()) as unknown as BatchManagerHashInternals;
        try {
            expect(editorManager.statsIntervalId).not.toBeNull();
        } finally {
            editorManager.dispose();
        }
    });

    it("keeps a stable cached hash while geometry attributes are unchanged", () => {
        withBatchManager(manager => {
            const geometry = new BoxGeometry(1, 1, 1);

            const first = manager.hashGeometry(geometry);
            const second = manager.hashGeometry(geometry);

            expect(second).toBe(first);
            expect(manager.geometryHashCache.size).toBe(1);
        });
    });

    it("invalidates cached hashes when position attribute data is updated", () => {
        withBatchManager(manager => {
            const geometry = new BufferGeometry();
            const positions = new Float32Array([
                0, 0, 0,
                1, 0, 0,
                0, 1, 0,
            ]);
            const positionAttribute = new BufferAttribute(positions, 3);
            geometry.setAttribute("position", positionAttribute);

            const first = manager.hashGeometry(geometry);
            positions[0] = 2;
            positionAttribute.needsUpdate = true;
            const second = manager.hashGeometry(geometry);

            expect(second).not.toBe(first);
            expect(manager.geometryHashCache.size).toBe(1);
        });
    });

    it("invalidates cached signatures when an equal-sized attribute is replaced", () => {
        withBatchManager(manager => {
            const geometry = new BoxGeometry(1, 1, 1);
            manager.hashGeometry(geometry);
            const firstSignature = (manager.geometryHashCache.get(geometry.uuid) as {signature: string}).signature;
            geometry.setAttribute("position", geometry.getAttribute("position").clone());

            manager.hashGeometry(geometry);
            const secondSignature = (manager.geometryHashCache.get(geometry.uuid) as {signature: string}).signature;

            expect(secondSignature).not.toBe(firstSignature);
        });
    });

    it("invalidates cached hashes when index data is updated", () => {
        withBatchManager(manager => {
            const geometry = new BufferGeometry();
            geometry.setAttribute("position", new BufferAttribute(new Float32Array([
                0, 0, 0,
                1, 0, 0,
                0, 1, 0,
            ]), 3));
            const indexAttribute = new BufferAttribute(new Uint16Array([0, 1, 2]), 1);
            geometry.setIndex(indexAttribute);

            const first = manager.hashGeometry(geometry);
            indexAttribute.array[1] = 2;
            indexAttribute.needsUpdate = true;
            const second = manager.hashGeometry(geometry);

            expect(second).not.toBe(first);
            expect(manager.geometryHashCache.size).toBe(1);
        });
    });

    it("includes UV data in geometry hashes and invalidates it on updates", () => {
        withBatchManager(manager => {
            const geometry = new BoxGeometry(1, 1, 1);
            const uv = geometry.getAttribute("uv");
            const first = manager.hashGeometry(geometry);

            uv.setX(0, uv.getX(0) + 0.25);
            uv.needsUpdate = true;
            const second = manager.hashGeometry(geometry);

            expect(second).not.toBe(first);
        });
    });

    it("distinguishes geometries with identical positions but different UVs", () => {
        withBatchManager(manager => {
            const geometryA = new BoxGeometry(1, 1, 1);
            const geometryB = geometryA.clone();
            const uv = geometryB.getAttribute("uv");
            uv.setY(0, uv.getY(0) + 0.5);
            uv.needsUpdate = true;

            expect(manager.hashGeometry(geometryB)).not.toBe(manager.hashGeometry(geometryA));
        });
    });

    it("hashes and invalidates interleaved geometry attributes", () => {
        withBatchManager(manager => {
            const geometry = new BufferGeometry();
            const data = new InterleavedBuffer(new Float32Array([
                0, 0, 0, 0, 0,
                1, 0, 0, 1, 0,
                0, 1, 0, 0, 1,
            ]), 5);
            geometry.setAttribute("position", new InterleavedBufferAttribute(data, 3, 0));
            const uv = new InterleavedBufferAttribute(data, 2, 3);
            geometry.setAttribute("uv", uv);
            const first = manager.hashGeometry(geometry);

            uv.setX(0, 0.5);
            data.needsUpdate = true;
            const second = manager.hashGeometry(geometry);

            expect(second).not.toBe(first);
        });
    });

    it("stores current geometry hashes when merging persisted batch stats", () => {
        withBatchManager(manager => {
            const geometry = new BoxGeometry(1, 1, 1);
            const batchKey = "type:matte|map:runtime-texture|roughness:50";
            const normalizedBatchKey = "type:matte|roughness:50";
            const currentHash = manager.hashGeometry(geometry);
            const previousHash = "previous-geometry";
            manager.scene.userData.rendering = {
                batching: {
                    stats: [{
                        batchKey: normalizedBatchKey,
                        geometryHashes: [previousHash],
                        instanceCount: 2,
                        geometryCount: 1,
                        usedVertexCount: 100,
                        usedIndexCount: 100,
                    } satisfies BatchStatLike],
                },
            };
            manager.batchGroups.set(batchKey, [{
                batchedMesh: {
                    visible: true,
                    instanceCount: 4,
                    _geometryCount: 1,
                    _nextVertexStart: 200,
                    _nextIndexStart: 300,
                },
                meshes: new Map(),
                instanceIdToMesh: new Map(),
                geometries: new Map([[0, geometry]]),
            }]);

            manager.storeBatchStats();

            expect(manager.scene.userData.rendering.batching.stats).toEqual([{
                batchKey: normalizedBatchKey,
                geometryHashes: [currentHash, previousHash],
                instanceCount: 4,
                geometryCount: 1,
                usedVertexCount: 10000,
                usedIndexCount: 10000,
            }]);
        });
    });

    it("keeps batched raycast instance lookup in sync with mesh membership", () => {
        withBatchManager(manager => {
            const material = new MeshStandardMaterial();
            const meshA = new Mesh(new BoxGeometry(1, 1, 1), material);
            const meshB = new Mesh(new BoxGeometry(1, 1, 1), material);
            meshB.position.set(4, 0, 0);
            manager.scene.add(meshA, meshB);
            meshA.updateMatrixWorld(true);
            meshB.updateMatrixWorld(true);

            manager.setSceneMeshes([meshA, meshB]);
            manager.updateBatchesForSceneChanges();

            const entryA = manager.meshDataMap.get(meshA);
            const entryB = manager.meshDataMap.get(meshB);
            expect(entryA).toBeDefined();
            expect(entryB).toBeDefined();

            const batchGroup = entryA!.batchGroup as {
                batchedMesh: BatchedMesh;
                instanceIdToMesh: Map<number, Mesh>;
            };
            expect(batchGroup.instanceIdToMesh.get(entryA!.meshData.instanceId)).toBe(meshA);
            expect(batchGroup.instanceIdToMesh.get(entryB!.meshData.instanceId)).toBe(meshB);
            expect(manager.sceneMeshSet.has(meshA)).toBe(true);
            expect(manager.sceneMeshSet.has(meshB)).toBe(true);

            batchGroup.batchedMesh.updateMatrixWorld(true);
            const raycaster = new Raycaster(new Vector3(0, 0, 3), new Vector3(0, 0, -1));
            const intersections: Intersection[] = [];
            batchGroup.batchedMesh.raycast(raycaster, intersections);

            expect(intersections.some(intersection =>
                intersection.object === meshA &&
                intersection.instanceId === entryA!.meshData.instanceId,
            )).toBe(true);
            expect(intersections.some(intersection => intersection.object === batchGroup.batchedMesh)).toBe(false);

            manager.setSceneMeshes([meshB]);
            manager.updateBatchesForSceneChanges();

            expect(batchGroup.instanceIdToMesh.get(entryA!.meshData.instanceId)).toBeUndefined();
            expect(batchGroup.instanceIdToMesh.get(entryB!.meshData.instanceId)).toBe(meshB);
            expect(manager.sceneMeshSet.has(meshA)).toBe(false);
            expect(manager.sceneMeshSet.has(meshB)).toBe(true);
        });
    });

    it("does not create a new batch group for singleton meshes", () => {
        withBatchManager(manager => {
            const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());

            manager.setSceneMeshes([mesh]);
            manager.updateBatchesForSceneChanges();

            expect(manager.meshDataMap.has(mesh)).toBe(false);
            expect(manager.batchGroups.size).toBe(0);
        });
    });

    it("lets later singleton meshes join an existing compatible batch group", () => {
        withBatchManager(manager => {
            const material = new MeshStandardMaterial();
            const meshA = new Mesh(new BoxGeometry(1, 1, 1), material);
            const meshB = new Mesh(new BoxGeometry(1, 1, 1), material);
            const meshC = new Mesh(new BoxGeometry(1, 1, 1), material);

            manager.setSceneMeshes([meshA, meshB]);
            manager.updateBatchesForSceneChanges();

            expect(manager.meshDataMap.has(meshA)).toBe(true);
            expect(manager.meshDataMap.has(meshB)).toBe(true);

            manager.setSceneMeshes([meshA, meshB, meshC]);
            manager.updateBatchesForSceneChanges();

            expect(manager.meshDataMap.has(meshC)).toBe(true);
            expect(manager.batchGroups.size).toBe(1);
        });
    });

    it("skips scene reconciliation while an external mesh list is unchanged", () => {
        withBatchManager(manager => {
            const material = new MeshStandardMaterial();
            const meshA = new Mesh(new BoxGeometry(1, 1, 1), material);
            const meshB = new Mesh(new BoxGeometry(1, 1, 1), material);
            const meshes = [meshA, meshB];

            manager.setSceneMeshes(meshes);
            manager.updateBatchesForSceneChanges();
            const addNewMeshes = vi.spyOn(manager, "addNewMeshesFromList");
            const removeStaleMeshes = vi.spyOn(manager, "removeStaleMeshes");

            manager.setSceneMeshes(meshes);
            manager.updateBatchesForSceneChanges();

            expect(addNewMeshes).not.toHaveBeenCalled();
            expect(removeStaleMeshes).not.toHaveBeenCalled();
            expect(manager.meshDataMap.has(meshA)).toBe(true);
            expect(manager.meshDataMap.has(meshB)).toBe(true);
        });
    });

    it("progressively analyzes and drains large external mesh lists within clock quanta", () => {
        withBatchManager(manager => {
            const geometry = new BoxGeometry(1, 1, 1);
            const material = new MeshStandardMaterial();
            const meshes = Array.from({length: 20}, () => new Mesh(geometry, material));
            let clock = 0;
            vi.spyOn(manager, "now").mockImplementation(() => {
                clock += 5;
                return clock;
            });
            manager.setSceneMeshes(meshes);

            manager.updateBatchesForSceneChanges();

            expect(manager.progressiveAnalysisCursor).toBe(8);
            expect(manager.meshDataMap.size).toBe(0);
            expect(manager.externalSceneMeshesDirty).toBe(true);

            let updates = 1;
            while (manager.externalSceneMeshesDirty && updates < 20) {
                const previousBatchedCount = manager.meshDataMap.size;
                manager.updateBatchesForSceneChanges();
                expect(manager.meshDataMap.size - previousBatchedCount).toBeLessThanOrEqual(8);
                updates++;
            }

            expect(manager.externalSceneMeshesDirty).toBe(false);
            expect(manager.meshDataMap.size).toBe(meshes.length);
            expect(updates).toBeLessThan(20);
        });
    });

    it("invalidates progressive work when external membership changes", () => {
        withBatchManager(manager => {
            const geometry = new BoxGeometry(1, 1, 1);
            const material = new MeshStandardMaterial();
            const meshes = Array.from({length: 20}, () => new Mesh(geometry, material));
            let clock = 0;
            vi.spyOn(manager, "now").mockImplementation(() => {
                clock += 5;
                return clock;
            });
            manager.setSceneMeshes(meshes);
            manager.updateBatchesForSceneChanges();
            expect(manager.progressiveAnalysisCursor).toBe(8);

            manager.setSceneMeshes(meshes.slice(0, 2));
            while (manager.externalSceneMeshesDirty) manager.updateBatchesForSceneChanges();

            expect(manager.meshDataMap.size).toBe(2);
            expect(manager.meshDataMap.has(meshes[0]!)).toBe(true);
            expect(manager.meshDataMap.has(meshes[1]!)).toBe(true);
            for (const mesh of meshes.slice(2)) expect(manager.meshDataMap.has(mesh)).toBe(false);
        });
    });

    it("defers exclusion reconciliation until the bounded update path", () => {
        withBatchManager(manager => {
            const material = new MeshStandardMaterial();
            const meshA = new Mesh(new BoxGeometry(1, 1, 1), material);
            const meshB = new Mesh(new BoxGeometry(1, 1, 1), material);
            manager.setSceneMeshes([meshA, meshB]);
            manager.updateBatchesForSceneChanges();
            expect(manager.meshDataMap.has(meshA)).toBe(true);

            manager.setExcludedObjects([meshA]);

            expect(manager.meshDataMap.has(meshA)).toBe(true);
            manager.updateBatchesForSceneChanges();
            expect(manager.meshDataMap.has(meshA)).toBe(false);
            expect(manager.meshDataMap.has(meshB)).toBe(true);
        });
    });

    it("does not synchronously traverse and batch during pre-render exclusion setup", () => {
        withBatchManager(manager => {
            const material = new MeshStandardMaterial();
            const meshes = Array.from({length: 20}, () =>
                new Mesh(new BoxGeometry(1, 1, 1), material));
            manager.scene.add(...meshes);
            const collectSceneMeshes = vi.spyOn(manager, "collectSceneMeshes");
            const addNewMeshes = vi.spyOn(manager, "addNewMeshesFromList");

            manager.setExcludedObjects([]);

            expect(collectSceneMeshes).not.toHaveBeenCalled();
            expect(addNewMeshes).not.toHaveBeenCalled();
            expect(manager.meshDataMap.size).toBe(0);
        });
    });

    it("restarts progressive analysis when a queued batch key changes", () => {
        withBatchManager(manager => {
            const geometry = new BoxGeometry(1, 1, 1);
            const material = new MeshStandardMaterial();
            const meshes = Array.from({length: 20}, () => new Mesh(geometry, material));
            let clock = 0;
            vi.spyOn(manager, "now").mockImplementation(() => {
                clock += 5;
                return clock;
            });
            manager.setSceneMeshes(meshes);
            while (!manager.progressiveQueuePrepared) manager.updateBatchesForSceneChanges();

            meshes[0]!.material = material.clone();
            (meshes[0]!.material as MeshStandardMaterial).transparent = true;
            while (manager.externalSceneMeshesDirty) manager.updateBatchesForSceneChanges();

            expect(manager.meshDataMap.has(meshes[0]!)).toBe(false);
            expect(manager.meshDataMap.size).toBe(meshes.length - 1);
        });
    });

    it("keeps explicit batchSceneMeshes synchronous", () => {
        withBatchManager(manager => {
            const geometry = new BoxGeometry(1, 1, 1);
            const material = new MeshStandardMaterial();
            const meshes = Array.from({length: 20}, () => new Mesh(geometry, material));
            manager.scene.add(...meshes);

            const added = (manager as unknown as {batchSceneMeshes(): number}).batchSceneMeshes();

            expect(added).toBe(meshes.length);
            expect(manager.meshDataMap.size).toBe(meshes.length);
        });
    });

    it("retains its own snapshot of reusable traversal results", () => {
        withBatchManager(manager => {
            const material = new MeshStandardMaterial();
            const meshA = new Mesh(new BoxGeometry(1, 1, 1), material);
            const meshB = new Mesh(new BoxGeometry(1, 1, 1), material);
            const traversalResults = [meshA, meshB];

            manager.setSceneMeshes(traversalResults);
            traversalResults.length = 0;

            expect(manager.sceneMeshes).toEqual([meshA, meshB]);

            traversalResults.push(meshB, meshA);
            manager.setSceneMeshes(traversalResults);
            manager.updateBatchesForSceneChanges();

            expect(manager.sceneMeshes).toEqual([meshB, meshA]);
            expect(manager.sceneMeshSet.has(meshA)).toBe(true);
            expect(manager.sceneMeshSet.has(meshB)).toBe(true);
        });
    });

    it("accepts unchanged traversal revisions without rescanning mesh identities", () => {
        withBatchManager(manager => {
            const material = new MeshStandardMaterial();
            const source = [
                new Mesh(new BoxGeometry(1, 1, 1), material),
                new Mesh(new BoxGeometry(1, 1, 1), material),
            ];
            let indexedReads = 0;
            const traversalResults = new Proxy(source, {
                get(target, property, receiver) {
                    if (typeof property === "string" && /^\d+$/.test(property)) indexedReads++;
                    return Reflect.get(target, property, receiver);
                },
            });

            manager.setSceneMeshes(traversalResults, 4);
            indexedReads = 0;
            manager.setSceneMeshes(traversalResults, 4);

            expect(indexedReads).toBe(0);
            expect(manager.sceneMeshes).toEqual(source);

            manager.setSceneMeshes(traversalResults, 5);
            expect(indexedReads).toBe(source.length);
        });
    });

    it("preserves static ancestry metadata for externally supplied meshes", () => {
        withBatchManager(manager => {
            const staticRoot = new Object3D();
            staticRoot.userData.isStatic = true;
            const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
            staticRoot.add(mesh);

            manager.setSceneMeshes([mesh]);

            expect(manager.staticMeshes.has(mesh)).toBe(true);
        });
    });

    it("re-batches meshes after position data changes", () => {
        withBatchManager(manager => {
            const material = new MeshStandardMaterial();
            const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
            const peerMesh = new Mesh(new BoxGeometry(1, 1, 1), material);
            manager.setSceneMeshes([mesh, peerMesh]);
            manager.updateBatchesForSceneChanges();
            const previousGroup = manager.meshDataMap.get(mesh)!.batchGroup;
            const position = mesh.geometry.getAttribute("position");

            position.setX(0, position.getX(0) + 0.5);
            position.needsUpdate = true;
            manager.updateBatchedMeshes();

            const nextEntry = manager.meshDataMap.get(mesh);
            expect(nextEntry).toBeDefined();
            expect(nextEntry!.batchGroup).not.toBe(previousGroup);
            const positionVersion = (position as unknown as {version?: number; data?: {version?: number}}).version ??
                (position as unknown as {data?: {version?: number}}).data?.version ?? 0;
            const geometryRevision = (nextEntry!.meshData as unknown as {
                geometryRevision: {attributes: Array<{name: string; version: number}>};
            }).geometryRevision;
            expect(geometryRevision.attributes.find(attribute => attribute.name === "position")?.version)
                .toBe(positionVersion);
        });
    });

    it("re-batches meshes after UV data changes", () => {
        withBatchManager(manager => {
            const material = new MeshStandardMaterial();
            const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
            const peerMesh = new Mesh(mesh.geometry.clone(), material);
            manager.setSceneMeshes([mesh, peerMesh]);
            manager.updateBatchesForSceneChanges();
            const previousGroup = manager.meshDataMap.get(mesh)!.batchGroup;
            const uv = mesh.geometry.getAttribute("uv");

            uv.setX(0, uv.getX(0) + 0.25);
            uv.needsUpdate = true;
            manager.updateBatchedMeshes();

            expect(manager.meshDataMap.get(mesh)!.batchGroup).not.toBe(previousGroup);
            expect(manager.meshDataMap.get(peerMesh)!.batchGroup).toBe(previousGroup);
        });
    });

    it("re-batches meshes when material pipeline or shadow flags change", () => {
        withBatchManager(manager => {
            const material = new MeshStandardMaterial();
            const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
            const peerMesh = new Mesh(new BoxGeometry(1, 1, 1), material);
            manager.setSceneMeshes([mesh, peerMesh]);
            manager.updateBatchesForSceneChanges();

            const initialGroup = manager.meshDataMap.get(mesh)!.batchGroup;
            material.transparent = true;
            manager.updateBatchedMeshes();
            const transparentGroup = manager.meshDataMap.get(mesh)!.batchGroup;

            expect(transparentGroup).not.toBe(initialGroup);

            mesh.castShadow = true;
            manager.updateBatchedMeshes();

            expect(manager.meshDataMap.get(mesh)!.batchGroup).not.toBe(transparentGroup);
        });
    });

    it("checks shared stable materials once per update while retaining per-mesh snapshots", () => {
        withBatchManager(manager => {
            const material = new MeshStandardMaterial();
            const meshA = new Mesh(new BoxGeometry(1, 1, 1), material);
            const meshB = new Mesh(new BoxGeometry(1, 1, 1), material);
            manager.setSceneMeshes([meshA, meshB]);
            manager.updateBatchesForSceneChanges();
            const significantChange = vi.spyOn(manager, "hasSignificantMaterialChange");

            manager.updateBatchedMeshes();

            expect(significantChange).toHaveBeenCalledTimes(1);

            material.color.set(0x336699);
            significantChange.mockClear();
            manager.updateBatchedMeshes();

            expect(significantChange).toHaveBeenCalledTimes(1);
            for (const mesh of [meshA, meshB]) {
                const meshData = manager.meshDataMap.get(mesh)!.meshData as unknown as {
                    materialProperties: {color: {getHex(): number}};
                    materialUsage: {count: number};
                };
                expect(meshData.materialProperties.color.getHex()).toBe(0x336699);
                expect(meshData.materialUsage.count).toBe(2);
            }
        });
    });

    it("compares distinct material instances independently", () => {
        withBatchManager(manager => {
            const meshA = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
            const meshB = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
            manager.setSceneMeshes([meshA, meshB]);
            manager.updateBatchesForSceneChanges();
            const significantChange = vi.spyOn(manager, "hasSignificantMaterialChange");

            manager.updateBatchedMeshes();

            expect(significantChange).toHaveBeenCalledTimes(2);
        });
    });

    it("updates tracked batches without redundant mesh map lookups", () => {
        class CountingGetMap<K, V> extends Map<K, V> {
            getCalls = 0;

            get(key: K): V | undefined {
                this.getCalls++;
                return super.get(key);
            }
        }

        withBatchManager(manager => {
            const material = new MeshStandardMaterial();
            const meshA = new Mesh(new BoxGeometry(1, 1, 1), material);
            const meshB = new Mesh(new BoxGeometry(1, 1, 1), material);
            manager.setSceneMeshes([meshA, meshB]);
            manager.updateBatchesForSceneChanges();

            const tracked = new CountingGetMap(manager.meshDataMap);
            manager.meshDataMap = tracked;
            manager.updateBatchedMeshes();

            expect(tracked.getCalls).toBe(0);
        });
    });

    it("removes meshes that become non-batchable during updates", () => {
        withBatchManager(manager => {
            const material = new MeshStandardMaterial();
            const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
            const peerMesh = new Mesh(new BoxGeometry(1, 1, 1), material);
            const newMeshScratch = manager.newMeshScratch;
            manager.setSceneMeshes([mesh, peerMesh]);
            manager.updateBatchesForSceneChanges();

            expect(manager.meshDataMap.has(mesh)).toBe(true);
            expect(manager.meshDataMap.has(peerMesh)).toBe(true);
            expect(manager.newMeshScratch).toBe(newMeshScratch);
            expect(manager.newMeshScratch).toHaveLength(0);

            mesh.userData.isBatchable = false;
            manager.updateBatchedMeshes();

            expect(manager.meshDataMap.has(mesh)).toBe(false);
            expect(manager.meshDataMap.has(peerMesh)).toBe(true);
        });
    });

    it("retries temporarily non-batchable meshes without reconciling the full stable list", () => {
        withBatchManager(manager => {
            const material = new MeshStandardMaterial();
            const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
            const peerMesh = new Mesh(new BoxGeometry(1, 1, 1), material);
            mesh.userData.isBatchable = false;
            manager.setSceneMeshes([mesh, peerMesh]);
            manager.updateBatchesForSceneChanges();

            expect(manager.meshDataMap.has(mesh)).toBe(false);
            expect(manager.retryableMeshes.has(mesh)).toBe(true);

            mesh.userData.isBatchable = true;
            manager.updateBatchesForSceneChanges();

            expect(manager.meshDataMap.has(mesh)).toBe(true);
            expect(manager.retryableMeshes.has(mesh)).toBe(false);
        });
    });

    it("analyzes deep scenes without recursive traversal while pruning excluded subtrees", () => {
        withBatchManager(manager => {
            const staticRoot = new Object3D();
            staticRoot.userData.isStatic = true;
            const deepLeaf = addDeepChain(staticRoot);
            const batchableMesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
            deepLeaf.add(batchableMesh);

            const excludedRoot = new Object3D();
            excludedRoot.userData.isBatchable = false;
            const excludedMesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
            excludedRoot.add(excludedMesh);
            manager.scene.add(staticRoot, excludedRoot);
            const traverseSceneAnalysis = vi.spyOn(manager, "traverseSceneAnalysis");

            manager.collectSceneMeshes();

            expect(traverseSceneAnalysis).toHaveBeenCalledTimes(1);
            expect(manager.sceneMeshes).toContain(batchableMesh);
            expect(manager.staticMeshes.has(batchableMesh)).toBe(true);
            expect(manager.sceneMeshes).not.toContain(excludedMesh);
        });
    });

    it("hides only batched source meshes and preserves shared material visibility", () => {
        withBatchManager(manager => {
            const sharedMaterial = new MeshStandardMaterial();
            const excludedMaterial = new MeshStandardMaterial();
            const meshA = new Mesh(new BoxGeometry(1, 1, 1), sharedMaterial);
            const meshB = new Mesh(new BoxGeometry(1, 1, 1), sharedMaterial);
            const excludedMesh = new Mesh(new BoxGeometry(1, 1, 1), excludedMaterial);
            manager.scene.add(meshA, meshB, excludedMesh);
            manager.setExcludedObjects([excludedMesh]);
            manager.setSceneMeshes([meshA, meshB, excludedMesh]);
            manager.updateBatchesForSceneChanges();

            expect(manager.meshDataMap.has(excludedMesh)).toBe(false);
            manager.hideOriginalMeshes();

            expect(meshA.visible).toBe(false);
            expect(meshB.visible).toBe(false);
            expect(excludedMesh.visible).toBe(true);
            expect(sharedMaterial.visible).toBe(true);
            expect(excludedMaterial.visible).toBe(true);
            expect(manager.hiddenOriginalMeshes.size).toBe(2);

            const batchGroup = manager.meshDataMap.get(meshA)!.batchGroup as {
                batchedMesh: {visible: boolean};
            };
            expect(batchGroup.batchedMesh.visible).toBe(true);

            manager.showOriginalMeshes();

            expect(meshA.visible).toBe(true);
            expect(meshB.visible).toBe(true);
            expect(sharedMaterial.visible).toBe(true);
            expect(excludedMaterial.visible).toBe(true);
            expect(manager.hiddenOriginalMeshes.size).toBe(0);
            expect(batchGroup.batchedMesh.visible).toBe(false);
        });
    });

    it("keeps not-yet-batched meshes visible during progressive batching", () => {
        withBatchManager(manager => {
            const geometry = new BoxGeometry(1, 1, 1);
            const material = new MeshStandardMaterial();
            const meshes = Array.from({length: 20}, () => new Mesh(geometry, material));
            let clock = 0;
            vi.spyOn(manager, "now").mockImplementation(() => {
                clock += 5;
                return clock;
            });
            manager.setSceneMeshes(meshes);
            while (manager.meshDataMap.size === 0) manager.updateBatchesForSceneChanges();
            expect(manager.meshDataMap.size).toBeLessThan(meshes.length);

            manager.hideOriginalMeshes();

            for (const mesh of meshes) {
                expect(mesh.visible).toBe(!manager.meshDataMap.has(mesh));
            }
            expect(material.visible).toBe(true);

            manager.showOriginalMeshes();
            for (const mesh of meshes) expect(mesh.visible).toBe(true);
        });
    });
});
