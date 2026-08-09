import {BoxGeometry, Matrix4, Mesh, MeshBasicMaterial, Object3D} from "three";
import { describe, expect, it, vi } from "vitest";

import { EndlessTerrainObjects, TerrainObjectType, type TerrainObjectModel } from "./EndlessTerrainObjects";

/**
 *
 */
function createTerrainObjects() {
    const parent = new Object3D();
    const terrainModels: TerrainObjectModel[] = [
        {
            url: "/rock.glb",
            minScale: 1,
            maxScale: 1,
            probability: 1,
            type: TerrainObjectType.Rock,
        },
    ];
    const terrainObjects = new EndlessTerrainObjects(parent, () => 0, terrainModels, {
        chunkSize: 8,
        density: 1,
        chunkSegments: 20,
        maxHeight: 200,
        grassMaxHeight: 7,
        rockMaxHeight: 39,
    });

    (terrainObjects as any).modelsReady = true;

    return terrainObjects;
}

function addDeepObjectChain(root: Object3D, depth = 12_000): Object3D {
    let current = root;

    for (let i = 0; i < depth; i++) {
        const child = new Object3D();
        current.add(child);
        current = child;
    }

    return current;
}

describe("EndlessTerrainObjects worker lifecycle", () => {
    it("does not enqueue removed chunks when models become ready", async () => {
        const terrainObjects = createTerrainObjects();
        (terrainObjects as any).modelsReady = false;
        const enqueueAdd = vi.spyOn(terrainObjects as any, "enqueueAdd");

        terrainObjects.addObjectsForChunk(9, 10);
        terrainObjects.removeObjectsForChunk(9, 10);

        await terrainObjects.init();

        expect(enqueueAdd).not.toHaveBeenCalled();
    });

    it("ignores stale worker results after a chunk is removed and re-added", () => {
        const terrainObjects = createTerrainObjects();
        const manager = {
            root: new Object3D(),
            addInstance: vi.fn(() => 0),
            removeChunk: vi.fn(() => false),
            getObject: vi.fn(() => new Object3D()),
            getCount: vi.fn(() => 0),
            markBoundsDirty: vi.fn(),
            updateBounds: vi.fn(),
        };
        (terrainObjects as any).managers = [manager];

        terrainObjects.addObjectsForChunk(1, 2);
        const firstGeneration = (terrainObjects as any).chunkGenerations.get("1,2");

        terrainObjects.removeObjectsForChunk(1, 2);
        terrainObjects.addObjectsForChunk(1, 2);
        const secondGeneration = (terrainObjects as any).chunkGenerations.get("1,2");

        expect(secondGeneration).toBe(firstGeneration + 1);

        const matrix = new Matrix4();
        (terrainObjects as any).applyPlacementResult({
            taskId: "stale-result",
            chunkX: 1,
            chunkZ: 2,
            generation: firstGeneration,
            modelIndices: Int32Array.from([0]),
            matrices: Float32Array.from(matrix.elements),
            objectIds: ["stale"],
        });

        expect(manager.addInstance).not.toHaveBeenCalled();
    });

    it("requeues in-flight tasks when the worker fails", () => {
        const terrainObjects = createTerrainObjects();

        terrainObjects.addObjectsForChunk(3, 4);
        const generation = (terrainObjects as any).chunkGenerations.get("3,4");
        const task = {
            type: "add",
            chunkX: 3,
            chunkZ: 4,
            start: 0,
            count: 64,
            totalInChunk: 64,
            generation,
        } as const;

        (terrainObjects as any).updateQueue = [];
        (terrainObjects as any).pendingPlacementTasks.set("task-1", task);
        const terminate = vi.fn();
        (terrainObjects as any).placementWorker = { terminate };

        (terrainObjects as any).handlePlacementWorkerError(new Error("worker failed"));

        expect(terminate).toHaveBeenCalled();
        expect((terrainObjects as any).placementWorker).toBeNull();
        expect((terrainObjects as any).pendingPlacementTasks.size).toBe(0);
        expect((terrainObjects as any).updateQueue).toEqual([task]);
    });

    it("processes queued removes even when worker tasks are saturated", () => {
        const terrainObjects = createTerrainObjects();
        const maxPending = (EndlessTerrainObjects as any).MAX_PENDING_PLACEMENT_TASKS;
        const addTask = {
            type: "add",
            chunkX: 5,
            chunkZ: 6,
            start: 0,
            count: 64,
            totalInChunk: 64,
            generation: 1,
        } as const;
        const removeTask = {
            type: "remove",
            chunkX: 7,
            chunkZ: 8,
        } as const;

        (terrainObjects as any).updateQueue = [addTask, removeTask];
        (terrainObjects as any).placementProxy = {};
        (terrainObjects as any).pendingPlacementTasks = new Map(
            Array.from({ length: maxPending }, (_, index) => [`task-${index}`, addTask]),
        );
        (terrainObjects as any).processRemove = vi.fn();

        terrainObjects.update(0.016);

        expect((terrainObjects as any).processRemove).toHaveBeenCalledWith(removeTask);
        // Saturation path leaves the add task in place and nulls the consumed
        // remove slot (head-pointer queue compacts lazily).
        expect((terrainObjects as any).updateQueue).toEqual([addTask, undefined]);
    });

    it("prioritizes nearer add tasks after the camera origin updates", () => {
        const terrainObjects = createTerrainObjects();
        const enqueueAdd = (terrainObjects as any).enqueueAdd.bind(terrainObjects as any);

        enqueueAdd(6, 0, 1);
        enqueueAdd(1, 0, 1);
        enqueueAdd(3, 0, 1);

        terrainObjects.setPriorityOrigin(8, 0);
        (terrainObjects as any).reprioritizeQueuedAddTasks();

        const queuedAdds = (terrainObjects as any).updateQueue.filter((task: any) => task?.type === "add");
        expect(queuedAdds[0]).toMatchObject({ chunkX: 1, chunkZ: 0 });
        expect(queuedAdds[1]).toMatchObject({ chunkX: 3, chunkZ: 0 });
        expect(queuedAdds[2]).toMatchObject({ chunkX: 6, chunkZ: 0 });
    });

    it("readds active chunks when density changes without reparsing malformed keys", () => {
        const terrainObjects = createTerrainObjects();
        const removeObjectsForChunk = vi.spyOn(terrainObjects, "removeObjectsForChunk").mockImplementation(() => undefined);
        const addObjectsForChunk = vi.spyOn(terrainObjects, "addObjectsForChunk").mockImplementation(() => undefined);
        const addedChunkKeys = (terrainObjects as any).addedChunkKeys as Set<string>;
        addedChunkKeys.add("2,3");
        addedChunkKeys.add("bad-key");
        addedChunkKeys.add("4,5");

        terrainObjects.setDensity(0.35, true);

        expect((terrainObjects as any).options.density).toBe(0.35);
        expect(removeObjectsForChunk).toHaveBeenCalledTimes(2);
        expect(addObjectsForChunk).toHaveBeenCalledTimes(2);
        expect(removeObjectsForChunk).toHaveBeenNthCalledWith(1, 2, 3);
        expect(addObjectsForChunk).toHaveBeenNthCalledWith(1, 2, 3);
        expect(removeObjectsForChunk).toHaveBeenNthCalledWith(2, 4, 5);
        expect(addObjectsForChunk).toHaveBeenNthCalledWith(2, 4, 5);
        expect((terrainObjects as any).densityReaddChunkKeysScratch).toHaveLength(0);
    });

    it("loads scene object models from deep hierarchies without recursive traversal", () => {
        const sceneRoot = new Object3D();
        const leaf = addDeepObjectChain(sceneRoot);
        const selectedObject = new Object3D();
        const material = new MeshBasicMaterial();
        const mesh = new Mesh(new BoxGeometry(), material);
        selectedObject.add(mesh);
        leaf.add(selectedObject);
        const terrainObjects = new EndlessTerrainObjects(new Object3D(), () => 0, [], {
            sceneRoot,
        });
        const sceneTraverseSpy = vi.spyOn(sceneRoot, "traverse");
        const selectedTraverseSpy = vi.spyOn(selectedObject, "traverse");

        const result = (terrainObjects as any).loadModelFromSceneObject(selectedObject.uuid);

        expect(result?.geometry).toBeDefined();
        expect(result?.geometry).not.toBe(mesh.geometry);
        expect(result?.material).toBeDefined();
        expect(result?.material).not.toBe(material);
        expect(sceneTraverseSpy).not.toHaveBeenCalled();
        expect(selectedTraverseSpy).not.toHaveBeenCalled();
    });
});
