import * as THREE from "three";
import {beforeEach, describe, expect, it, vi} from "vitest";

const navcatMocks = vi.hoisted(() => ({
    DEFAULT_QUERY_FILTER: {includeFlags: 1},
    DebugPrimitiveType: {Triangles: 0},
    createFindNearestPolyResult: vi.fn(() => ({
        success: false,
        nodeRef: 0,
        position: [0, 0, 0] as [number, number, number],
    })),
    createNavMeshHelper: vi.fn(() => []),
    findNearestPoly: vi.fn(),
    findPath: vi.fn(),
    findRandomPointAroundCircle: vi.fn(),
}));
const navcatBlocksMocks = vi.hoisted(() => ({
    generateSoloNavMesh: vi.fn(),
}));

vi.mock("navcat", () => navcatMocks);
vi.mock("navcat/blocks", () => navcatBlocksMocks);

import NavMeshBehavior from "./NavMeshBehavior";

const createReadyBehavior = () => {
    const target = new THREE.Object3D();
    const behavior = new NavMeshBehavior(target, "navmesh", {
        gameObject: {target} as any,
        erth: {} as any,
        attributes: {},
    });

    (behavior as any).isReady = true;
    (behavior as any).navMesh = {id: "navmesh"};
    return behavior;
};

const createGenerationBehavior = (scene: THREE.Scene, attributes: Record<string, unknown> = {}) => {
    const target = new THREE.Object3D();
    const behavior = new NavMeshBehavior(target, "navmesh", {
        gameObject: {target} as any,
        erth: {} as any,
        attributes: {
            autoGenerate: false,
            cellSize: 0.3,
            cellHeight: 0.2,
            agentRadius: 0.5,
            agentHeight: 2,
            agentMaxClimb: 0.4,
            detailSampleDist: 6,
            detailSampleMaxError: 1,
            agentMaxSlope: 45,
            regionMinSize: 8,
            regionMergeSize: 20,
            edgeMaxError: 1.3,
            edgeMaxLen: 12,
            vertsPerPoly: 6,
            ...attributes,
        },
    });

    (behavior as any).scene = scene;
    (behavior as any).previewScene = scene;
    return behavior;
};

const createTriangleMesh = () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([
        0, 0, 0,
        1, 0, 0,
        0, 0, 1,
    ], 3));
    return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
};

function addDeepChain(root: THREE.Object3D, depth = 12_000): THREE.Object3D {
    let cursor = root;
    for (let i = 0; i < depth; i++) {
        const child = new THREE.Object3D();
        cursor.add(child);
        cursor = child;
    }
    return cursor;
}

