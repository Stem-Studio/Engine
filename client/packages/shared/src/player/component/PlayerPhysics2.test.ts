import {Object3D, Quaternion, Scene, Vector3} from "three";
import {afterEach, beforeAll, describe, expect, it, vi} from "vitest";

import {type IDispatcher, type IPhysics, PhysicsEngineType} from "../../physics/common/types";
import {PhysicsEngineFactory} from "../../physics/PhysicsEngineFactory";
import {
    isFrameRuntimeTraceEnabled,
    recordFrameRuntimeTrace,
} from "@stem/editor-oss/scheduler/debug/frameRuntimeTrace";

const {
    physicsWrapperClientMock,
    physicsWrapperConstructorMock,
    physicsWrapperInstancesMock,
    physicsWrapperStartMock,
    shouldUsePhysicsWorkerMock,
} = vi.hoisted(() => ({
    physicsWrapperClientMock: {kind: "simple-multiplayer-client"},
    physicsWrapperConstructorMock: vi.fn(),
    physicsWrapperInstancesMock: [] as unknown[],
    physicsWrapperStartMock: vi.fn(() => Promise.resolve()),
    shouldUsePhysicsWorkerMock: vi.fn(() => false),
}));

vi.mock("./PlayerComponent", () => ({
    default: class PlayerComponent {
        app: unknown;

        constructor(app: unknown) {
            this.app = app;
        }
    },
}));

vi.mock("./PlayerLoadMask", () => ({
    default: class PlayerLoadMask {
        show() {}
        hide() {}
    },
}));

vi.mock("../../global", () => ({
    default: {app: null},
}));

vi.mock("../../physics/common/processInBatches", () => ({
    processInBatches: vi.fn(),
}));

vi.mock("../../physics/PhysicsEngineFactory", () => ({
    PhysicsEngineFactory: {
        createLegacyPhysicsAdapter: vi.fn(),
    },
}));

// Force the main-thread (non-worker) physics path so the gravity assertion
// runs through `createLegacyPhysicsAdapter`. The default in jsdom would pick
// the worker path because `Worker` is defined.
vi.mock("../../physics/preloadPhysics", () => ({
    shouldUsePhysicsWorker: shouldUsePhysicsWorkerMock,
    preloadPhysics: vi.fn(),
}));

vi.mock("../../physics/PhysicsRuntimeUtil", () => ({
    PhysicsRuntimeUtil: {
        getPhysicsConfig(object: Object3D) {
            return object.userData.physics;
        },
        isPhysicsEnabled(object: Object3D) {
            return !!object.userData.physics?.enabled;
        },
        calculatePhysicsPositionFromObject(object: Object3D, position: Vector3, quaternion: Quaternion, scale: Vector3) {
            object.updateWorldMatrix(true, false);
            object.matrixWorld.decompose(position, quaternion, scale);
        },
        updateObjectTransformFromPhysics(object: Object3D, position: {x: number; y: number; z: number}, rotation: {x: number; y: number; z: number; w: number}, scale: {x: number; y: number; z: number}) {
            object.position.set(position.x, position.y, position.z);
            object.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
            object.scale.set(scale.x, scale.y, scale.z);
        },
    },
}));

vi.mock("../../physics/simple/PhysicsWrapper", () => ({
    PhysicsWrapper: class PhysicsWrapper {
        mpClient = physicsWrapperClientMock;

        constructor(...args: unknown[]) {
            physicsWrapperConstructorMock(...args);
            physicsWrapperInstancesMock.push(this);
        }

        start() {
            return physicsWrapperStartMock();
        }
    },
}));

vi.mock("../../physics/worker/GeometryComputePool", () => ({
    setGeometryWorkerPoolSize: vi.fn(),
}));

vi.mock("@stem/editor-oss/scheduler/debug/frameRuntimeTrace", () => ({
    isFrameRuntimeTraceEnabled: vi.fn(() => false),
    recordFrameRuntimeTrace: vi.fn(),
}));

vi.mock("../../userManagement/playerProfile/discordEnvironment", () => ({
    isInDiscordEnvironment: () => false,
}));

vi.mock("../../utils/DetectDevice", () => ({
    DetectDevice: {
        isMobile: () => false,
        getOS: () => "macOS",
    },
}));

vi.mock("../../utils/ObjectUtils", () => ({
    cloneObject: vi.fn(),
    getObjectTemplateFromScene: vi.fn(),
    setObjectTemplate: vi.fn(),
}));

let PlayerPhysics2: typeof import("./PlayerPhysics2").default;

