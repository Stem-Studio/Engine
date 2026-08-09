import {BoxGeometry, Matrix4, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import {CACHE_CONFIG} from "../../../config/performance.config";
import {VisibilityChecker} from "../implementations/VisibilityChecker";

function createCamera() {
    const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    return camera;
}

function createMesh() {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    mesh.updateMatrixWorld(true);
    return mesh;
}

describe("VisibilityChecker", () => {
    let checker: VisibilityChecker | null = null;

    afterEach(() => {
        checker?.dispose();
        checker = null;
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("does not allocate the LRU cache or cleanup timer before a visibility query", () => {
        const setIntervalSpy = vi.spyOn(window, "setInterval").mockReturnValue(123 as any);
        vi.spyOn(window, "clearInterval").mockImplementation(() => {});

        checker = new VisibilityChecker();

        expect((checker as unknown as {cache: unknown}).cache).toBeNull();
        expect(setIntervalSpy).not.toHaveBeenCalled();
        expect(checker.getCacheStats().size).toBe(0);

        expect(checker.isVisible(createMesh(), createCamera())).toBe(true);

        expect((checker as unknown as {cache: unknown}).cache).not.toBeNull();
        expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    });

    it("invalidates cached visibility when the camera rotates", () => {
        checker = new VisibilityChecker();
        const camera = createCamera();
        const mesh = createMesh();

        expect(checker.isVisible(mesh, camera)).toBe(true);

        camera.lookAt(0, 0, 20);
        camera.updateMatrixWorld(true);

        expect(checker.isVisible(mesh, camera)).toBe(false);
    });

    it("does not reuse cached frustums across cameras with the same local version", () => {
        checker = new VisibilityChecker();
        const mesh = createMesh();
        const visibleCamera = createCamera();
        const hiddenCamera = createCamera();
        hiddenCamera.lookAt(0, 0, 20);
        hiddenCamera.updateMatrixWorld(true);

        expect(checker.isVisible(mesh, visibleCamera)).toBe(true);
        expect(checker.isVisible(mesh, hiddenCamera)).toBe(false);
    });

    it("keeps separate cache entries per camera for the same object", () => {
        checker = new VisibilityChecker();
        const mesh = createMesh();
        const visibleCamera = createCamera();
        const hiddenCamera = createCamera();
        hiddenCamera.lookAt(0, 0, 20);
        hiddenCamera.updateMatrixWorld(true);

        expect(checker.isVisible(mesh, visibleCamera)).toBe(true);
        expect(checker.isVisible(mesh, hiddenCamera)).toBe(false);
        expect(checker.isVisible(mesh, visibleCamera)).toBe(true);

        const stats = checker.getCacheStats();
        expect(stats.hits).toBe(1);
        expect(stats.misses).toBe(2);
        expect(stats.size).toBe(2);
    });

    it("creates a new cache key when an object's uuid changes", () => {
        checker = new VisibilityChecker();
        const mesh = createMesh();
        const camera = createCamera();

        expect(checker.isVisible(mesh, camera)).toBe(true);
        (mesh as unknown as {uuid: string}).uuid = "replacement-uuid";
        expect(checker.isVisible(mesh, camera)).toBe(true);

        const stats = checker.getCacheStats();
        expect(stats.hits).toBe(0);
        expect(stats.misses).toBe(2);
        expect(stats.size).toBe(2);
    });

    it("invalidates cached visibility when the object moves", () => {
        checker = new VisibilityChecker();
        const camera = createCamera();
        const mesh = createMesh();

        expect(checker.isVisible(mesh, camera)).toBe(true);

        mesh.position.set(100, 0, 0);
        mesh.updateMatrixWorld(true);

        expect(checker.isVisible(mesh, camera)).toBe(false);
    });

    it("reuses prepared camera state inside a frame scope", () => {
        checker = new VisibilityChecker();
        const camera = createCamera();
        const first = createMesh();
        const second = createMesh();
        const updateWorldMatrix = vi.spyOn(camera, "updateWorldMatrix");

        camera.matrixWorldNeedsUpdate = true;
        checker.beginFrame(camera);
        checker.isVisible(first, camera);
        checker.isVisible(second, camera);
        checker.endFrame();

        expect(updateWorldMatrix).toHaveBeenCalledTimes(1);
    });

    it("reuses clean shared-ancestor validation across visibility checks", () => {
        checker = new VisibilityChecker();
        const camera = createCamera();
        const root = new Object3D();
        let sharedParent = root;
        for (let i = 0; i < 500; i++) {
            const child = new Object3D();
            sharedParent.add(child);
            sharedParent = child;
        }
        const meshes = Array.from({length: 100}, () => {
            const mesh = createMesh();
            sharedParent.add(mesh);
            return mesh;
        });
        root.updateMatrixWorld(true);

        let rootStateReads = 0;
        let rootNeedsUpdate = root.matrixWorldNeedsUpdate;
        Object.defineProperty(root, "matrixWorldNeedsUpdate", {
            configurable: true,
            get: () => {
                rootStateReads++;
                return rootNeedsUpdate;
            },
            set: value => {
                rootNeedsUpdate = value;
            },
        });

        checker.beginFrame(camera);
        for (const mesh of meshes) {
            checker.isVisible(mesh, camera);
        }
        checker.endFrame();

        expect(rootStateReads).toBe(1);
    });

    it("invalidates cached ancestry after a parent moves within the frame", () => {
        checker = new VisibilityChecker();
        const camera = createCamera();
        const parent = new Object3D();
        const first = createMesh();
        const second = createMesh();
        parent.add(first, second);
        parent.updateMatrixWorld(true);

        checker.beginFrame(camera);
        expect(checker.isVisible(first, camera)).toBe(true);

        parent.position.x = 1_000;
        parent.updateMatrix();

        expect(checker.isVisible(second, camera)).toBe(false);
        expect(second.matrixWorld.elements[12]).toBeCloseTo(1_000);
        checker.endFrame();
    });

    it("computes prepared camera version once at frame start", () => {
        checker = new VisibilityChecker();
        const camera = createCamera();
        const mesh = createMesh();
        const updateCameraVersion = vi.spyOn(
            checker as unknown as { updateCameraVersion(camera: PerspectiveCamera): number },
            "updateCameraVersion",
        );

        checker.beginFrame(camera);
        expect(updateCameraVersion).toHaveBeenCalledTimes(1);

        checker.isVisible(mesh, camera);
        expect(updateCameraVersion).toHaveBeenCalledTimes(1);

        checker.endFrame();
    });

    it("reuses object matrix hashes while matrix elements are stable", () => {
        checker = new VisibilityChecker();
        const camera = createCamera();
        const mesh = createMesh();

        checker.beginFrame(camera);
        expect(checker.isVisible(createMesh(), camera)).toBe(true);
        const hashMatrix = vi.spyOn(
            checker as unknown as { hashMatrix(matrix: Matrix4, seed?: number): number },
            "hashMatrix",
        );

        expect(checker.isVisible(mesh, camera)).toBe(true);
        expect(checker.isVisible(mesh, camera)).toBe(true);
        checker.endFrame();

        expect(hashMatrix).toHaveBeenCalledTimes(1);

        const stats = checker.getCacheStats();
        expect(stats.hits).toBe(1);
        expect(stats.misses).toBe(2);
    });

    it("reuses camera matrix hashes while camera matrices are stable", () => {
        checker = new VisibilityChecker();
        const camera = createCamera();
        const mesh = createMesh();

        checker.beginFrame(camera);
        expect(checker.isVisible(mesh, camera)).toBe(true);
        const hashMatrix = vi.spyOn(
            checker as unknown as { hashMatrix(matrix: Matrix4, seed?: number): number },
            "hashMatrix",
        );

        checker.beginFrame(camera);
        expect(checker.isVisible(mesh, camera)).toBe(true);
        checker.endFrame();

        expect(hashMatrix).not.toHaveBeenCalled();
    });

    it("rehashes camera matrices when the camera moves", () => {
        checker = new VisibilityChecker();
        const camera = createCamera();
        const mesh = createMesh();

        checker.beginFrame(camera);
        expect(checker.isVisible(mesh, camera)).toBe(true);
        const hashMatrix = vi.spyOn(
            checker as unknown as { hashMatrix(matrix: Matrix4, seed?: number): number },
            "hashMatrix",
        );

        camera.position.set(10, 0, 10);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld(true);

        checker.beginFrame(camera);
        expect(checker.isVisible(mesh, camera)).toBe(true);
        checker.endFrame();

        expect(hashMatrix).toHaveBeenCalledTimes(2);
    });

    it("rehashes object matrices when matrix elements change", () => {
        checker = new VisibilityChecker();
        const camera = createCamera();
        const mesh = createMesh();

        checker.beginFrame(camera);
        expect(checker.isVisible(mesh, camera)).toBe(true);

        const hashMatrix = vi.spyOn(
            checker as unknown as { hashMatrix(matrix: Matrix4, seed?: number): number },
            "hashMatrix",
        );

        mesh.position.set(100, 0, 0);
        mesh.updateMatrixWorld(true);

        expect(checker.isVisible(mesh, camera)).toBe(false);
        checker.endFrame();

        expect(hashMatrix).toHaveBeenCalledTimes(1);
    });

    it("treats objects without geometry as visible without cache or matrix hashing", () => {
        checker = new VisibilityChecker();
        const camera = createCamera();
        const group = new Object3D();
        const cameraUpdateWorldMatrix = vi.spyOn(camera, "updateWorldMatrix");
        const groupUpdateWorldMatrix = vi.spyOn(group, "updateWorldMatrix");

        expect(checker.isVisible(group, camera)).toBe(true);

        const stats = checker.getCacheStats();
        expect(stats.hits).toBe(0);
        expect(stats.misses).toBe(0);
        expect(stats.size).toBe(0);
        expect(cameraUpdateWorldMatrix).not.toHaveBeenCalled();
        expect(groupUpdateWorldMatrix).not.toHaveBeenCalled();
    });

    it("purges stale LRU entries during cleanup", async () => {
        const originalDefaultTTL = CACHE_CONFIG.visibility.defaultTTL;
        CACHE_CONFIG.visibility.defaultTTL = 1;
        try {
            checker = new VisibilityChecker();
            const camera = createCamera();
            const mesh = createMesh();

            expect(checker.isVisible(mesh, camera)).toBe(true);
            expect(checker.getCacheStats().size).toBe(1);

            await new Promise(resolve => setTimeout(resolve, 5));
            (checker as unknown as {performCleanup(): void}).performCleanup();

            const stats = checker.getCacheStats();
            expect(stats.size).toBe(0);
            expect(stats.cleanups).toBe(1);
            expect(stats.itemsRemoved).toBe(1);
        } finally {
            CACHE_CONFIG.visibility.defaultTTL = originalDefaultTTL;
        }
    });

    it("creates the idle cleanup queue only when deferred cleanup is scheduled", () => {
        const originalProactiveCleanup = CACHE_CONFIG.visibility.enableProactiveCleanup;
        CACHE_CONFIG.visibility.enableProactiveCleanup = false;

        try {
            checker = new VisibilityChecker();

            expect((checker as unknown as {idleQueue: unknown}).idleQueue).toBeNull();

            (checker as unknown as {performPeriodicCleanup(now: number): void}).performPeriodicCleanup(5001);

            expect((checker as unknown as {idleQueue: unknown}).idleQueue).not.toBeNull();
        } finally {
            CACHE_CONFIG.visibility.enableProactiveCleanup = originalProactiveCleanup;
        }
    });
});