describe("NavMeshBehavior", () => {
    beforeEach(() => {
        navcatMocks.createFindNearestPolyResult.mockClear();
        navcatMocks.createNavMeshHelper.mockClear();
        navcatMocks.findNearestPoly.mockReset();
        navcatMocks.findPath.mockReset();
        navcatMocks.findRandomPointAroundCircle.mockReset();
        navcatBlocksMocks.generateSoloNavMesh.mockReset();
        navcatBlocksMocks.generateSoloNavMesh.mockReturnValue({navMesh: {id: "generated-navmesh"}});
    });

    it("reuses navcat Vec3 query buffers while preserving findPath results", () => {
        const behavior = createReadyBehavior();
        navcatMocks.findPath.mockReturnValue({
            success: true,
            path: [
                {position: [1, 2, 3]},
                {position: [4, 5, 6]},
            ],
        });

        const firstPath = behavior.findPath(new THREE.Vector3(0, 1, 2), new THREE.Vector3(3, 4, 5));
        const firstCall = navcatMocks.findPath.mock.calls[0]!;

        expect(firstPath?.map(point => point.toArray())).toEqual([
            [1, 2, 3],
            [4, 5, 6],
        ]);
        expect(firstCall[1]).toEqual([0, 1, 2]);
        expect(firstCall[2]).toEqual([3, 4, 5]);
        expect(firstCall[3]).toEqual([1, 1, 1]);

        behavior.findPath(
            new THREE.Vector3(9, 8, 7),
            new THREE.Vector3(6, 5, 4),
            new THREE.Vector3(0.5, 0.75, 1.25),
        );
        const secondCall = navcatMocks.findPath.mock.calls[1]!;

        expect(secondCall[1]).toBe(firstCall[1]);
        expect(secondCall[2]).toBe(firstCall[2]);
        expect(secondCall[3]).toBe(firstCall[3]);
        expect(secondCall[1]).toEqual([9, 8, 7]);
        expect(secondCall[2]).toEqual([6, 5, 4]);
        expect(secondCall[3]).toEqual([0.5, 0.75, 1.25]);
    });

    it("resets and reuses the nearest-poly result buffer for nearest point queries", () => {
        const behavior = createReadyBehavior();
        navcatMocks.findNearestPoly
            .mockImplementationOnce((result, _navMesh, position) => {
                result.success = true;
                result.nodeRef = 123;
                result.position[0] = position[0] + 1;
                result.position[1] = position[1] + 1;
                result.position[2] = position[2] + 1;
                return result;
            })
            .mockImplementationOnce(result => result);

        expect(behavior.findNearestPoint(new THREE.Vector3(1, 2, 3))?.toArray()).toEqual([2, 3, 4]);
        const firstResultBuffer = navcatMocks.findNearestPoly.mock.calls[0]![0];
        const firstPositionBuffer = navcatMocks.findNearestPoly.mock.calls[0]![2];
        const firstHalfExtentsBuffer = navcatMocks.findNearestPoly.mock.calls[0]![3];

        expect(behavior.findNearestPoint(new THREE.Vector3(4, 5, 6))).toBeNull();
        const secondCall = navcatMocks.findNearestPoly.mock.calls[1]!;

        expect(secondCall[0]).toBe(firstResultBuffer);
        expect(secondCall[2]).toBe(firstPositionBuffer);
        expect(secondCall[3]).toBe(firstHalfExtentsBuffer);
        expect(secondCall[2]).toEqual([4, 5, 6]);
        expect(secondCall[3]).toEqual([1, 1, 1]);
    });

    it("uses reusable nearest-poly buffers before random point queries", () => {
        const behavior = createReadyBehavior();
        navcatMocks.findNearestPoly.mockImplementation(result => {
            result.success = true;
            result.nodeRef = 77;
            return result;
        });
        navcatMocks.findRandomPointAroundCircle.mockReturnValue({
            success: true,
            position: [8, 9, 10],
        });

        expect(behavior.findRandomPoint(new THREE.Vector3(2, 0, 2), 5)?.toArray()).toEqual([8, 9, 10]);

        const nearestCall = navcatMocks.findNearestPoly.mock.calls[0]!;
        const randomCall = navcatMocks.findRandomPointAroundCircle.mock.calls[0]!;
        expect(nearestCall[2]).toEqual([2, 0, 2]);
        expect(nearestCall[3]).toEqual([1, 1, 1]);
        expect(randomCall[1]).toBe(77);
        expect(randomCall[2]).toBe(nearestCall[2]);
        expect(randomCall[3]).toBe(5);
        expect(randomCall[4]).toBe(navcatMocks.DEFAULT_QUERY_FILTER);
        expect(typeof randomCall[5]).toBe("function");
    });

    it("generates from each scene mesh once when meshes are inside groups", async () => {
        const scene = new THREE.Scene();
        const group = new THREE.Group();
        const mesh = createTriangleMesh();
        group.add(mesh);
        scene.add(group);
        scene.updateMatrixWorld(true);

        const behavior = createGenerationBehavior(scene);

        await expect(behavior.generateNavMesh()).resolves.toBe(true);

        const geometryInput = navcatBlocksMocks.generateSoloNavMesh.mock.calls[0]![0];
        expect(geometryInput.positions).toHaveLength(9);
        expect(geometryInput.indices).toEqual([0, 1, 2]);
    });

    it("generates from deep scene meshes without recursive traversal", async () => {
        const scene = new THREE.Scene();
        const leaf = addDeepChain(scene);
        leaf.add(createTriangleMesh());
        const traverse = vi.spyOn(scene, "traverse");

        const behavior = createGenerationBehavior(scene);

        await expect(behavior.generateNavMesh()).resolves.toBe(true);

        const geometryInput = navcatBlocksMocks.generateSoloNavMesh.mock.calls[0]![0];
        expect(geometryInput.positions).toHaveLength(9);
        expect(geometryInput.indices).toEqual([0, 1, 2]);
        expect(traverse).not.toHaveBeenCalled();
    });

    it("flattens deep mesh groups without recursive traversal", () => {
        const scene = new THREE.Scene();
        const group = new THREE.Group();
        const leaf = addDeepChain(group);
        leaf.add(createTriangleMesh());
        const traverse = vi.spyOn(group, "traverse");
        const behavior = createGenerationBehavior(scene);

        const [positions, indices] = (behavior as any).getSafePositionsAndIndices([group]);

        expect(positions).toHaveLength(9);
        expect(indices).toEqual([0, 1, 2]);
        expect(traverse).not.toHaveBeenCalled();
    });

    it("disposes deep debug visualization without recursive traversal", () => {
        const scene = new THREE.Scene();
        const behavior = createGenerationBehavior(scene);
        const debugGroup = new THREE.Group();
        const leaf = addDeepChain(debugGroup);
        const geometry = new THREE.BufferGeometry();
        const material = new THREE.MeshBasicMaterial();
        leaf.add(new THREE.Mesh(geometry, material));
        scene.add(debugGroup);
        (behavior as any).debugGroup = debugGroup;
        const traverse = vi.spyOn(debugGroup, "traverse");
        const disposeGeometry = vi.spyOn(geometry, "dispose");
        const disposeMaterial = vi.spyOn(material, "dispose");

        behavior.dispose();

        expect(disposeGeometry).toHaveBeenCalledOnce();
        expect(disposeMaterial).toHaveBeenCalledOnce();
        expect(traverse).not.toHaveBeenCalled();
    });

    it("keeps parent physics groups eligible without duplicating child mesh geometry", async () => {
        const scene = new THREE.Scene();
        const group = new THREE.Group();
        group.userData.physics = {enabled: true};
        const mesh = createTriangleMesh();
        group.add(mesh);
        scene.add(group);
        scene.updateMatrixWorld(true);

        const behavior = createGenerationBehavior(scene, {onlyPhysicsMeshes: true});

        await expect(behavior.generateNavMesh()).resolves.toBe(true);

        const geometryInput = navcatBlocksMocks.generateSoloNavMesh.mock.calls[0]![0];
        expect(geometryInput.positions).toHaveLength(9);
        expect(geometryInput.indices).toEqual([0, 1, 2]);
    });

    it("schedules regeneration for changed meshes under physics-enabled parent groups", async () => {
        vi.useFakeTimers();
        try {
            const scene = new THREE.Scene();
            const group = new THREE.Group();
            group.userData.physics = {enabled: true};
            const mesh = createTriangleMesh();
            group.add(mesh);
            scene.add(group);

            const behavior = createGenerationBehavior(scene, {
                autoGenerate: true,
                onlyPhysicsMeshes: true,
                debugVisualization: false,
            });
            const regenerateNavMesh = vi.fn().mockResolvedValue(true);
            (behavior as any).editor = {};
            (behavior as any).regenerateNavMesh = regenerateNavMesh;

            (behavior as any).handleObjectChanged(mesh);
            await vi.advanceTimersByTimeAsync(1000);

            expect(regenerateNavMesh).toHaveBeenCalledOnce();
        } finally {
            vi.useRealTimers();
        }
    });

    it("schedules regeneration for deep physics descendants without recursive traversal", async () => {
        vi.useFakeTimers();
        try {
            const scene = new THREE.Scene();
            const changedRoot = new THREE.Object3D();
            const leaf = addDeepChain(changedRoot);
            leaf.userData.physics = {enabled: true};
            scene.add(changedRoot);
            const traverse = vi.spyOn(changedRoot, "traverse");

            const behavior = createGenerationBehavior(scene, {
                autoGenerate: true,
                onlyPhysicsMeshes: true,
                debugVisualization: false,
            });
            const regenerateNavMesh = vi.fn().mockResolvedValue(true);
            (behavior as any).editor = {};
            (behavior as any).regenerateNavMesh = regenerateNavMesh;

            (behavior as any).handleObjectChanged(changedRoot);
            await vi.advanceTimersByTimeAsync(1000);

            expect(regenerateNavMesh).toHaveBeenCalledOnce();
            expect(traverse).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });
});