function createSubject() {
    const object = new Object3D();
    type SubjectType = {
        updates: Map<string, unknown>;
        physics: { getDynamicBodyObject(uuid: string): Object3D | undefined };
        positionAuxA: Vector3;
        scaleAuxA: Vector3;
        quaternionAuxA: Quaternion;
        quaternionAuxB: Quaternion;
        getPendingUpdateCount(): number;
        pushUpdateData(...args: unknown[]): void;
        updateObjects(interpolateDynamicObjects: boolean, frameNow: number): { appliedCount: number };
    };
    const subject = Object.create(PlayerPhysics2.prototype) as unknown as SubjectType;

    subject.updates = new Map();
    subject.physics = {
        getDynamicBodyObject(uuid: string) {
            return uuid === object.uuid ? object : undefined;
        },
    };
    subject.positionAuxA = new Vector3();
    subject.scaleAuxA = new Vector3();
    subject.quaternionAuxA = new Quaternion();
    subject.quaternionAuxB = new Quaternion();

    return {subject, object};
}

describe("PlayerPhysics2 interpolation buffer", () => {
    beforeAll(async () => {
        ({default: PlayerPhysics2} = await import("./PlayerPhysics2"));
    });

    afterEach(() => {
        delete (globalThis as {__TRACE_FRAME_RUNTIME__?: unknown}).__TRACE_FRAME_RUNTIME__;
        vi.clearAllMocks();
        vi.restoreAllMocks();
        physicsWrapperInstancesMock.length = 0;
        shouldUsePhysicsWorkerMock.mockReturnValue(false);
    });

    it("uses the shared worker selection truth for Windows/main-thread mode", () => {
        shouldUsePhysicsWorkerMock.mockReturnValue(false);
        const subject = new PlayerPhysics2({} as never) as unknown as {useWorker: boolean};

        expect(subject.useWorker).toBe(false);
        expect(shouldUsePhysicsWorkerMock).toHaveBeenCalledOnce();
    });

    it("uses the shared worker selection truth for worker mode", () => {
        shouldUsePhysicsWorkerMock.mockReturnValue(true);
        const subject = new PlayerPhysics2({} as never) as unknown as {useWorker: boolean};

        expect(subject.useWorker).toBe(true);
        expect(shouldUsePhysicsWorkerMock).toHaveBeenCalledOnce();
    });

    it("retains the last applied sample so the next update can keep interpolating", () => {
        const {subject, object} = createSubject();
        let now = 0;

        vi.spyOn(performance, "now").mockImplementation(() => now);

        subject.pushUpdateData(object.uuid, {x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0, w: 1}, {x: 1, y: 1, z: 1}, 0.1, undefined);

        now = 100;
        subject.pushUpdateData(object.uuid, {x: 10, y: 0, z: 0}, {x: 0, y: 0, z: 0, w: 1}, {x: 1, y: 1, z: 1}, 0.1, undefined);

        now = 150;
        subject.updateObjects(true, now);
        expect(object.position.x).toBeCloseTo(5, 5);
        expect(subject.getPendingUpdateCount()).toBe(1);

        now = 220;
        subject.updateObjects(true, now);
        expect(object.position.x).toBeCloseTo(10, 5);
        expect(subject.getPendingUpdateCount()).toBe(1);

        now = 320;
        subject.pushUpdateData(object.uuid, {x: 20, y: 0, z: 0}, {x: 0, y: 0, z: 0, w: 1}, {x: 1, y: 1, z: 1}, 0.1, undefined);

        now = 370;
        subject.updateObjects(true, now);
        expect(object.position.x).toBeCloseTo(15, 5);
        expect(subject.getPendingUpdateCount()).toBe(1);
    });

    it("uses the physics step dt instead of the arrival gap to compute interpolation progress", () => {
        const {subject, object} = createSubject();
        let now = 0;

        vi.spyOn(performance, "now").mockImplementation(() => now);

        subject.pushUpdateData(object.uuid, {x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0, w: 1}, {x: 1, y: 1, z: 1}, 0.1, undefined);

        now = 10;
        subject.pushUpdateData(object.uuid, {x: 10, y: 0, z: 0}, {x: 0, y: 0, z: 0, w: 1}, {x: 1, y: 1, z: 1}, 0.1, undefined);

        now = 60;
        subject.updateObjects(true, now);

        expect(object.position.x).toBeCloseTo(5, 5);
    });

    it("retains interpolation updates in place and prunes stale bodies", () => {
        const {subject, object} = createSubject();
        let now = 0;

        vi.spyOn(performance, "now").mockImplementation(() => now);

        subject.pushUpdateData(object.uuid, {x: 2, y: 0, z: 0}, {x: 0, y: 0, z: 0, w: 1}, {x: 1, y: 1, z: 1}, 0.1, undefined);
        subject.updates.set("missing-body", {
            previous: null,
            current: {
                receivedAtPerf: 0,
                uuid: "missing-body",
                position: {x: 100, y: 0, z: 0},
                rotation: {x: 0, y: 0, z: 0, w: 1},
                scale: {x: 1, y: 1, z: 1},
                stepDurationMs: 100,
            },
            blendSource: null,
        });

        const updateMap = subject.updates;
        now = 50;

        const summary = subject.updateObjects(true, now) as {
            appliedCount: number;
            pendingAfterApply: number;
        };

        expect(subject.updates).toBe(updateMap);
        expect(subject.updates.has(object.uuid)).toBe(true);
        expect(subject.updates.has("missing-body")).toBe(false);
        expect(summary.appliedCount).toBe(1);
        expect(summary.pendingAfterApply).toBe(1);
    });

    it("uses the update summary pending count for trace snapshots without rescanning updates", () => {
        type SubjectType = {
            updates: Map<string, unknown>;
            pendingUpdateCount: number;
            physics: {getKinematicBodyObjects(): Map<string, Object3D>};
            traceBodyUpdatesSinceLastApply: number;
            traceLastBodyUpdatePerfTime: number | null;
            traceLastAppliedPerfTime: number | null;
            traceStepCounter: number;
            traceSnapshot: unknown;
            updateTraceSnapshot(
                stepNow: number,
                deltaTime: number,
                pendingBeforeApply: number,
                applySummary: {
                    appliedCount: number;
                    interpolatedCount: number;
                    oldestPendingAgeMs: number | null;
                    newestPendingAgeMs: number | null;
                    maxInterpolationProgress: number | null;
                    pendingAfterApply: number;
                },
            ): void;
        };
        const subject = Object.create(PlayerPhysics2.prototype) as unknown as SubjectType;
        const updates = new Map<string, unknown>();
        updates.forEach = vi.fn(() => {
            throw new Error("trace should not rescan pending updates");
        }) as never;

        subject.updates = updates;
        subject.pendingUpdateCount = 3;
        subject.physics = {getKinematicBodyObjects: () => new Map()};
        subject.traceBodyUpdatesSinceLastApply = 0;
        subject.traceLastBodyUpdatePerfTime = null;
        subject.traceLastAppliedPerfTime = null;
        subject.traceStepCounter = 0;
        const traceSnapshot = {};
        subject.traceSnapshot = traceSnapshot;

        subject.updateTraceSnapshot(100, 0.016, 4, {
            appliedCount: 3,
            interpolatedCount: 2,
            oldestPendingAgeMs: 20,
            newestPendingAgeMs: 5,
            maxInterpolationProgress: 0.75,
            pendingAfterApply: 3,
        });

        expect(subject.traceSnapshot).toBe(traceSnapshot);
        expect((subject.traceSnapshot as {pendingUpdates: number}).pendingUpdates).toBe(3);
        expect(updates.forEach).not.toHaveBeenCalled();
        expect(isFrameRuntimeTraceEnabled).not.toHaveBeenCalled();
        expect(recordFrameRuntimeTrace).not.toHaveBeenCalled();
    });

    it("records physics frame trace only when frame runtime tracing is enabled", () => {
        type SubjectType = {
            pendingUpdateCount: number;
            physics: {getKinematicBodyObjects(): Map<string, Object3D>};
            traceBodyUpdatesSinceLastApply: number;
            traceLastBodyUpdatePerfTime: number | null;
            traceLastAppliedPerfTime: number | null;
            traceStepCounter: number;
            traceSnapshot: Record<string, unknown>;
            updateTraceSnapshot(
                stepNow: number,
                deltaTime: number,
                pendingBeforeApply: number,
                applySummary: {
                    appliedCount: number;
                    interpolatedCount: number;
                    oldestPendingAgeMs: number | null;
                    newestPendingAgeMs: number | null;
                    maxInterpolationProgress: number | null;
                    pendingAfterApply: number;
                },
            ): void;
        };
        const subject = Object.create(PlayerPhysics2.prototype) as unknown as SubjectType;

        subject.pendingUpdateCount = 0;
        subject.physics = {getKinematicBodyObjects: () => new Map([["body", new Object3D()]])};
        subject.traceBodyUpdatesSinceLastApply = 2;
        subject.traceLastBodyUpdatePerfTime = 90;
        subject.traceLastAppliedPerfTime = 80;
        subject.traceStepCounter = 0;
        subject.traceSnapshot = {};
        (globalThis as {__TRACE_FRAME_RUNTIME__?: unknown}).__TRACE_FRAME_RUNTIME__ = true;
        vi.mocked(isFrameRuntimeTraceEnabled).mockReturnValueOnce(true);

        subject.updateTraceSnapshot(100, 0.016, 4, {
            appliedCount: 3,
            interpolatedCount: 2,
            oldestPendingAgeMs: 20,
            newestPendingAgeMs: 5,
            maxInterpolationProgress: 0.75,
            pendingAfterApply: 3,
        });

        expect(isFrameRuntimeTraceEnabled).toHaveBeenCalledWith("physics-step");
        expect(recordFrameRuntimeTrace).toHaveBeenCalledWith(expect.objectContaining({
            kind: "physics-step",
            deltaTimeMs: 16,
            pendingBeforeApply: 4,
            pendingAfterApply: 3,
            bodyUpdatesSinceLastApply: 2,
            lastBodyUpdateAgeMs: 10,
            lastAppliedAgeMs: 20,
            kinematicBodyCount: 1,
        }));
        expect(subject.traceBodyUpdatesSinceLastApply).toBe(0);
    });

    it("tracks pending update count without scanning the update map", () => {
        const {subject, object} = createSubject();
        const updates = subject.updates;
        updates.forEach = vi.fn(() => {
            throw new Error("pending update count should be maintained incrementally");
        }) as never;

        subject.pushUpdateData(object.uuid, {x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0, w: 1}, {x: 1, y: 1, z: 1}, 0.1, undefined);
        subject.pushUpdateData(object.uuid, {x: 1, y: 0, z: 0}, {x: 0, y: 0, z: 0, w: 1}, {x: 1, y: 1, z: 1}, 0.1, undefined);

        expect(subject.getPendingUpdateCount()).toBe(1);
        expect(updates.forEach).not.toHaveBeenCalled();

        subject.updateObjects(false, 100);

        expect(subject.getPendingUpdateCount()).toBe(0);
        expect(updates.forEach).not.toHaveBeenCalled();
    });

    it("passes scene gravity into main-thread physics initialization", async () => {
        const physics = {
            start: vi.fn().mockResolvedValue(undefined),
        };
        vi.mocked(PhysicsEngineFactory.createLegacyPhysicsAdapter).mockResolvedValue(physics as never);

        type SubjectType2 = {
            isMultiplayer: boolean;
            useWorker: boolean;
            qualitySolverIterations: number;
            mask: {hide: () => void};
            initPhysics(sceneId: string, scene: unknown, dispatcher: unknown): Promise<unknown>;
        };
        const subject = Object.create(PlayerPhysics2.prototype) as unknown as SubjectType2;

        subject.isMultiplayer = false;
        subject.useWorker = false;
        subject.qualitySolverIterations = 6;
        subject.mask = {hide: vi.fn()};

        const dispatcher = {
            onReady: vi.fn(),
            onBodyUpdate: vi.fn(),
            onCollision: vi.fn(),
        };
        const scene = {
            userData: {
                physics: {
                    engine: PhysicsEngineType.Rapier,
                    gravity: -24,
                },
            },
        } as never;

        const result = await subject.initPhysics("scene-id", scene, dispatcher);

        expect(result).toBe(physics);
        expect(PhysicsEngineFactory.createLegacyPhysicsAdapter).toHaveBeenCalledWith(
            PhysicsEngineType.Rapier,
            dispatcher,
            {gravity: -24, solverIterations: 6},
        );
        expect(physics.start).toHaveBeenCalledOnce();
    });

    it("terminates a physics adapter when startup rejects before ownership is assigned", async () => {
        const startError = new Error("start failed");
        const physics = {
            start: vi.fn().mockRejectedValue(startError),
            terminate: vi.fn(),
        };
        vi.mocked(PhysicsEngineFactory.createLegacyPhysicsAdapter).mockResolvedValue(physics as never);

        const subject = Object.create(PlayerPhysics2.prototype) as {
            useWorker: boolean;
            mask: {hide: ReturnType<typeof vi.fn>};
            initPhysics(sceneId: string, scene: Scene, dispatcher: IDispatcher): Promise<IPhysics>;
        };
        subject.useWorker = false;
        subject.mask = {hide: vi.fn()};

        await expect(subject.initPhysics("scene-id", new Scene(), {
            onReady: vi.fn(),
            onBodyUpdate: vi.fn(),
            onCollision: vi.fn(),
        })).rejects.toBe(startError);

        expect(physics.terminate).toHaveBeenCalledOnce();
        expect(subject.mask.hide).toHaveBeenCalledOnce();
    });

    it("skips the startup physics ping when no rigid bodies were added", async () => {
        const physics = {
            ping: vi.fn().mockResolvedValue(undefined),
        };
        const mask = {
            show: vi.fn(),
            hide: vi.fn(),
        };
        const subject = Object.create(PlayerPhysics2.prototype) as {
            isMultiplayer: boolean;
            mask: typeof mask;
            scene: Object3D;
            initPhysics: ReturnType<typeof vi.fn>;
            addObjects: ReturnType<typeof vi.fn>;
            initPhysicsAndAddObjects(sceneId: string, scene: Object3D): Promise<typeof physics>;
        };
        subject.isMultiplayer = false;
        subject.mask = mask;
        subject.scene = new Object3D();
        subject.initPhysics = vi.fn().mockResolvedValue(physics);
        subject.addObjects = vi.fn().mockResolvedValue(0);

        const result = await subject.initPhysicsAndAddObjects("scene-id", subject.scene);

        expect(result).toBe(physics);
        expect(physics.ping).not.toHaveBeenCalled();
        expect(mask.hide).toHaveBeenCalledOnce();
    });

    it("keeps the startup physics ping when rigid bodies were added", async () => {
        const physics = {
            ping: vi.fn().mockResolvedValue(undefined),
        };
        const mask = {
            show: vi.fn(),
            hide: vi.fn(),
        };
        const subject = Object.create(PlayerPhysics2.prototype) as {
            isMultiplayer: boolean;
            mask: typeof mask;
            scene: Object3D;
            initPhysics: ReturnType<typeof vi.fn>;
            addObjects: ReturnType<typeof vi.fn>;
            initPhysicsAndAddObjects(sceneId: string, scene: Object3D): Promise<typeof physics>;
        };
        subject.isMultiplayer = false;
        subject.mask = mask;
        subject.scene = new Object3D();
        subject.initPhysics = vi.fn().mockResolvedValue(physics);
        subject.addObjects = vi.fn().mockResolvedValue(2);

        const result = await subject.initPhysicsAndAddObjects("scene-id", subject.scene);

        expect(result).toBe(physics);
        expect(physics.ping).toHaveBeenCalledOnce();
        expect(mask.hide).toHaveBeenCalledOnce();
    });

    it("starts the local multiplayer wrapper even when no rigid bodies were added", async () => {
        const physics = {
            ping: vi.fn().mockResolvedValue(undefined),
        };
        const mask = {
            show: vi.fn(),
            hide: vi.fn(),
        };
        const scene = new Object3D();
        const subject = Object.create(PlayerPhysics2.prototype) as {
            app: {userId: string};
            isMultiplayer: boolean;
            mask: typeof mask;
            maxMultiplayerClientsPerRoom: number;
            multiplayerState: unknown;
            physics: unknown;
            scene: Object3D;
            initPhysics: ReturnType<typeof vi.fn>;
            addObjects: ReturnType<typeof vi.fn>;
            initPhysicsAndAddObjects(sceneId: string, scene: Object3D): Promise<unknown>;
        };
        subject.app = {userId: "local-user"};
        subject.isMultiplayer = true;
        subject.mask = mask;
        subject.maxMultiplayerClientsPerRoom = 8;
        subject.scene = scene;
        subject.initPhysics = vi.fn().mockResolvedValue(physics);
        subject.addObjects = vi.fn().mockResolvedValue(0);

        const result = await subject.initPhysicsAndAddObjects("scene-id", scene);
        const wrapper = physicsWrapperInstancesMock.at(-1);

        expect(physics.ping).toHaveBeenCalledOnce();
        expect(physicsWrapperConstructorMock).toHaveBeenCalledWith(
            physics,
            "local-user",
            "scene-id",
            scene,
            8,
            expect.objectContaining({
                onReady: expect.any(Function),
                onBodyUpdate: expect.any(Function),
                onCollision: expect.any(Function),
            }),
        );
        expect(physicsWrapperStartMock).toHaveBeenCalledOnce();
        expect(result).toBe(wrapper);
        expect(subject.physics).toBe(wrapper);
        expect(subject.multiplayerState).toBe(physicsWrapperClientMock);
        expect(mask.hide).toHaveBeenCalledOnce();
    });

    it("orders child physics updates after parent updates only when needed", async () => {
        const parent = new Object3D();
        const child = new Object3D();
        parent.add(child);

        type SubjectType = {
            updates: Map<string, unknown>;
            physics: { getDynamicBodyObject(uuid: string): Object3D | undefined };
            computeUpdateOrder(updateUuids: Iterable<string>): string[];
        };
        const subject = Object.create(PlayerPhysics2.prototype) as unknown as SubjectType;
        subject.updates = new Map([
            [child.uuid, {}],
            [parent.uuid, {}],
        ]);
        subject.physics = {
            getDynamicBodyObject(uuid: string) {
                if (uuid === parent.uuid) return parent;
                if (uuid === child.uuid) return child;
                return undefined;
            },
        };

        expect(subject.computeUpdateOrder(subject.updates.keys())).toEqual([parent.uuid, child.uuid]);
    });

    it("keeps original physics update order without dependency-map writes for unrelated bodies", async () => {
        const first = new Object3D();
        const second = new Object3D();
        const dependencies = new Map<string, string | null>();
        const setDependency = vi.spyOn(dependencies, "set");

        type SubjectType = {
            updates: Map<string, unknown>;
            updateDependenciesScratch: Map<string, string | null>;
            physics: { getDynamicBodyObject(uuid: string): Object3D | undefined };
            computeUpdateOrder(updateUuids: Iterable<string>): string[];
        };
        const subject = Object.create(PlayerPhysics2.prototype) as unknown as SubjectType;
        subject.updates = new Map([
            [first.uuid, {}],
            [second.uuid, {}],
        ]);
        subject.updateDependenciesScratch = dependencies;
        subject.physics = {
            getDynamicBodyObject(uuid: string) {
                if (uuid === first.uuid) return first;
                if (uuid === second.uuid) return second;
                return undefined;
            },
        };

        expect(subject.computeUpdateOrder(subject.updates.keys())).toEqual([first.uuid, second.uuid]);
        expect(setDependency).not.toHaveBeenCalled();
    });

    it("collects enabled rigid bodies ordered nearest to camera", async () => {
        const scene = new Object3D();
        const near = new Object3D();
        const far = new Object3D();
        const disabled = new Object3D();
        const nonRigid = new Object3D();

        near.position.set(1, 0, 0);
        far.position.set(10, 0, 0);
        disabled.position.set(0.5, 0, 0);
        nonRigid.position.set(0.25, 0, 0);
        near.userData.physics = {enabled: true, type: "rigidBody"};
        far.userData.physics = {enabled: true, type: "rigidBody"};
        disabled.userData.physics = {enabled: false, type: "rigidBody"};
        nonRigid.userData.physics = {enabled: true, type: "trigger"};
        scene.add(far, disabled, near, nonRigid);
        scene.updateMatrixWorld(true);

        type SubjectType = {
            scene: Object3D;
            app: {camera: {position: Vector3}};
            collectPhysicsObjects(): Object3D[];
        };
        const subject = Object.create(PlayerPhysics2.prototype) as unknown as SubjectType;
        subject.scene = scene;
        subject.app = {camera: {position: new Vector3(0, 0, 0)}};

        expect(subject.collectPhysicsObjects()).toEqual([near, far]);
    });

    it("yields while collecting physics bodies from large scenes", async () => {
        const scene = new Object3D();
        const bodyCount = 513;
        for (let i = 0; i < bodyCount; i++) {
            const body = new Object3D();
            body.position.set(i + 1, 0, 0);
            body.userData.physics = {enabled: true, type: "rigidBody"};
            scene.add(body);
        }
        scene.updateMatrixWorld(true);
        const writableGlobal = globalThis as typeof globalThis & {requestAnimationFrame?: typeof requestAnimationFrame};
        const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
        const requestAnimationFrameSpy = vi.fn((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        }) as unknown as typeof requestAnimationFrame;
        writableGlobal.requestAnimationFrame = requestAnimationFrameSpy;

        type SubjectType = {
            scene: Object3D;
            app: {camera: {position: Vector3}};
            collectPhysicsObjectsProgressively(): Promise<Object3D[]>;
        };
        const subject = Object.create(PlayerPhysics2.prototype) as unknown as SubjectType;
        subject.scene = scene;
        subject.app = {camera: {position: new Vector3(0, 0, 0)}};

        try {
            const result = await subject.collectPhysicsObjectsProgressively();

            expect(result).toHaveLength(bodyCount);
            expect(requestAnimationFrameSpy).toHaveBeenCalled();
        } finally {
            if (originalRequestAnimationFrame) {
                writableGlobal.requestAnimationFrame = originalRequestAnimationFrame;
            } else {
                Reflect.deleteProperty(writableGlobal, "requestAnimationFrame");
            }
        }
    });

    it("reuses physics collection distance entries across repeated scans", async () => {
        const scene = new Object3D();
        const near = new Object3D();
        const far = new Object3D();

        near.position.set(1, 0, 0);
        far.position.set(10, 0, 0);
        near.userData.physics = {enabled: true, type: "rigidBody"};
        far.userData.physics = {enabled: true, type: "rigidBody"};
        scene.add(far, near);
        scene.updateMatrixWorld(true);

        type SubjectType = {
            scene: Object3D;
            app: {camera: {position: Vector3}};
            physicsObjectDistanceScratch?: Array<{object: Object3D; distanceSq: number}>;
            physicsObjectsScratch?: Object3D[];
            collectPhysicsObjects(): Object3D[];
        };
        const subject = Object.create(PlayerPhysics2.prototype) as unknown as SubjectType;
        subject.scene = scene;
        subject.app = {camera: {position: new Vector3(0, 0, 0)}};

        const firstResult = subject.collectPhysicsObjects();
        expect(firstResult).toEqual([near, far]);
        const firstEntries = subject.physicsObjectDistanceScratch!.slice();

        far.position.set(0.5, 0, 0);
        scene.updateMatrixWorld(true);

        const secondResult = subject.collectPhysicsObjects();
        expect(secondResult).toBe(firstResult);
        expect(secondResult).toBe(subject.physicsObjectsScratch);
        expect(secondResult).toEqual([far, near]);
        expect(subject.physicsObjectDistanceScratch![0]).toBe(firstEntries[0]);
        expect(subject.physicsObjectDistanceScratch![1]).toBe(firstEntries[1]);
    });
});

describe("PlayerPhysics2 unified fixed-step ownership", () => {
    beforeAll(async () => {
        ({default: PlayerPhysics2} = await import("./PlayerPhysics2"));
    });

    it("does not run a second accumulator when EngineRuntime owns fixed steps", () => {
        const subject = Object.create(PlayerPhysics2.prototype) as any;
        subject.physics = {};
        subject.unifiedFixedStepEnabled = true;
        subject.beginSimulationFrame = vi.fn();
        subject.fixedUpdate = vi.fn();

        subject.update(0.1);

        expect(subject.beginSimulationFrame).toHaveBeenCalledOnce();
        expect(subject.fixedUpdate).not.toHaveBeenCalled();
    });

    it("keeps the legacy standalone accumulator safe", () => {
        const subject = Object.create(PlayerPhysics2.prototype) as any;
        subject.physics = {};
        subject.unifiedFixedStepEnabled = false;
        subject.qualityUpdateRateHz = 60;
        subject.qualityMaxStepsPerFrame = 3;
        subject.physicsAccumulator = 0;
        subject.beginSimulationFrame = vi.fn();
        subject.fixedUpdate = vi.fn();

        subject.update(1 / 30);

        expect(subject.beginSimulationFrame).toHaveBeenCalledOnce();
        expect(subject.fixedUpdate).toHaveBeenCalledTimes(2);
        expect(subject.fixedUpdate).toHaveBeenNthCalledWith(1, 1 / 60);
        expect(subject.fixedUpdate).toHaveBeenNthCalledWith(2, 1 / 60);
    });

    it("submits exactly one worker-compatible simulate request per fixed step", () => {
        const simulate = vi.fn();
        const subject = Object.create(PlayerPhysics2.prototype) as any;
        subject.physics = {
            getKinematicBodyObjects: () => new Map(),
            simulate,
        };
        subject.qualitySubsteps = 1;

        subject.fixedUpdate(1 / 60);

        expect(simulate).toHaveBeenCalledOnce();
        expect(simulate).toHaveBeenCalledWith(1 / 60);
    });

    it("commits completed worker transforms before fixed gameplay and kinematic sync", () => {
        const {subject, object} = createSubject();
        const executionOrder: string[] = [];
        const physics = subject.physics as typeof subject.physics & {
            getKinematicBodyObjects(): Map<string, Object3D>;
        };
        physics.getKinematicBodyObjects = () => {
            executionOrder.push("sync");
            return new Map();
        };
        const fixedStepSubject = subject as typeof subject & {
            completeAuthoritativeFixedStep(deltaTime: number): void;
            setFixedStepCompletionListener(listener: (deltaTime: number) => void): void;
        };
        fixedStepSubject.setFixedStepCompletionListener(deltaTime => {
            executionOrder.push("gameplay");
            expect(deltaTime).toBe(1 / 60);
            expect(object.position.x).toBe(12);
        });
        subject.pushUpdateData(
            object.uuid,
            {x: 12, y: 3, z: -4},
            {x: 0, y: 0, z: 0, w: 1},
            {x: 1, y: 1, z: 1},
            1 / 60,
            undefined,
        );

        fixedStepSubject.completeAuthoritativeFixedStep(1 / 60);

        expect(executionOrder).toEqual(["gameplay", "sync"]);
        expect(subject.getPendingUpdateCount()).toBe(0);
    });

    it("exposes a worker body pose to fixed collision and behavior before acknowledging the step", async () => {
        const {subject, object} = createSubject();
        const physics = subject.physics as typeof subject.physics & {
            getKinematicBodyObjects(): Map<string, Object3D>;
        };
        physics.getKinematicBodyObjects = () => new Map();
        const mask = {
            show: vi.fn(),
            hide: vi.fn(),
        };
        let dispatcher: any;
        const integrationSubject = subject as typeof subject & {
            isMultiplayer: boolean;
            mask: typeof mask;
            scene: Object3D;
            initPhysics: ReturnType<typeof vi.fn>;
            addObjects: ReturnType<typeof vi.fn>;
            initPhysicsAndAddObjects(sceneId: string, scene: Object3D): Promise<typeof physics>;
            setFixedStepCompletionListener(listener: (deltaTime: number) => void): void;
        };
        integrationSubject.isMultiplayer = false;
        integrationSubject.mask = mask;
        integrationSubject.scene = new Object3D();
        integrationSubject.initPhysics = vi.fn((_sceneId, _scene, nextDispatcher) => {
            dispatcher = nextDispatcher;
            return Promise.resolve(physics);
        });
        integrationSubject.addObjects = vi.fn().mockResolvedValue(0);
        await integrationSubject.initPhysicsAndAddObjects("scene-id", integrationSubject.scene);

        const collisionRead = vi.fn(() => object.position.x);
        const behaviorRead = vi.fn(() => object.position.x);
        integrationSubject.setFixedStepCompletionListener(() => {
            collisionRead();
            behaviorRead();
        });

        dispatcher.onBodyUpdate(
            object.uuid,
            {x: 21, y: 2, z: -7},
            {x: 0, y: 0, z: 0, w: 1},
            {x: 1, y: 1, z: 1},
            1 / 60,
            undefined,
        );
        dispatcher.onSimulationComplete(1 / 60);

        expect(collisionRead).toHaveReturnedWith(21);
        expect(behaviorRead).toHaveReturnedWith(21);
        expect(subject.getPendingUpdateCount()).toBe(0);

        // The presentation path keeps interpolation enabled for later worker
        // samples, while the committed authoritative sample cannot reapply.
        object.position.x = 99;
        expect(subject.updateObjects(true, performance.now()).appliedCount).toBe(0);
        expect(object.position.x).toBe(99);
    });

    it("bounds hostile quality values before they reach hot simulation loops", () => {
        const subject = new PlayerPhysics2({} as never) as any;

        subject.configureQuality(
            Number.MAX_VALUE,
            Number.MAX_SAFE_INTEGER,
            Number.MAX_SAFE_INTEGER,
            true,
        );

        expect(subject.qualityUpdateRateHz).toBe(240);
        expect(subject.qualitySubsteps).toBe(16);
        expect(subject.qualityMaxStepsPerFrame).toBe(16);
        expect(subject.unifiedFixedStepEnabled).toBe(true);
    });

    it("keeps backend solver quality aligned with the fixed-step policy", () => {
        const subject = new PlayerPhysics2({} as never) as any;
        const physics = {setSolverIterations: vi.fn()};
        subject.physics = physics;

        subject.configureQuality(60, 2, 4, true, true, 7);

        expect(subject.qualitySolverIterations).toBe(7);
        expect(physics.setSolverIterations).toHaveBeenCalledWith(7);
    });

    it("restores app physics callbacks and releases retained state on dispose", () => {
        const originalCallbacks = {
            addPhysicsObject: vi.fn(),
            removePhysicsObject: vi.fn(),
            addPhysicsObjectBody: vi.fn(),
            removePhysicsObjectBody: vi.fn(),
        };
        const app = {...originalCallbacks} as any;
        const subject = new PlayerPhysics2(app) as any;
        const physics = {terminate: vi.fn()};
        subject.physics = physics;
        subject.scene = new Object3D();
        subject.updates.set("body", {previous: null, current: null, blendSource: null});
        subject.updateDependenciesScratch.set("body", null);
        subject.updateVisitedScratch.add("body");
        subject.multiplayerState = {update: vi.fn()} as any;

        subject.dispose();

        expect(app.addPhysicsObject).toBe(originalCallbacks.addPhysicsObject);
        expect(app.removePhysicsObject).toBe(originalCallbacks.removePhysicsObject);
        expect(app.addPhysicsObjectBody).toBe(originalCallbacks.addPhysicsObjectBody);
        expect(app.removePhysicsObjectBody).toBe(originalCallbacks.removePhysicsObjectBody);
        expect(physics.terminate).toHaveBeenCalledOnce();
        expect(subject.physics).toBeNull();
        expect(subject.scene).toBeUndefined();
        expect(subject.updates.size).toBe(0);
        expect(subject.updateDependenciesScratch.size).toBe(0);
        expect(subject.updateVisitedScratch.size).toBe(0);
        expect(subject.multiplayerState).toBeNull();

        subject.dispose();
        expect(physics.terminate).toHaveBeenCalledOnce();
    });
});
