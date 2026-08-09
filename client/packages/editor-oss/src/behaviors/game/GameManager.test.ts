import {BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Quaternion, Scene, Vector3} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import GameManager from "./GameManager";
import BehaviorManager from "../BehaviorManager";
import {BehaviorBase} from "../Behavior";
import {GAME_STATE} from "../../types/editor";
import TagUtil from "../../utils/TagUtil";
import {breakpointManager} from "../../editor/assets/v2/BehaviorEditor/breakpoints";
import {RUNTIME_SCENE_REVEAL_PENDING_KEY} from "../../utils/runtimeSceneReveal";
import {CollisionBehavior} from "../../physics/common/types";

type TestGameManager = {
    initializeObject: GameManager["initializeObject"];
    engine: GameManager["engine"];
    addAllBehaviorsFromObject: (object: Object3D) => Promise<void>[];
    addAllBehaviorsFromObjectProgressive: (
        object: Object3D,
        yieldToFrame: () => Promise<void>,
    ) => Promise<void>;
    registerLambdaComponentsForObject: (object: Object3D) => void;
    pauseObject: (object: Object3D, pauseChildren?: boolean) => void;
};

function namedObject(name: string): Object3D {
    const object = new Object3D();
    object.name = name;
    return object;
}

function addDeepChain(root: Object3D, depth = 12_000): Object3D {
    let cursor = root;
    for (let i = 0; i < depth; i++) {
        const child = namedObject(`deep-${i}`);
        cursor.add(child);
        cursor = child;
    }
    return cursor;
}

function makeTriangleGeometry() {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
        "position",
        new Float32BufferAttribute([
            0, 0, 0,
            1, 0, 0,
            0, 1, 0,
        ], 3),
    );
    return geometry;
}

function createInitializeObjectHarness() {
    const calls: string[] = [];
    const addPhysicsObject = vi.fn(async (object: Object3D) => {
        calls.push(`physics:${object.name}`);
    });
    const game = Object.create(GameManager.prototype) as TestGameManager;

    game.engine = {
        physics: {
            addObject: addPhysicsObject,
        },
    } as unknown as GameManager["engine"];
    game.addAllBehaviorsFromObject = vi.fn((object: Object3D) => {
        calls.push(`behaviors:${object.name}`);
        return [Promise.resolve()];
    });
    game.addAllBehaviorsFromObjectProgressive = vi.fn(async (object: Object3D, yieldToFrame: () => Promise<void>) => {
        calls.push(`behaviors:${object.name}`);
        await yieldToFrame();
    });
    game.registerLambdaComponentsForObject = vi.fn((object: Object3D) => {
        calls.push(`lambdas:${object.name}`);
    });
    game.pauseObject = vi.fn();

    return {game, calls, addPhysicsObject};
}

async function withImmediateAnimationFrame<T>(callback: () => Promise<T>): Promise<T> {
    const writableGlobal = globalThis as typeof globalThis & {requestAnimationFrame?: typeof requestAnimationFrame};
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    writableGlobal.requestAnimationFrame = ((frameCallback: FrameRequestCallback) => {
        frameCallback(0);
        return 1;
    }) as typeof requestAnimationFrame;

    try {
        return await callback();
    } finally {
        if (originalRequestAnimationFrame) {
            globalThis.requestAnimationFrame = originalRequestAnimationFrame;
        } else {
            Reflect.deleteProperty(writableGlobal, "requestAnimationFrame");
        }
    }
}

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return {promise, resolve, reject};
}

describe("GameManager.initializeObject", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("initializes descendants breadth-first", async () => {
        const root = namedObject("root");
        const childA = namedObject("child-a");
        const childB = namedObject("child-b");
        const grandchild = namedObject("grandchild");
        root.userData.physics = {enabled: true};
        childB.userData.physics = {enabled: true};
        root.add(childA, childB);
        childA.add(grandchild);

        const {game, calls, addPhysicsObject} = createInitializeObjectHarness();

        await game.initializeObject(root);

        expect(calls).toEqual([
            "behaviors:root",
            "lambdas:root",
            "physics:root",
            "behaviors:child-a",
            "lambdas:child-a",
            "behaviors:child-b",
            "lambdas:child-b",
            "physics:child-b",
        ]);
        expect(addPhysicsObject).toHaveBeenCalledTimes(2);
    });

    it("yields while initializing large object hierarchies", async () => {
        const writableGlobal = globalThis as typeof globalThis & {requestAnimationFrame?: typeof requestAnimationFrame};
        const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
        const requestAnimationFrameSpy = vi.fn((frameCallback: FrameRequestCallback) => {
            frameCallback(0);
            return 1;
        });
        writableGlobal.requestAnimationFrame = requestAnimationFrameSpy as unknown as typeof requestAnimationFrame;

        try {
            const root = namedObject("root");
            for (let i = 0; i < 35; i++) {
                root.add(namedObject(`child-${i}`));
            }
            const {game} = createInitializeObjectHarness();

            await game.initializeObject(root);

            expect(requestAnimationFrameSpy).toHaveBeenCalled();
        } finally {
            if (originalRequestAnimationFrame) {
                globalThis.requestAnimationFrame = originalRequestAnimationFrame;
            } else {
                Reflect.deleteProperty(writableGlobal, "requestAnimationFrame");
            }
        }
    });

    it("initializes object behaviors through the progressive path", async () => {
        const root = namedObject("root");
        root.userData.behaviors = [
            {id: "runtime", uuid: "runtime-uuid", enabled: true, attributesData: {}},
        ];
        const {game} = createInitializeObjectHarness();

        await game.initializeObject(root);

        expect(game.addAllBehaviorsFromObjectProgressive).toHaveBeenCalledWith(
            root,
            expect.any(Function),
            expect.any(Function),
            expect.any(Function),
        );
        expect(game.addAllBehaviorsFromObject).not.toHaveBeenCalled();
    });

    it("skips the lifecycle loop for an inert runtime leaf", async () => {
        const leaf = namedObject("inert-leaf");
        const {game, calls, addPhysicsObject} = createInitializeObjectHarness();

        await game.initializeObject(leaf);

        expect(calls).toEqual([]);
        expect(addPhysicsObject).not.toHaveBeenCalled();
    });

    it("registers physics enabled by behavior startup", async () => {
        const root = namedObject("root");
        root.userData.behaviors = [
            {id: "physics-enabler", uuid: "physics-enabler-uuid", enabled: true, attributesData: {}},
        ];
        const addPhysicsObject = vi.fn(async () => {});
        const game = Object.create(GameManager.prototype) as any;
        game.engine = {physics: {addObject: addPhysicsObject}};
        game.addBehaviorToObject = vi.fn(async (target: Object3D) => {
            target.userData.physics = {enabled: true};
        });
        game.registerLambdaComponentsForObject = vi.fn();
        game.pauseObject = vi.fn();

        await game.initializeObject(root);

        expect(addPhysicsObject).toHaveBeenCalledWith(root);
    });

    it("coarsens automatic startup addObject behavior yields while preserving breadth-first initialization", async () => {
        const writableGlobal = globalThis as typeof globalThis & {requestAnimationFrame?: typeof requestAnimationFrame};
        const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
        const requestAnimationFrameSpy = vi.fn((frameCallback: FrameRequestCallback) => {
            frameCallback(0);
            return 1;
        });
        writableGlobal.requestAnimationFrame = requestAnimationFrameSpy as unknown as typeof requestAnimationFrame;
        const nowSpy = vi.spyOn(performance, "now").mockReturnValue(0);

        try {
            const root = namedObject("root");
            for (let i = 0; i < 40; i++) {
                const child = namedObject(`child-${i}`);
                child.userData.behaviors = [
                    {id: `behavior-${i}`, uuid: `behavior-${i}-uuid`, enabled: true, attributesData: {}},
                ];
                root.add(child);
            }
            root.userData.behaviors = [
                {id: "root-behavior", uuid: "root-behavior-uuid", enabled: true, attributesData: {}},
            ];

            const calls: string[] = [];
            const game = Object.create(GameManager.prototype) as any;
            game.engine = {physics: {addObject: vi.fn()}};
            game.addBehaviorToObject = vi.fn(async (target: Object3D) => {
                calls.push(`behaviors:${target.name}`);
            });
            game.registerLambdaComponentsForObject = vi.fn((target: Object3D) => {
                calls.push(`lambdas:${target.name}`);
            });
            game.pauseObject = vi.fn();

            await game.initializeObject(root);

            const expectedObjectOrder = [root, ...root.children].map(child => child.name);
            expect(calls).toEqual(expectedObjectOrder.flatMap(name => [
                `behaviors:${name}`,
                `lambdas:${name}`,
            ]));
            expect(game.addBehaviorToObject).toHaveBeenCalledTimes(41);
            expect(requestAnimationFrameSpy.mock.calls.length).toBeGreaterThan(0);
            expect(requestAnimationFrameSpy.mock.calls.length).toBeLessThan(10);
        } finally {
            nowSpy.mockRestore();
            if (originalRequestAnimationFrame) {
                globalThis.requestAnimationFrame = originalRequestAnimationFrame;
            } else {
                Reflect.deleteProperty(writableGlobal, "requestAnimationFrame");
            }
        }
    });

    it("charges behavior-bearing runtime objects once per initialization batch", async () => {
        const writableGlobal = globalThis as typeof globalThis & {requestAnimationFrame?: typeof requestAnimationFrame};
        const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
        const requestAnimationFrameSpy = vi.fn((frameCallback: FrameRequestCallback) => {
            frameCallback(0);
            return 1;
        });
        writableGlobal.requestAnimationFrame = requestAnimationFrameSpy as unknown as typeof requestAnimationFrame;
        const nowSpy = vi.spyOn(performance, "now").mockReturnValue(0);

        try {
            const root = namedObject("root");
            for (let i = 0; i < 40; i++) {
                const child = namedObject(`child-${i}`);
                child.userData.behaviors = [
                    {id: `behavior-${i}`, uuid: `behavior-${i}-uuid`, enabled: true, attributesData: {}},
                ];
                root.add(child);
            }

            const game = Object.create(GameManager.prototype) as any;
            game.engine = {physics: {addObject: vi.fn()}};
            game.addBehaviorToObject = vi.fn(async () => {});
            game.registerLambdaComponentsForObject = vi.fn();
            game.pauseObject = vi.fn();

            await game.initializeObject(root);

            // 41 enabled behaviors fit into one 32-unit batch plus a tail;
            // charging each object a second time would require two waits.
            expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);

            requestAnimationFrameSpy.mockClear();
            const behaviorlessRoot = namedObject("behaviorless-root");
            for (let i = 0; i < 40; i++) {
                behaviorlessRoot.add(namedObject(`behaviorless-child-${i}`));
            }
            const behaviorlessGame = Object.create(GameManager.prototype) as any;
            behaviorlessGame.engine = {physics: {addObject: vi.fn()}};
            behaviorlessGame.addBehaviorToObject = vi.fn(async () => {});
            behaviorlessGame.registerLambdaComponentsForObject = vi.fn();
            behaviorlessGame.pauseObject = vi.fn();

            await behaviorlessGame.initializeObject(behaviorlessRoot);

            // Behaviorless hierarchies still use one object work unit each and
            // therefore retain a paint wait at the 32-object batch boundary.
            expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
        } finally {
            nowSpy.mockRestore();
            if (originalRequestAnimationFrame) {
                globalThis.requestAnimationFrame = originalRequestAnimationFrame;
            } else {
                Reflect.deleteProperty(writableGlobal, "requestAnimationFrame");
            }
        }
    });

    it("keeps behavior-requested startup addObject yields forced to paint", async () => {
        const writableGlobal = globalThis as typeof globalThis & {requestAnimationFrame?: typeof requestAnimationFrame};
        const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
        const requestAnimationFrameSpy = vi.fn((frameCallback: FrameRequestCallback) => {
            frameCallback(0);
            return 1;
        });
        writableGlobal.requestAnimationFrame = requestAnimationFrameSpy as unknown as typeof requestAnimationFrame;
        const nowSpy = vi.spyOn(performance, "now").mockReturnValue(0);

        try {
            const root = namedObject("root");
            root.userData.behaviors = Array.from({length: 40}, (_value, index) => ({
                id: `behavior-${index}`,
                uuid: `behavior-${index}-uuid`,
                enabled: true,
                attributesData: {},
            }));

            const game = Object.create(GameManager.prototype) as any;
            game.engine = {physics: {addObject: vi.fn()}};
            game.addBehaviorToObject = vi.fn(async (_target: Object3D, _id: string, options: any) => {
                await options.yieldToFrame();
            });
            game.registerLambdaComponentsForObject = vi.fn();
            game.pauseObject = vi.fn();

            await game.initializeObject(root);

            expect(game.addBehaviorToObject).toHaveBeenCalledTimes(40);
            expect(requestAnimationFrameSpy.mock.calls.length).toBeGreaterThanOrEqual(40);
        } finally {
            nowSpy.mockRestore();
            if (originalRequestAnimationFrame) {
                globalThis.requestAnimationFrame = originalRequestAnimationFrame;
            } else {
                Reflect.deleteProperty(writableGlobal, "requestAnimationFrame");
            }
        }
    });

    it("keeps runtime addObject lifecycle checkpoints separate from authored yields", async () => {
        class RuntimeBehavior extends BehaviorBase {}
        const root = namedObject("runtime-root");
        root.userData.behaviors = [
            {id: "runtime", uuid: "runtime-uuid", enabled: true, attributesData: {}},
        ];
        const scene = new Scene();
        scene.add(root);

        const behaviorManager = Object.create(BehaviorManager.prototype) as any;
        behaviorManager.behaviorClasses = new Map([["runtime", RuntimeBehavior]]);
        behaviorManager.behaviorConfigAttributes = new Map([["runtime", {}]]);
        behaviorManager.behaviorNames = new Map();
        behaviorManager.erth = {};
        behaviorManager.game = {scene, behaviorManager};
        behaviorManager.initBehaviorWorker = vi.fn();
        behaviorManager.startBehavior = vi.fn(async (behavior: BehaviorBase, startupYield?: () => Promise<void>) => {
            expect(startupYield).toBeDefined();
            expect(startupYield).not.toBe((behavior as any).yieldToFrame);
            await startupYield?.();
        });

        const game = Object.create(GameManager.prototype) as any;
        game.engine = {scene, physics: {addObject: vi.fn()}};
        game.behaviorManager = behaviorManager;
        game.registerLambdaComponentsForObject = vi.fn();
        game.pauseObject = vi.fn();
        game.shouldLogBehaviorInitDetails = vi.fn(() => false);

        await game.initializeObject(root);

        expect(behaviorManager.startBehavior).toHaveBeenCalledTimes(1);
    });
});

describe("GameManager unified fixed-step frame", () => {
    it("samples input once, runs fixed stages once per step, and variables once", () => {
        const order: string[] = [];
        const game = Object.create(GameManager.prototype) as any;
        game.state = GAME_STATE.STARTED;
        game.engine = {scene: new Scene(), camera: new PerspectiveCamera()};
        game.inputManager = {
            update: vi.fn(() => order.push("input")),
            getAction: vi.fn(() => false),
        };
        game.collisionDetector = {update: vi.fn(() => order.push("collision"))};
        game.behaviorManager = {
            fixedUpdate: vi.fn(() => order.push("behavior:fixed")),
            update: vi.fn(() => order.push("behavior:variable")),
            getBehaviors: vi.fn(() => []),
        };
        game.lambdaManager = {
            fixedUpdate: vi.fn(() => order.push("lambda:fixed")),
            update: vi.fn(() => order.push("lambda:variable")),
            forEachRegisteredObject: vi.fn(),
        };
        game.objectPicker = {update: vi.fn(() => order.push("picker"))};

        const simulationFrame = {
            rawDeltaTime: 1 / 30,
            deltaTime: 1 / 30,
            fixedDeltaTime: 1 / 60,
            fixedStepCount: 2,
            interpolationAlpha: 0,
            fixedOverstep: 0,
            droppedTime: 0,
            droppedSteps: 0,
            totalDroppedTime: 0,
            totalDroppedSteps: 0,
        };
        const context = game.beginSimulationFrame(1 / 30, simulationFrame);
        game.fixedUpdate(1 / 60, context);
        game.fixedUpdate(1 / 60, context);
        game.update({}, 1 / 30, context);

        expect(order).toEqual([
            "input",
            "collision",
            "behavior:fixed",
            "lambda:fixed",
            "collision",
            "behavior:fixed",
            "lambda:fixed",
            "behavior:variable",
            "lambda:variable",
            "picker",
        ]);
        expect(game.inputManager.update).toHaveBeenCalledOnce();
        expect(context.fixedUpdatesEnabled).toBe(true);
        expect(context.fixedStepCount).toBe(2);
        expect(context.interpolationAlpha).toBe(0);
    });
});

describe("GameManager.ensureUICamera", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("copies authoritative source matrixWorld when source camera uses manual world updates", () => {
        const camera = new PerspectiveCamera();
        const scene = new Scene();
        const game = Object.create(GameManager.prototype) as GameManager;
        game.engine = {camera, scene} as unknown as GameManager["engine"];

        const uiCamera = game.ensureUICamera() as PerspectiveCamera;
        const hudRoot = new Object3D();
        const observedParentPosition = new Vector3();
        hudRoot.updateMatrixWorld = vi.fn(function updateHUDRootMatrixWorld(this: Object3D, force?: boolean) {
            observedParentPosition.setFromMatrixPosition(this.parent!.matrixWorld);
            Object3D.prototype.updateMatrixWorld.call(this, force);
        });
        uiCamera.add(hudRoot);

        camera.matrixWorldAutoUpdate = false;
        camera.position.set(3.746, 3.9, -1.253);
        camera.matrixWorld.makeTranslation(3.746, 3.9, -1.253);
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

        uiCamera.updateMatrixWorld();

        expect(uiCamera.position.toArray()).toEqual([3.746, 3.9, -1.253]);
        expect(uiCamera.matrixWorld.equals(camera.matrixWorld)).toBe(true);
        expect(uiCamera.matrixWorldInverse.equals(camera.matrixWorldInverse)).toBe(true);
        expect(hudRoot.updateMatrixWorld).toHaveBeenCalledOnce();
        expect(observedParentPosition.toArray()).toEqual([3.746, 3.9, -1.253]);
    });

    it("derives UI camera matrixWorld from local transforms when source camera auto-updates", () => {
        const camera = new PerspectiveCamera();
        const scene = new Scene();
        const game = Object.create(GameManager.prototype) as GameManager;
        game.engine = {camera, scene} as unknown as GameManager["engine"];

        const uiCamera = game.ensureUICamera() as PerspectiveCamera;

        camera.matrixWorldAutoUpdate = true;
        camera.position.set(2, 3, 4);
        camera.matrixWorld.makeTranslation(20, 30, 40);

        uiCamera.updateMatrixWorld();

        const uiWorldPosition = new Vector3().setFromMatrixPosition(uiCamera.matrixWorld);
        expect(uiCamera.position.toArray()).toEqual([2, 3, 4]);
        expect(uiWorldPosition.toArray()).toEqual([2, 3, 4]);
        expect(uiCamera.matrixWorld.equals(camera.matrixWorld)).toBe(false);
    });

    it("synchronizes stable frames without cloning the camera or rebuilding its projection", () => {
        const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 2_000);
        camera.userData = {role: "main"};
        camera.updateProjectionMatrix();
        const scene = new Scene();
        const game = Object.create(GameManager.prototype) as GameManager;
        game.engine = {camera, scene} as unknown as GameManager["engine"];

        const uiCamera = game.ensureUICamera() as PerspectiveCamera;
        const copySpy = vi.spyOn(uiCamera, "copy");
        const projectionSpy = vi.spyOn(uiCamera, "updateProjectionMatrix");
        const hudRoot = new Object3D();
        uiCamera.add(hudRoot);

        for (let i = 0; i < 20; i++) {
            uiCamera.updateMatrixWorld();
        }

        expect(copySpy).not.toHaveBeenCalled();
        expect(projectionSpy).not.toHaveBeenCalled();
        expect(uiCamera.children).toContain(hudRoot);
        expect(uiCamera.userData).toMatchObject({role: "main", isRuntimeOnly: true});

        camera.position.set(4, 5, 6);
        camera.fov = 75;
        camera.updateProjectionMatrix();
        uiCamera.updateMatrixWorld();

        expect(uiCamera.position.toArray()).toEqual([4, 5, 6]);
        expect(uiCamera.fov).toBe(75);
        expect(uiCamera.near).toBeCloseTo(0.2);
        expect(projectionSpy).toHaveBeenCalledTimes(1);
        expect(copySpy).not.toHaveBeenCalled();
    });

    it("preserves runtime metadata when the source camera replaces userData", () => {
        const camera = new PerspectiveCamera();
        const scene = new Scene();
        const game = Object.create(GameManager.prototype) as GameManager;
        game.engine = {camera, scene} as unknown as GameManager["engine"];
        const uiCamera = game.ensureUICamera() as PerspectiveCamera;

        camera.userData = {nested: {value: 7}};
        uiCamera.updateMatrixWorld();

        expect(uiCamera.userData).toEqual({nested: {value: 7}, isRuntimeOnly: true});
        expect(uiCamera.userData.nested).not.toBe(camera.userData.nested);
    });
});

describe("GameManager object hierarchy lifecycle", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("registers the lookup before initialization and shares one post-init budget walk", async () => {
        const root = namedObject("root");
        const child = namedObject("child");
        root.add(child);
        const calls: string[] = [];
        const game = Object.create(GameManager.prototype) as any;
        game.engine = {scene: new Scene()};
        game.objectLookup = {registerTree: vi.fn(() => calls.push("lookup"))};
        game.initializeObject = vi.fn(async () => calls.push("initialize"));
        game.plotBudgetManager = {
            registerObjectNode: vi.fn((node: Object3D) => {
                calls.push(`plot:${node.name}`);
                return node !== root;
            }),
        };
        game.textureResidencyManager = {
            registerObjectNode: vi.fn((node: Object3D) => {
                calls.push(`texture:${node.name}`);
                return true;
            }),
        };

        await game.addObject(root);

        expect(calls).toEqual(["lookup", "initialize", "plot:root", "texture:root", "texture:child"]);
        expect(game.plotBudgetManager.registerObjectNode).toHaveBeenCalledTimes(1);
        expect(game.textureResidencyManager.registerObjectNode).toHaveBeenCalledTimes(2);
    });

    it("disposes deep hierarchies without recursive traversal", () => {
        const root = namedObject("root");
        const leaf = addDeepChain(root);
        root.userData.physics = {enabled: true};
        leaf.userData.physics = {enabled: true};
        const traverse = vi.spyOn(root, "traverse");
        const removeObject = vi.fn();
        const game = Object.create(GameManager.prototype) as any;
        game.engine = {physics: {removeObject}};
        game.removeAllBehaviorsForObject = vi.fn();

        game.disposeObject(root);

        expect(traverse).not.toHaveBeenCalled();
        expect(game.removeAllBehaviorsForObject).toHaveBeenCalledTimes(12_001);
        expect(removeObject).toHaveBeenCalledWith(root);
        expect(removeObject).toHaveBeenCalledWith(leaf);
    });

    it("pauses and resumes deep hierarchies without recursive traversal", () => {
        const root = namedObject("root");
        const leaf = addDeepChain(root);
        root.userData.physics = {enabled: true};
        leaf.userData.physics = {enabled: true};
        const traverse = vi.spyOn(root, "traverse");
        const removeObject = vi.fn();
        const addObject = vi.fn();
        const game = Object.create(GameManager.prototype) as any;
        game.engine = {physics: {removeObject, addObject}};
        game.behaviorManager = {
            pauseObjectBehaviors: vi.fn(),
            resumeObjectBehaviors: vi.fn(),
        };

        game.pauseObject(root);
        expect(root.userData.paused).toBe(true);
        expect(leaf.userData.paused).toBe(true);
        expect(game.behaviorManager.pauseObjectBehaviors).toHaveBeenCalledTimes(12_001);
        expect(removeObject).toHaveBeenCalledWith(root);
        expect(removeObject).toHaveBeenCalledWith(leaf);

        game.resumeObject(root);
        expect(root.userData.paused).toBe(false);
        expect(leaf.userData.paused).toBe(false);
        expect(game.behaviorManager.resumeObjectBehaviors).toHaveBeenCalledTimes(12_001);
        expect(addObject).toHaveBeenCalledWith(root);
        expect(addObject).toHaveBeenCalledWith(leaf);
        expect(traverse).not.toHaveBeenCalled();
    });

    it("keeps pause and resume cascade flags scoped to the root object", () => {
        const root = namedObject("root");
        const child = namedObject("child");
        root.add(child);
        const game = Object.create(GameManager.prototype) as any;
        game.engine = {physics: {removeObject: vi.fn(), addObject: vi.fn()}};
        game.behaviorManager = {
            pauseObjectBehaviors: vi.fn(),
            resumeObjectBehaviors: vi.fn(),
        };

        game.pauseObject(root, false);
        expect(root.userData.paused).toBe(true);
        expect(child.userData.paused).toBeUndefined();
        expect(game.behaviorManager.pauseObjectBehaviors).toHaveBeenCalledTimes(1);

        game.resumeObject(root, false);
        expect(root.userData.paused).toBe(false);
        expect(child.userData.paused).toBeUndefined();
        expect(game.behaviorManager.resumeObjectBehaviors).toHaveBeenCalledTimes(1);
    });
});

describe("GameManager.createBehaviorsFromScene", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        delete (globalThis as {__stemBhvTimings?: unknown}).__stemBhvTimings;
        delete (globalThis as {__stemPlayBehaviorTimings?: unknown}).__stemPlayBehaviorTimings;
    });

    it("initializes enabled behaviors by priority without losing target mappings", async () => {
        const scene = new Scene();
        const objectA = namedObject("object-a");
        const objectB = namedObject("object-b");
        const objectC = namedObject("object-c");
        objectA.userData.behaviors = [
            {id: "late", uuid: "late", enabled: true, priority: 10, attributesData: {}},
            {id: "disabled", uuid: "disabled", enabled: false, priority: 1, attributesData: {}},
        ];
        objectB.userData.behaviors = [
            {id: "early", uuid: "early", enabled: true, priority: 1, attributesData: {}},
            {id: "default", uuid: "default", enabled: true, attributesData: {}},
        ];
        objectC.userData.behaviors = [
            {id: "early-2", uuid: "early-2", enabled: true, priority: 1, attributesData: {}},
        ];
        scene.add(objectA, objectB, objectC);
        const progress = vi.fn();
        const initialized: string[] = [];
        const game = Object.create(GameManager.prototype) as any;
        game.isMultiplayer = false;
        game.engine = {
            scene,
            loadingManager: {updateStageProgress: progress},
        };
        game.addBehaviorToObject = vi.fn(async (target: Object3D, id: string) => {
            initialized.push(`${id}:${target.name}`);
        });
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "debug").mockImplementation(() => {});

        await withImmediateAnimationFrame(() => game.createBehaviorsFromScene());

        expect(initialized).toEqual(["early:object-b", "early-2:object-c", "late:object-a", "default:object-b"]);
        expect(game.addBehaviorToObject).toHaveBeenCalledTimes(4);
        expect(progress.mock.calls.map(([value]) => value)).toEqual([0.25, 0.5, 0.75, 1]);
        const timingRoot = globalThis as {
            __stemBhvTimings?: Record<string, number>;
            __stemPlayBehaviorTimings?: Array<{id: string; target: string; ms: number}>;
        };
        expect(timingRoot.__stemPlayBehaviorTimings?.map(entry => `${entry.id}:${entry.target}`)).toEqual(initialized);
        expect(timingRoot.__stemBhvTimings?.early).toBeGreaterThanOrEqual(0);
    });

    it("initializes world builders before gameplay regardless of scene traversal order", async () => {
        const scene = new Scene();
        const player = namedObject("player");
        const terrain = namedObject("terrain");
        const late = namedObject("late");
        player.userData.behaviors = [
            {id: "flight", uuid: "flight", enabled: true, priority: 0, attributesData: {}},
        ];
        terrain.userData.behaviors = [
            {id: "globe", uuid: "globe", enabled: true, priority: 0, attributesData: {}},
        ];
        late.userData.behaviors = [
            {id: "post-world", uuid: "post-world", enabled: true, priority: 0, attributesData: {}},
        ];
        scene.add(player, terrain, late);

        const initialized: string[] = [];
        const game = Object.create(GameManager.prototype) as any;
        game.isMultiplayer = false;
        game.behaviorStartupPriorityOffsets = new Map();
        game.configureBehaviorStartupPriorityOffsets([
            {id: "globe", main: "script.js", isScript: true, attributes: {}, tags: ["terrain"]},
            {id: "flight", main: "script.js", isScript: true, attributes: {}, tags: ["gameplay"]},
            {id: "post-world", main: "script.js", isScript: true, attributes: {}, startupPhase: "late"},
        ]);
        game.engine = {scene, loadingManager: {updateStageProgress: vi.fn()}};
        game.addBehaviorToObject = vi.fn(async (_target: Object3D, id: string) => {
            initialized.push(id);
        });
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "debug").mockImplementation(() => {});

        await withImmediateAnimationFrame(() => game.createBehaviorsFromScene());

        expect(initialized).toEqual(["globe", "flight", "post-world"]);
    });

    it("skips formatting detailed diagnostics when debug behavior logging is disabled", async () => {
        const scene = new Scene();
        const target = namedObject("target");
        target.userData.behaviors = [
            {id: "behavior", uuid: "behavior-uuid", enabled: true, priority: 1, attributesData: {}},
        ];
        scene.add(target);
        const game = Object.create(GameManager.prototype) as any;
        game.isMultiplayer = false;
        game.engine = {
            scene,
            loadingManager: {updateStageProgress: vi.fn()},
        };
        game.addBehaviorToObject = vi.fn(async () => {});
        game.shouldLogBehaviorInitDetails = vi.fn(() => false);
        game.formatBehaviorInitDetails = vi.fn(() => ({behaviors: [], priorities: []}));
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "debug").mockImplementation(() => {});

        await withImmediateAnimationFrame(() => game.createBehaviorsFromScene());

        expect(game.shouldLogBehaviorInitDetails).toHaveBeenCalledTimes(1);
        expect(game.formatBehaviorInitDetails).not.toHaveBeenCalled();
    });

    it("keeps detailed behavior startup logging opt-in", () => {
        const scene = new Scene();
        const game = Object.create(GameManager.prototype) as any;
        game.engine = {
            scene,
            debug: false,
        };

        expect(game.shouldLogBehaviorInitDetails()).toBe(false);

        scene.userData.rendering = {debugBehaviorStartup: true};
        expect(game.shouldLogBehaviorInitDetails()).toBe(true);

        scene.userData.rendering = {};
        game.engine.debug = true;
        expect(game.shouldLogBehaviorInitDetails()).toBe(true);
    });

    it("keeps debug initialization diagnostics while grouping runtime behavior bindings directly", async () => {
        const scene = new Scene();
        const objectA = namedObject("object-a");
        const objectB = namedObject("object-b");
        const late = {id: "late", uuid: "late", enabled: true, priority: 10, attributesData: {}};
        const disabled = {id: "disabled", uuid: "disabled", enabled: false, priority: 1, attributesData: {}};
        const early = {id: "early", uuid: "early", enabled: true, priority: 1, attributesData: {}};
        const defaultPriority = {id: "default", uuid: "default", enabled: true, attributesData: {}};
        objectA.userData.behaviors = [late, disabled];
        objectB.userData.behaviors = [early, defaultPriority];
        scene.add(objectA, objectB);

        const game = Object.create(GameManager.prototype) as any;
        game.isMultiplayer = false;
        game.engine = {
            scene,
            loadingManager: {updateStageProgress: vi.fn()},
        };
        game.addBehaviorToObject = vi.fn(async () => {});
        game.shouldLogBehaviorInitDetails = vi.fn(() => true);
        game.formatBehaviorInitDetails = vi.fn(() => ({behaviors: [], priorities: []}));
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "debug").mockImplementation(() => {});

        await withImmediateAnimationFrame(() => game.createBehaviorsFromScene());

        const [allBehaviors, behaviorsByPriority] = game.formatBehaviorInitDetails.mock.calls[0];
        expect(allBehaviors).toEqual([late, early, defaultPriority]);
        expect(behaviorsByPriority.get(1)).toEqual([early]);
        expect(behaviorsByPriority.get(10)).toEqual([late]);
        expect(behaviorsByPriority.get(1000)).toEqual([defaultPriority]);
    });

    it("yields while discovering behavior hooks across large scenes", async () => {
        const writableGlobal = globalThis as typeof globalThis & {requestAnimationFrame?: typeof requestAnimationFrame};
        const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
        const requestAnimationFrameSpy = vi.fn((frameCallback: FrameRequestCallback) => {
            frameCallback(0);
            return 1;
        });
        writableGlobal.requestAnimationFrame = requestAnimationFrameSpy as unknown as typeof requestAnimationFrame;

        try {
            const scene = new Scene();
            for (let i = 0; i < 260; i++) {
                scene.add(namedObject(`object-${i}`));
            }
            const game = Object.create(GameManager.prototype) as any;
            game.isMultiplayer = false;
            game.engine = {
                scene,
                loadingManager: {updateStageProgress: vi.fn()},
            };
            game.addBehaviorToObject = vi.fn(async () => {});
            vi.spyOn(console, "log").mockImplementation(() => {});
            vi.spyOn(console, "debug").mockImplementation(() => {});

            await game.createBehaviorsFromScene();

            expect(requestAnimationFrameSpy).toHaveBeenCalled();
        } finally {
            if (originalRequestAnimationFrame) {
                globalThis.requestAnimationFrame = originalRequestAnimationFrame;
            } else {
                Reflect.deleteProperty(writableGlobal, "requestAnimationFrame");
            }
        }
    });

    it("batches cheap play-start behavior creation steps", async () => {
        const writableGlobal = globalThis as typeof globalThis & {requestAnimationFrame?: typeof requestAnimationFrame};
        const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
        const requestAnimationFrameSpy = vi.fn((frameCallback: FrameRequestCallback) => {
            frameCallback(0);
            return 1;
        });
        writableGlobal.requestAnimationFrame = requestAnimationFrameSpy as unknown as typeof requestAnimationFrame;

        try {
            const scene = new Scene();
            const target = namedObject("target");
            target.userData.behaviors = Array.from({length: 40}, (_value, index) => ({
                id: `behavior-${index}`,
                uuid: `behavior-${index}-uuid`,
                enabled: true,
                priority: 1,
                attributesData: {},
            }));
            scene.add(target);
            const game = Object.create(GameManager.prototype) as any;
            game.isMultiplayer = false;
            game.engine = {
                scene,
                loadingManager: {updateStageProgress: vi.fn()},
            };
            game.addBehaviorToObject = vi.fn(async (_target: Object3D, _id: string, options: any) => {
                expect(typeof options.yieldToFrame).toBe("function");
                expect(typeof options.startupYieldToFrame).toBe("function");
            });
            game.shouldLogBehaviorInitDetails = vi.fn(() => false);
            vi.spyOn(console, "log").mockImplementation(() => {});
            vi.spyOn(console, "debug").mockImplementation(() => {});

            await game.createBehaviorsFromScene();

            expect(game.addBehaviorToObject).toHaveBeenCalledTimes(40);
            // The progressive controller batches cheap work (16 steps per
            // slice) instead of forcing one paint for every behavior.
            expect(requestAnimationFrameSpy.mock.calls.length).toBeGreaterThan(0);
            expect(requestAnimationFrameSpy.mock.calls.length).toBeLessThan(10);
        } finally {
            if (originalRequestAnimationFrame) {
                globalThis.requestAnimationFrame = originalRequestAnimationFrame;
            } else {
                Reflect.deleteProperty(writableGlobal, "requestAnimationFrame");
            }
        }
    });

    it("routes real behavior creation through a non-forced lifecycle cadence", async () => {
        const writableGlobal = globalThis as typeof globalThis & {requestAnimationFrame?: typeof requestAnimationFrame};
        const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
        const requestAnimationFrameSpy = vi.fn((frameCallback: FrameRequestCallback) => {
            frameCallback(0);
            return 1;
        });
        writableGlobal.requestAnimationFrame = requestAnimationFrameSpy as unknown as typeof requestAnimationFrame;

        class CheapBehavior extends BehaviorBase {}

        try {
            const scene = new Scene();
            const target = namedObject("target");
            target.userData.behaviors = Array.from({length: 40}, (_value, index) => ({
                id: "cheap",
                uuid: `cheap-${index}-uuid`,
                enabled: true,
                priority: 1,
                attributesData: {},
            }));
            scene.add(target);

            const behaviorManager = Object.create(BehaviorManager.prototype) as any;
            behaviorManager.behaviorClasses = new Map([["cheap", CheapBehavior]]);
            behaviorManager.behaviorConfigAttributes = new Map([["cheap", {}]]);
            behaviorManager.behaviorNames = new Map();
            behaviorManager.erth = {};
            behaviorManager.game = {scene, behaviorManager};
            behaviorManager.initBehaviorWorker = vi.fn();
            behaviorManager.startBehavior = vi.fn(async (behavior: BehaviorBase, startupYield?: () => Promise<void>) => {
                expect(startupYield).toBeDefined();
                expect(startupYield).not.toBe((behavior as any).yieldToFrame);
                await startupYield?.();
            });

            const game = Object.create(GameManager.prototype) as any;
            game.isMultiplayer = false;
            game.engine = {scene, loadingManager: {updateStageProgress: vi.fn()}};
            game.behaviorManager = behaviorManager;
            game.pauseObject = vi.fn();
            game.shouldLogBehaviorInitDetails = vi.fn(() => false);
            vi.spyOn(console, "log").mockImplementation(() => {});
            vi.spyOn(console, "debug").mockImplementation(() => {});

            await game.createBehaviorsFromScene();

            expect(behaviorManager.startBehavior).toHaveBeenCalledTimes(40);
            expect(requestAnimationFrameSpy.mock.calls.length).toBeGreaterThan(0);
            // The real lifecycle path may cross the 4ms budget in a test
            // runner, but must not force one paint for every behavior.
            expect(requestAnimationFrameSpy.mock.calls.length).toBeLessThan(40);
        } finally {
            if (originalRequestAnimationFrame) {
                globalThis.requestAnimationFrame = originalRequestAnimationFrame;
            } else {
                Reflect.deleteProperty(writableGlobal, "requestAnimationFrame");
            }
        }
    });

    it("forces a paint after a slow behavior while retaining normal cadence for cheap work", async () => {
        const writableGlobal = globalThis as typeof globalThis & {requestAnimationFrame?: typeof requestAnimationFrame};
        const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
        const requestAnimationFrameSpy = vi.fn((frameCallback: FrameRequestCallback) => {
            frameCallback(0);
            return 1;
        });
        writableGlobal.requestAnimationFrame = requestAnimationFrameSpy as unknown as typeof requestAnimationFrame;
        let now = 0;
        const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => now);

        try {
            const scene = new Scene();
            const target = namedObject("target");
            target.userData.behaviors = [
                {id: "slow", uuid: "slow-uuid", enabled: true, priority: 1, attributesData: {}},
                {id: "cheap", uuid: "cheap-uuid", enabled: true, priority: 1, attributesData: {}},
            ];
            scene.add(target);
            const game = Object.create(GameManager.prototype) as any;
            game.isMultiplayer = false;
            game.engine = {
                scene,
                loadingManager: {updateStageProgress: vi.fn()},
            };
            game.addBehaviorToObject = vi.fn(async (_target: Object3D, id: string, options: any) => {
                expect(typeof options.yieldToFrame).toBe("function");
                if (id === "slow") {
                    now += 10;
                }
            });
            game.shouldLogBehaviorInitDetails = vi.fn(() => false);
            vi.spyOn(console, "log").mockImplementation(() => {});
            vi.spyOn(console, "debug").mockImplementation(() => {});

            await game.createBehaviorsFromScene();

            expect(game.addBehaviorToObject).toHaveBeenCalledTimes(2);
            // The slow behavior is below the 16-step batch boundary, so this
            // paint proves the duration-triggered forced yield was honored.
            expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
        } finally {
            nowSpy.mockRestore();
            if (originalRequestAnimationFrame) {
                globalThis.requestAnimationFrame = originalRequestAnimationFrame;
            } else {
                Reflect.deleteProperty(writableGlobal, "requestAnimationFrame");
            }
        }
    });

    it("still yields during larger play-start behavior creation batches", async () => {
        const writableGlobal = globalThis as typeof globalThis & {requestAnimationFrame?: typeof requestAnimationFrame};
        const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
        const requestAnimationFrameSpy = vi.fn((frameCallback: FrameRequestCallback) => {
            frameCallback(0);
            return 1;
        }) as unknown as typeof requestAnimationFrame;
        writableGlobal.requestAnimationFrame = requestAnimationFrameSpy;

        try {
            const scene = new Scene();
            const target = namedObject("target");
            target.userData.behaviors = Array.from({length: 130}, (_value, index) => ({
                id: `behavior-${index}`,
                uuid: `behavior-${index}-uuid`,
                enabled: true,
                priority: 1,
                attributesData: {},
            }));
            scene.add(target);
            const game = Object.create(GameManager.prototype) as any;
            game.isMultiplayer = false;
            game.engine = {
                scene,
                loadingManager: {updateStageProgress: vi.fn()},
            };
            game.addBehaviorToObject = vi.fn(async (_target: Object3D, _id: string, options: any) => {
                expect(typeof options.yieldToFrame).toBe("function");
                await options.yieldToFrame();
            });
            game.shouldLogBehaviorInitDetails = vi.fn(() => false);
            vi.spyOn(console, "log").mockImplementation(() => {});
            vi.spyOn(console, "debug").mockImplementation(() => {});

            await game.createBehaviorsFromScene();

            expect(game.addBehaviorToObject).toHaveBeenCalledTimes(130);
            expect(requestAnimationFrameSpy).toHaveBeenCalled();
        } finally {
            if (originalRequestAnimationFrame) {
                globalThis.requestAnimationFrame = originalRequestAnimationFrame;
            } else {
                Reflect.deleteProperty(writableGlobal, "requestAnimationFrame");
            }
        }
    });

    it("leaves behavior-generated mesh normal repair for deferred startup optimizations", async () => {
        const scene = new Scene();
        const target = namedObject("target");
        target.userData.behaviors = [
            {id: "behavior", uuid: "behavior-uuid", enabled: true, priority: 1, attributesData: {}},
        ];
        scene.add(target);
        const geometry = makeTriangleGeometry();
        const game = Object.create(GameManager.prototype) as any;
        game.isMultiplayer = false;
        game.engine = {
            scene,
            loadingManager: {updateStageProgress: vi.fn()},
        };
        game.addBehaviorToObject = vi.fn(async () => {
            target.add(new Mesh(geometry, new MeshBasicMaterial()));
        });
        game.shouldLogBehaviorInitDetails = vi.fn(() => false);
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "debug").mockImplementation(() => {});

        await withImmediateAnimationFrame(() => game.createBehaviorsFromScene());

        expect(geometry.getAttribute("normal")).toBeUndefined();
    });

    it("does not block behavior startup on large generated mesh normal repair", async () => {
        const scene = new Scene();
        const target = namedObject("target");
        target.userData.behaviors = [
            {id: "behavior", uuid: "behavior-uuid", enabled: true, priority: 1, attributesData: {}},
        ];
        scene.add(target);
        const geometries: BufferGeometry[] = [];
        const game = Object.create(GameManager.prototype) as any;
        game.isMultiplayer = false;
        game.engine = {
            scene,
            loadingManager: {updateStageProgress: vi.fn()},
        };
        game.addBehaviorToObject = vi.fn(async () => {
            for (let i = 0; i < 70; i++) {
                const geometry = makeTriangleGeometry();
                geometries.push(geometry);
                target.add(new Mesh(geometry, new MeshBasicMaterial()));
            }
        });
        game.shouldLogBehaviorInitDetails = vi.fn(() => false);
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "debug").mockImplementation(() => {});

        await game.createBehaviorsFromScene();

        expect(geometries.every(geometry => geometry.getAttribute("normal") === undefined)).toBe(true);
    });

    it("skips verbose add-behavior debug logs when behavior init details are disabled", async () => {
        const target = namedObject("target");
        const behavior = {uuid: "behavior-uuid", id: "legacy.behavior"};
        const game = Object.create(GameManager.prototype) as any;
        game.shouldLogBehaviorInitDetails = vi.fn(() => false);
        game.behaviorManager = {
            createBehavior: vi.fn(async () => behavior),
        };
        game.pauseObject = vi.fn();
        const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

        await game.addBehaviorToObject(target, "legacy.behavior", {uuid: "behavior-uuid"});

        expect(game.behaviorManager.createBehavior).toHaveBeenCalledWith(
            target,
            "legacy.behavior",
            {uuid: "behavior-uuid"},
        );
        expect(debugSpy).not.toHaveBeenCalled();
    });

    it("adds object behaviors progressively instead of starting them all at once", async () => {
        const target = namedObject("target");
        target.userData.behaviors = [
            {id: "first", uuid: "first-uuid", enabled: true, attributesData: {}},
            {id: "disabled", uuid: "disabled-uuid", enabled: false, attributesData: {}},
            {id: "second", uuid: "second-uuid", enabled: true, attributesData: {}},
        ];
        const events: string[] = [];
        let releaseFirst!: () => void;
        const firstDone = new Promise<void>(resolve => {
            releaseFirst = resolve;
        });
        const yieldToFrame = vi.fn(async () => {
            events.push("yield");
        });
        const game = Object.create(GameManager.prototype) as any;
        game.addBehaviorToObject = vi.fn(async (_target: Object3D, id: string, options: any) => {
            events.push(`add:${id}`);
            expect(options.yieldToFrame).toBe(yieldToFrame);
            if (id === "first") {
                await firstDone;
            }
        });
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const run = game.addAllBehaviorsFromObjectProgressive(target, yieldToFrame);
        await Promise.resolve();

        expect(events).toEqual(["add:first"]);

        releaseFirst();
        await run;

        expect(events).toEqual(["add:first", "yield", "add:second", "yield"]);
        expect(game.addBehaviorToObject).toHaveBeenCalledTimes(2);
        expect(errorSpy).not.toHaveBeenCalled();
    });
});

describe("GameManager.getAllBehaviorsFromObject", () => {
    it("returns enabled behaviors and fills the target lookup map", () => {
        const target = namedObject("target");
        const enabled = {id: "enabled", uuid: "enabled-uuid", enabled: true, attributesData: {}};
        const disabled = {id: "disabled", uuid: "disabled-uuid", enabled: false, attributesData: {}};
        target.userData.behaviors = [enabled, disabled];
        const behaviorToTargetMap = new Map<string, Object3D>();
        const game = Object.create(GameManager.prototype) as any;
        game.isMultiplayer = false;

        const result = game.getAllBehaviorsFromObject(target, behaviorToTargetMap);

        expect(result).toEqual([enabled]);
        expect(behaviorToTargetMap.get("enabled-uuid")).toBe(target);
        expect(behaviorToTargetMap.has("disabled-uuid")).toBe(false);
    });

    it("skips character child behaviors in multiplayer mode", () => {
        const parent = namedObject("character");
        parent.userData.behaviors = [{id: "character", uuid: "character-uuid", enabled: true, attributesData: {}}];
        const child = namedObject("child");
        const childBehavior = {id: "child-behavior", uuid: "child-uuid", enabled: true, attributesData: {}};
        child.userData.behaviors = [childBehavior];
        parent.add(child);
        const behaviorToTargetMap = new Map<string, Object3D>();
        const game = Object.create(GameManager.prototype) as any;
        game.isMultiplayer = true;

        const result = game.getAllBehaviorsFromObject(child, behaviorToTargetMap);

        expect(result).toEqual([]);
        expect(behaviorToTargetMap.size).toBe(0);
    });
});

describe("GameManager.addAllBehaviorsFromObject", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("adds enabled behaviors progressively while preserving the promise array API", async () => {
        const target = namedObject("target");
        target.userData.behaviors = [
            {id: "first", uuid: "first-uuid", enabled: true, attributesData: {}},
            {id: "disabled", uuid: "disabled-uuid", enabled: false, attributesData: {}},
            {id: "second", uuid: "second-uuid", enabled: true, attributesData: {}},
        ];
        const writableGlobal = globalThis as typeof globalThis & {requestAnimationFrame?: typeof requestAnimationFrame};
        const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
        const requestAnimationFrameSpy = vi.fn((frameCallback: FrameRequestCallback) => {
            frameCallback(0);
            return 1;
        }) as unknown as typeof requestAnimationFrame;
        writableGlobal.requestAnimationFrame = requestAnimationFrameSpy;

        try {
            const events: string[] = [];
            let releaseFirst!: () => void;
            const firstDone = new Promise<void>(resolve => {
                releaseFirst = resolve;
            });
            const game = Object.create(GameManager.prototype) as any;
            game.addBehaviorToObject = vi.fn(async (_target: Object3D, id: string, options: any) => {
                events.push(`add:${id}`);
                expect(typeof options.yieldToFrame).toBe("function");
                await options.yieldToFrame();
                if (id === "first") {
                    await firstDone;
                }
            });

            const promises = game.addAllBehaviorsFromObject(target);
            await Promise.resolve();

            expect(promises).toHaveLength(2);
            expect(events).toEqual(["add:first"]);

            releaseFirst();
            await Promise.all(promises);

            expect(events).toEqual(["add:first", "add:second"]);
            expect(game.addBehaviorToObject).toHaveBeenCalledTimes(2);
            expect(requestAnimationFrameSpy).toHaveBeenCalled();
        } finally {
            if (originalRequestAnimationFrame) {
                globalThis.requestAnimationFrame = originalRequestAnimationFrame;
            } else {
                Reflect.deleteProperty(writableGlobal, "requestAnimationFrame");
            }
        }
    });
});

describe("GameManager.classifyStaticEntities", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("yields while classifying large static scenes", async () => {
        const writableGlobal = globalThis as typeof globalThis & {requestAnimationFrame?: typeof requestAnimationFrame};
        const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
        const requestAnimationFrameSpy = vi.fn((frameCallback: FrameRequestCallback) => {
            frameCallback(0);
            return 1;
        }) as unknown as typeof requestAnimationFrame;
        writableGlobal.requestAnimationFrame = requestAnimationFrameSpy;

        try {
            const scene = new Scene();
            const objects: Object3D[] = [];
            for (let i = 0; i < 70; i++) {
                const object = namedObject(`static-${i}`);
                object.userData.isStemObject = true;
                objects.push(object);
                scene.add(object);
            }
            const dynamic = namedObject("dynamic");
            dynamic.userData.isStemObject = true;
            dynamic.userData.behaviors = [{id: "behavior", uuid: "behavior", enabled: true}];
            scene.add(dynamic);

            const game = Object.create(GameManager.prototype) as any;
            game.shouldLogBehaviorInitDetails = vi.fn(() => false);

            await game.classifyStaticEntities(scene);

            expect(requestAnimationFrameSpy).toHaveBeenCalled();
            for (const object of objects) {
                expect(object.userData._isSceneStatic).toBe(true);
                expect(object.matrixAutoUpdate).toBe(false);
                expect(object.matrixWorldAutoUpdate).toBe(false);
            }
            expect(dynamic.userData._isSceneStatic).toBeUndefined();
            expect(dynamic.matrixAutoUpdate).toBe(true);
            expect(dynamic.matrixWorldAutoUpdate).toBe(true);
        } finally {
            if (originalRequestAnimationFrame) {
                globalThis.requestAnimationFrame = originalRequestAnimationFrame;
            } else {
                Reflect.deleteProperty(writableGlobal, "requestAnimationFrame");
            }
        }
    });
});

describe("GameManager deferred startup optimizations", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("classifies static entities and installs runtime budget managers when still current", async () => {
        const scene = new Scene();
        const staticObject = namedObject("static");
        staticObject.userData.isStemObject = true;
        scene.add(staticObject);
        const geometry = makeTriangleGeometry();
        staticObject.add(new Mesh(geometry, new MeshBasicMaterial()));

        const game = Object.create(GameManager.prototype) as any;
        game.engine = {scene};
        game.state = GAME_STATE.STARTED;
        game.deferredStartupOptimizationToken = 1;
        game.runtimeBudgetCoordinator = {
            configureFromQuality: vi.fn(),
            update: vi.fn(),
        };
        game.shouldLogBehaviorInitDetails = vi.fn(() => false);

        await withImmediateAnimationFrame(() => game.runDeferredStartupOptimizations(scene, 1));

        expect(staticObject.userData._isSceneStatic).toBe(true);
        expect(geometry.getAttribute("normal")).toBeDefined();
        expect(geometry.getAttribute("normal").count).toBe(geometry.getAttribute("position").count);
        expect(game.plotBudgetManager).toBeTruthy();
        expect(game.textureResidencyManager).toBeTruthy();
        expect(game.runtimeBudgetCoordinator.update).toHaveBeenCalled();

        game.plotBudgetManager?.dispose();
        game.textureResidencyManager?.dispose();
    });

    it("waits for runtime scene reveal before deferred static classification", async () => {
        const scene = new Scene();
        scene.userData._runtimeSceneRevealActive = true;
        const staticObject = namedObject("static");
        staticObject.userData.isStemObject = true;
        scene.add(staticObject);

        const game = Object.create(GameManager.prototype) as any;
        game.engine = {scene};
        game.state = GAME_STATE.STARTED;
        game.deferredStartupOptimizationToken = 1;
        game.runtimeBudgetCoordinator = {
            configureFromQuality: vi.fn(),
            update: vi.fn(),
        };
        game.shouldLogBehaviorInitDetails = vi.fn(() => false);

        const revealStateDuringClassify: unknown[] = [];
        game.classifyStaticEntities = vi.fn(async () => {
            revealStateDuringClassify.push(scene.userData._runtimeSceneRevealActive);
            staticObject.userData._isSceneStatic = true;
        });

        const writableGlobal = globalThis as typeof globalThis & {requestAnimationFrame?: typeof requestAnimationFrame};
        const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
        let rafCalls = 0;
        writableGlobal.requestAnimationFrame = ((frameCallback: FrameRequestCallback) => {
            rafCalls += 1;
            if (rafCalls >= 4) {
                delete scene.userData._runtimeSceneRevealActive;
            }
            frameCallback(0);
            return rafCalls;
        }) as typeof requestAnimationFrame;

        try {
            await game.runDeferredStartupOptimizations(scene, 1);
        } finally {
            if (originalRequestAnimationFrame) {
                globalThis.requestAnimationFrame = originalRequestAnimationFrame;
            } else {
                Reflect.deleteProperty(writableGlobal, "requestAnimationFrame");
            }
            game.plotBudgetManager?.dispose();
            game.textureResidencyManager?.dispose();
        }

        expect(rafCalls).toBeGreaterThanOrEqual(4);
        expect(revealStateDuringClassify).toEqual([undefined]);
        expect(staticObject.userData._isSceneStatic).toBe(true);
    });

    it("waits for pending runtime scene reveal preparation before deferred static classification", async () => {
        const scene = new Scene();
        scene.userData[RUNTIME_SCENE_REVEAL_PENDING_KEY] = true;
        const staticObject = namedObject("static");
        staticObject.userData.isStemObject = true;
        scene.add(staticObject);

        const game = Object.create(GameManager.prototype) as any;
        game.engine = {scene};
        game.state = GAME_STATE.STARTED;
        game.deferredStartupOptimizationToken = 1;
        game.runtimeBudgetCoordinator = {
            configureFromQuality: vi.fn(),
            update: vi.fn(),
        };
        game.shouldLogBehaviorInitDetails = vi.fn(() => false);

        const pendingStateDuringClassify: unknown[] = [];
        game.classifyStaticEntities = vi.fn(async () => {
            pendingStateDuringClassify.push(scene.userData[RUNTIME_SCENE_REVEAL_PENDING_KEY]);
            staticObject.userData._isSceneStatic = true;
        });

        const writableGlobal = globalThis as typeof globalThis & {requestAnimationFrame?: typeof requestAnimationFrame};
        const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
        let rafCalls = 0;
        writableGlobal.requestAnimationFrame = ((frameCallback: FrameRequestCallback) => {
            rafCalls += 1;
            if (rafCalls >= 4) {
                delete scene.userData[RUNTIME_SCENE_REVEAL_PENDING_KEY];
            }
            frameCallback(0);
            return rafCalls;
        }) as typeof requestAnimationFrame;

        try {
            await game.runDeferredStartupOptimizations(scene, 1);
        } finally {
            if (originalRequestAnimationFrame) {
                globalThis.requestAnimationFrame = originalRequestAnimationFrame;
            } else {
                Reflect.deleteProperty(writableGlobal, "requestAnimationFrame");
            }
            game.plotBudgetManager?.dispose();
            game.textureResidencyManager?.dispose();
        }

        expect(rafCalls).toBeGreaterThanOrEqual(4);
        expect(pendingStateDuringClassify).toEqual([undefined]);
        expect(staticObject.userData._isSceneStatic).toBe(true);
    });

    it("does not mutate scene or install managers after cancellation", async () => {
        const scene = new Scene();
        const staticObject = namedObject("static");
        staticObject.userData.isStemObject = true;
        scene.add(staticObject);

        const game = Object.create(GameManager.prototype) as any;
        game.engine = {scene};
        game.state = GAME_STATE.STARTED;
        game.deferredStartupOptimizationToken = 2;
        game.runtimeBudgetCoordinator = {
            configureFromQuality: vi.fn(),
            update: vi.fn(),
        };
        game.shouldLogBehaviorInitDetails = vi.fn(() => false);

        await withImmediateAnimationFrame(() => game.runDeferredStartupOptimizations(scene, 1));

        expect(staticObject.userData._isSceneStatic).toBeUndefined();
        expect(game.plotBudgetManager).toBeUndefined();
        expect(game.textureResidencyManager).toBeUndefined();
        expect(game.runtimeBudgetCoordinator.update).not.toHaveBeenCalled();
    });
});

describe("GameManager.startGame", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        breakpointManager.clearAll();
        delete (globalThis as {__stemPlayStartTimings?: unknown}).__stemPlayStartTimings;
    });

    function createStartGameHarness(scene = new Scene()) {
        const engineCall = vi.fn();
        const game = Object.create(GameManager.prototype) as any;
        game.engine = {
            scene,
            options: {isPlayModeOnly: true},
            call: engineCall,
            loadingManager: {nextStage: vi.fn(), updateStageProgress: vi.fn()},
        };
        game.sceneConfig = {};
        game.isEnabled = false;
        game.initialLives = 3;
        game.initialHealth = 100;
        game.score = 0;
        game.state = GAME_STATE.NOT_STARTED;
        game.behaviorManager = {resetStore: vi.fn(), resetProgressive: vi.fn(async () => {})};
        game.createLambdaInstancesFromScene = vi.fn(async () => {});
        game.createBehaviorsFromScene = vi.fn(async () => {});
        game.initializeObject = vi.fn(async () => {});
        game.gameCountDown = vi.fn();
        game.setPlayer = vi.fn((player: Object3D) => {
            game.player = player;
        });
        vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "debug").mockImplementation(() => {});
        return {game, scene, engineCall};
    }

    it("coalesces concurrent start requests and resolves after runtime initialization", async () => {
        const scene = new Scene();
        const engineCall = vi.fn();
        const game = Object.create(GameManager.prototype) as any;
        game.engine = {
            scene,
            options: {isPlayModeOnly: true},
            call: engineCall,
            loadingManager: {nextStage: vi.fn(), updateStageProgress: vi.fn()},
        };
        game.sceneConfig = {};
        game.isEnabled = false;
        game.initialLives = 3;
        game.initialHealth = 100;
        game.score = 10;
        game.state = GAME_STATE.NOT_STARTED;
        game.behaviorManager = {resetStore: vi.fn(), resetProgressive: vi.fn(async () => {})};
        game.createLambdaInstancesFromScene = vi.fn(async () => {});
        game.createBehaviorsFromScene = vi.fn(async () => {});
        game.gameCountDown = vi.fn();
        game.setPlayer = vi.fn();
        vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
        vi.spyOn(console, "log").mockImplementation(() => {});

        await withImmediateAnimationFrame(async () => {
            await Promise.all([game.startGame(), game.startGame()]);
        });

        expect(game.createLambdaInstancesFromScene).toHaveBeenCalledTimes(1);
        expect(game.createBehaviorsFromScene).toHaveBeenCalledTimes(1);
        expect(game.behaviorManager.resetStore).toHaveBeenCalledTimes(1);
        expect(game.behaviorManager.resetProgressive).toHaveBeenCalledTimes(1);
        expect(game.behaviorManager.resetProgressive).toHaveBeenCalledWith(expect.objectContaining({
            batchSize: 8,
            frameBudgetMs: 4,
            yieldToFrame: expect.any(Function),
        }));
        expect(game.state).toBe(GAME_STATE.STARTED);
        expect(engineCall).toHaveBeenCalledWith("gameStarted", game, game);
    });

    it("waits for fire-and-forget startup addObject continuations before gameStarted", async () => {
        const {game, scene, engineCall} = createStartGameHarness();
        const runtimeObject = namedObject("runtime-object");
        const order: string[] = [];
        let startupFlowComplete = false;

        game.initializeObject = vi.fn(async () => {
            await Promise.resolve();
        });
        game.createBehaviorsFromScene = vi.fn(async () => {
            void (async () => {
                await game.addObject(runtimeObject);
                startupFlowComplete = true;
                order.push("startup-flow-complete");
            })();
        });
        engineCall.mockImplementation((event: string) => {
            if (event === "gameStarted") {
                order.push(`gameStarted:${startupFlowComplete}`);
            }
        });

        await withImmediateAnimationFrame(() => game.startGame());

        expect(scene.children).toContain(runtimeObject);
        expect(game.initializeObject).toHaveBeenCalledWith(runtimeObject);
        expect(startupFlowComplete).toBe(true);
        expect(order).toEqual(["startup-flow-complete", "gameStarted:true"]);
    });

    it("waits for startup addObject continuations that enqueue chained additions", async () => {
        const {game, scene, engineCall} = createStartGameHarness();
        const first = namedObject("first-runtime-object");
        const second = namedObject("second-runtime-object");
        const initialized: string[] = [];
        const order: string[] = [];
        let chainedFlowComplete = false;

        game.initializeObject = vi.fn(async (object: Object3D) => {
            initialized.push(object.name);
            await Promise.resolve();
        });
        game.createBehaviorsFromScene = vi.fn(async () => {
            void (async () => {
                await game.addObject(first);
                await game.addObject(second);
                chainedFlowComplete = true;
                order.push("chained-flow-complete");
            })();
        });
        engineCall.mockImplementation((event: string) => {
            if (event === "gameStarted") {
                order.push(`gameStarted:${chainedFlowComplete}`);
            }
        });

        await withImmediateAnimationFrame(() => game.startGame());

        expect(scene.children).toEqual(expect.arrayContaining([first, second]));
        expect(initialized).toEqual(["first-runtime-object", "second-runtime-object"]);
        expect(order).toEqual(["chained-flow-complete", "gameStarted:true"]);
    });

    it("drains rejected startup addObject operations without blocking gameStarted", async () => {
        const {game, engineCall} = createStartGameHarness();
        const rejectedObject = namedObject("rejected-runtime-object");
        const startupError = new Error("startup add failed");

        game.initializeObject = vi.fn(async (object: Object3D) => {
            if (object === rejectedObject) {
                throw startupError;
            }
        });
        game.createBehaviorsFromScene = vi.fn(async () => {
            void game.addObject(rejectedObject);
        });

        await withImmediateAnimationFrame(() => game.startGame());

        const timings = ((globalThis as {__stemPlayStartTimings?: Array<{phase: string; message?: string}>})
            .__stemPlayStartTimings) ?? [];
        expect(game.state).toBe(GAME_STATE.STARTED);
        expect(engineCall).toHaveBeenCalledWith("gameStarted", game, game);
        expect(timings).toContainEqual(expect.objectContaining({
            phase: "gameStart:sceneMutationQuiescence",
            message: expect.stringContaining("rejected=1"),
        }));
    });

    it("allows startup mutation work to exceed the timeout while it keeps making progress", async () => {
        vi.useFakeTimers();
        const {game} = createStartGameHarness();
        game.isInitializing = true;
        const token = game.beginPlayStartupSceneMutationBarrier();
        const initialization = deferred<void>();
        game.trackPlayStartupSceneMutation(initialization.promise, token);

        const quiescence = game.awaitPlayStartupSceneMutationQuiescence(token);
        await vi.advanceTimersByTimeAsync(10_000);
        game.touchPlayStartupSceneMutationProgress(token);
        await vi.advanceTimersByTimeAsync(10_000);
        game.touchPlayStartupSceneMutationProgress(token);
        await vi.advanceTimersByTimeAsync(10_000);
        game.touchPlayStartupSceneMutationProgress(token);
        await vi.advanceTimersByTimeAsync(1_000);
        initialization.resolve();
        await quiescence;

        const timings = ((globalThis as {
            __stemPlayStartTimings?: Array<{phase: string; message?: string; success?: boolean; ms?: number}>;
        }).__stemPlayStartTimings) ?? [];
        expect(timings).toContainEqual(expect.objectContaining({
            phase: "gameStart:sceneMutationQuiescence",
            success: true,
            ms: 31_000,
            message: expect.stringContaining("progress=4"),
        }));
    });

    it("times out a genuinely stalled startup addObject operation after the inactivity limit", async () => {
        vi.useFakeTimers();
        const writableGlobal = globalThis as typeof globalThis & {requestAnimationFrame?: typeof requestAnimationFrame};
        const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
        writableGlobal.requestAnimationFrame = ((frameCallback: FrameRequestCallback) => {
            frameCallback(0);
            return 1;
        }) as typeof requestAnimationFrame;

        try {
            const {game, engineCall} = createStartGameHarness();
            const blockedObject = namedObject("blocked-runtime-object");
            const blockedInitialization = deferred<void>();

            game.initializeObject = vi.fn(async (object: Object3D) => {
                if (object === blockedObject) {
                    await blockedInitialization.promise;
                }
            });
            game.createBehaviorsFromScene = vi.fn(async () => {
                void game.addObject(blockedObject);
            });

            const startPromise = game.startGame();
            await vi.runAllTimersAsync();
            await startPromise;

            const timings = ((globalThis as {__stemPlayStartTimings?: Array<{phase: string; message?: string; success?: boolean}>})
                .__stemPlayStartTimings) ?? [];
            expect(engineCall).toHaveBeenCalledWith("gameStarted", game, game);
            expect(timings).toContainEqual(expect.objectContaining({
                phase: "gameStart:sceneMutationQuiescence",
                success: false,
                message: expect.stringContaining("timedOut=true"),
            }));
            expect(timings).toContainEqual(expect.objectContaining({
                phase: "gameStart:sceneMutationQuiescence",
                message: expect.stringContaining("idleTimeoutMs=15000"),
            }));
        } finally {
            if (originalRequestAnimationFrame) {
                globalThis.requestAnimationFrame = originalRequestAnimationFrame;
            } else {
                Reflect.deleteProperty(writableGlobal, "requestAnimationFrame");
            }
            vi.useRealTimers();
        }
    });

    it("wakes startup mutation quiescence immediately when startup is cancelled", async () => {
        const {game, engineCall} = createStartGameHarness();
        const blockedObject = namedObject("cancelled-runtime-object");
        const mutationStarted = deferred<void>();
        const blockedInitialization = deferred<void>();

        game.initializeObject = vi.fn(async (object: Object3D) => {
            if (object === blockedObject) {
                mutationStarted.resolve();
                await blockedInitialization.promise;
            }
        });
        game.createBehaviorsFromScene = vi.fn(async () => {
            void game.addObject(blockedObject);
        });

        await withImmediateAnimationFrame(async () => {
            const startPromise = game.startGame();
            await mutationStarted.promise;
            game.invalidatePlayStartupSceneMutationBarrier();

            const result = await Promise.race([
                startPromise.then(() => "resolved" as const),
                new Promise<"timed-out">(resolve => setTimeout(() => resolve("timed-out"), 50)),
            ]);

            expect(result).toBe("resolved");
        });

        const timings = ((globalThis as {__stemPlayStartTimings?: Array<{phase: string; message?: string; success?: boolean}>})
            .__stemPlayStartTimings) ?? [];
        expect(engineCall).not.toHaveBeenCalledWith("gameStarted", game, game);
        expect(timings).toContainEqual(expect.objectContaining({
            phase: "gameStart:sceneMutationQuiescence",
            success: false,
            message: expect.stringContaining("cancelled=true"),
        }));
    });

    it("waits for fire-and-forget addObject launched during behavior reset before gameStarted", async () => {
        const {game, scene, engineCall} = createStartGameHarness();
        const resetObject = namedObject("reset-runtime-object");
        const order: string[] = [];
        let resetFlowComplete = false;

        game.initializeObject = vi.fn(async () => {
            await Promise.resolve();
        });
        game.behaviorManager.resetProgressive = vi.fn(async () => {
            void (async () => {
                await game.addObject(resetObject);
                resetFlowComplete = true;
                order.push("reset-flow-complete");
            })();
        });
        engineCall.mockImplementation((event: string) => {
            if (event === "gameStarted") {
                order.push(`gameStarted:${resetFlowComplete}`);
            }
        });

        await withImmediateAnimationFrame(() => game.startGame());

        expect(scene.children).toContain(resetObject);
        expect(game.initializeObject).toHaveBeenCalledWith(resetObject);
        expect(order).toEqual(["reset-flow-complete", "gameStarted:true"]);
    });

    it("does not track addObject calls fired after startup as startup mutations", async () => {
        const {game, engineCall} = createStartGameHarness();
        const runtimeObject = namedObject("post-start-runtime-object");
        const runtimeAdd = deferred<void>();
        let runtimeAddPromise: Promise<void> | null = null;
        let runtimeAddStarted = false;

        game.initializeObject = vi.fn(async (object: Object3D) => {
            if (object === runtimeObject) {
                runtimeAddStarted = true;
                await runtimeAdd.promise;
            }
        });
        engineCall.mockImplementation((event: string) => {
            if (event === "gameStarted") {
                runtimeAddPromise = game.addObject(runtimeObject);
                void runtimeAddPromise;
            }
        });

        await withImmediateAnimationFrame(() => game.startGame());

        expect(runtimeAddStarted).toBe(true);
        expect(game.playStartupSceneMutations?.size ?? 0).toBe(0);

        runtimeAdd.resolve();
        await runtimeAddPromise;
    });

    it("skips editor debugger session loading when editor play has no breakpoints", async () => {
        const scene = new Scene();
        const engineCall = vi.fn();
        const game = Object.create(GameManager.prototype) as any;
        game.engine = {
            scene,
            editor: {scene},
            options: {isPlayModeOnly: false},
            call: engineCall,
            loadingManager: {nextStage: vi.fn(), updateStageProgress: vi.fn()},
        };
        game.sceneConfig = {};
        game.isEnabled = false;
        game.initialLives = 3;
        game.initialHealth = 100;
        game.score = 10;
        game.state = GAME_STATE.NOT_STARTED;
        game.behaviorManager = {resetStore: vi.fn(), resetProgressive: vi.fn(async () => {})};
        game.createLambdaInstancesFromScene = vi.fn(async () => {});
        game.createBehaviorsFromScene = vi.fn(async () => {});
        game.gameCountDown = vi.fn();
        game.setPlayer = vi.fn();
        vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
        vi.spyOn(console, "log").mockImplementation(() => {});

        await withImmediateAnimationFrame(() => game.startGame());

        const timings = ((globalThis as {__stemPlayStartTimings?: Array<{phase: string; message?: string}>})
            .__stemPlayStartTimings) ?? [];
        expect(timings).toContainEqual(expect.objectContaining({
            phase: "editorDebuggerCheck",
            message: "no-breakpoints",
        }));
        expect(timings).toContainEqual(expect.objectContaining({
            phase: "editorDebuggerSkipped",
            message: "no-breakpoints",
        }));
        expect(timings.some(entry => entry.phase === "editorDebuggerLoad")).toBe(false);
        expect(game.createBehaviorsFromScene).toHaveBeenCalledTimes(1);
    });

    it("uses progressive first-match player tag lookup during startup", async () => {
        const scene = new Scene();
        const firstPlayer = namedObject("first-player");
        const laterPlayer = namedObject("later-player");
        TagUtil.addTag(firstPlayer, "player");
        TagUtil.addTag(laterPlayer, "player");
        scene.add(firstPlayer, laterPlayer);
        const engineCall = vi.fn();
        const game = Object.create(GameManager.prototype) as any;
        game.engine = {
            scene,
            options: {isPlayModeOnly: true},
            call: engineCall,
            loadingManager: {nextStage: vi.fn(), updateStageProgress: vi.fn()},
        };
        game.sceneConfig = {};
        game.isEnabled = false;
        game.initialLives = 3;
        game.initialHealth = 100;
        game.score = 10;
        game.state = GAME_STATE.NOT_STARTED;
        game.behaviorManager = {resetStore: vi.fn(), resetProgressive: vi.fn(async () => {})};
        game.createLambdaInstancesFromScene = vi.fn(async () => {});
        game.createBehaviorsFromScene = vi.fn(async () => {});
        game.gameCountDown = vi.fn();
        game.setPlayer = vi.fn((player: Object3D) => {
            game.player = player;
        });
        const getFirstObjectByTag = vi.spyOn(TagUtil, "getFirstObjectByTag");
        const getObjectsByTag = vi.spyOn(TagUtil, "getObjectsByTag");
        vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
        vi.spyOn(console, "log").mockImplementation(() => {});

        await withImmediateAnimationFrame(() => game.startGame());

        expect(getFirstObjectByTag).not.toHaveBeenCalled();
        expect(getObjectsByTag).not.toHaveBeenCalled();
        expect(game.setPlayer).toHaveBeenCalledWith(firstPlayer);
        expect(game.player).toBe(firstPlayer);
    });

    it("yields while searching for player tags in large scenes", async () => {
        const scene = new Scene();
        const firstPlayer = namedObject("first-player");
        const laterPlayer = namedObject("later-player");

        for (let i = 0; i < 260; i++) {
            scene.add(namedObject(`child-${i}`));
        }
        TagUtil.addTag(firstPlayer, "player");
        TagUtil.addTag(laterPlayer, "player");
        scene.add(firstPlayer, laterPlayer);

        const game = Object.create(GameManager.prototype) as any;
        const yieldToFrame = vi.fn(async () => {});

        const result = await game.findFirstObjectByTagProgressive(scene, ["player", "Player"], yieldToFrame);

        expect(result).toBe(firstPlayer);
        expect(yieldToFrame).toHaveBeenCalled();
    });

    it("does not run HUD or gameplay systems while startup is yielding", () => {
        const game = Object.create(GameManager.prototype) as any;
        game.state = GAME_STATE.STARTED;
        game.isInitializing = true;
        game.hud = {update: vi.fn()};
        game.inputManager = {update: vi.fn(), getAction: vi.fn()};
        game.collisionDetector = {update: vi.fn()};
        game.behaviorManager = {update: vi.fn()};
        game.lambdaManager = {update: vi.fn()};
        game.objectPicker = {update: vi.fn()};

        game.update({}, 0.016);

        expect(game.hud.update).not.toHaveBeenCalled();
        expect(game.inputManager.update).not.toHaveBeenCalled();
        expect(game.collisionDetector.update).not.toHaveBeenCalled();
        expect(game.behaviorManager.update).not.toHaveBeenCalled();
        expect(game.lambdaManager.update).not.toHaveBeenCalled();
        expect(game.objectPicker.update).not.toHaveBeenCalled();
    });

    it("passes a shared runtime frame context with a spatial grid to behavior and lambda managers", () => {
        const scene = new Scene();
        const camera = new PerspectiveCamera();
        const behaviorTarget = namedObject("behavior-target");
        behaviorTarget.position.set(3, 4, 0);
        const lambdaTarget = namedObject("lambda-target");
        lambdaTarget.position.set(0, 6, 8);
        scene.add(behaviorTarget, lambdaTarget);
        scene.updateMatrixWorld(true);
        camera.updateMatrixWorld(true);
        vi.spyOn(performance, "now").mockReturnValue(100);

        const game = Object.create(GameManager.prototype) as any;
        game.engine = {scene, camera};
        game.state = GAME_STATE.STARTED;
        game.hud = {update: vi.fn()};
        game.inputManager = {
            update: vi.fn(),
            getAction: vi.fn(() => false),
        };
        game.collisionDetector = {update: vi.fn()};
        game.behaviorManager = {
            getBehaviors: vi.fn(() => [
                {
                    target: behaviorTarget,
                    throttleConfig: {enableDistanceThrottling: true},
                },
            ]),
            update: vi.fn(),
        };
        game.lambdaManager = {
            scheduler: {frameBudgetMs: 8},
            forEachRegisteredObject: vi.fn((callback: (object: Object3D) => void) => {
                callback(lambdaTarget);
            }),
            update: vi.fn(),
        };
        game.objectPicker = {update: vi.fn()};

        game.update({}, 0.016);

        const behaviorContext = game.behaviorManager.update.mock.calls[0][1];
        const lambdaContext = game.lambdaManager.update.mock.calls[0][1];
        expect(behaviorContext).toBe(lambdaContext);
        expect(behaviorContext.deltaTime).toBe(0.016);
        expect(behaviorContext.frameStartTime).toBe(100);
        expect(behaviorContext.frameDeadline).toBe(108);
        expect(behaviorContext.underRenderPressure).toBe(false);
        expect(behaviorContext.renderAvgMs).toBeCloseTo(16.583);
        expect(behaviorContext.fixedUpdatesEnabled).toBe(false);
        expect(behaviorContext.spatialGrid.getDistanceSq(behaviorTarget.uuid, new Vector3())).toBeCloseTo(25);
        expect(behaviorContext.spatialGrid.getDistanceSq(lambdaTarget.uuid, new Vector3())).toBeCloseTo(100);
        expect(game.behaviorManager.getBehaviors).toHaveBeenCalledTimes(1);
        expect(game.lambdaManager.forEachRegisteredObject).toHaveBeenCalledTimes(1);
    });

    it("skips behavior spatial tracking when behavior distance throttling is globally disabled", () => {
        const scene = new Scene();
        const camera = new PerspectiveCamera();
        const behaviorTarget = namedObject("behavior-target");
        const lambdaTarget = namedObject("lambda-target");
        behaviorTarget.position.set(3, 4, 0);
        lambdaTarget.position.set(0, 6, 8);
        scene.add(behaviorTarget, lambdaTarget);
        scene.userData.game = {
            behaviorThrottling: {
                enableDistanceThrottling: false,
            },
        };
        scene.updateMatrixWorld(true);
        camera.updateMatrixWorld(true);
        vi.spyOn(performance, "now").mockReturnValue(150);

        const game = Object.create(GameManager.prototype) as any;
        game.engine = {scene, camera};
        game.state = GAME_STATE.STARTED;
        game.inputManager = {
            update: vi.fn(),
            getAction: vi.fn(() => false),
        };
        game.behaviorManager = {
            getBehaviors: vi.fn(() => [
                {
                    target: behaviorTarget,
                    throttleConfig: {enableDistanceThrottling: true},
                },
            ]),
            update: vi.fn(),
        };
        game.lambdaManager = {
            forEachRegisteredObject: vi.fn((callback: (object: Object3D) => void) => {
                callback(lambdaTarget);
            }),
            update: vi.fn(),
        };

        game.update({}, 0.016);

        const frameContext = game.behaviorManager.update.mock.calls[0][1];
        expect(game.behaviorManager.getBehaviors).not.toHaveBeenCalled();
        expect(game.lambdaManager.forEachRegisteredObject).toHaveBeenCalledTimes(1);
        expect(frameContext.spatialGrid.getDistanceSq(behaviorTarget.uuid, new Vector3())).toBeNull();
        expect(frameContext.spatialGrid.getDistanceSq(lambdaTarget.uuid, new Vector3())).toBeCloseTo(100);
    });

    it("passes a null spatial grid when behavior throttling is disabled and no lambdas add objects", () => {
        const scene = new Scene();
        scene.userData.game = {
            behaviorThrottling: {
                throttlingEnabled: false,
            },
        };
        const camera = new PerspectiveCamera();
        vi.spyOn(performance, "now").mockReturnValue(175);

        const game = Object.create(GameManager.prototype) as any;
        game.engine = {scene, camera};
        game.state = GAME_STATE.STARTED;
        game.inputManager = {
            update: vi.fn(),
            getAction: vi.fn(() => false),
        };
        game.behaviorManager = {
            getBehaviors: vi.fn(() => []),
            update: vi.fn(),
        };
        game.lambdaManager = {
            forEachRegisteredObject: vi.fn(),
            update: vi.fn(),
        };

        game.update({}, 0.016);

        const frameContext = game.behaviorManager.update.mock.calls[0][1];
        expect(game.behaviorManager.getBehaviors).not.toHaveBeenCalled();
        expect(game.lambdaManager.forEachRegisteredObject).toHaveBeenCalledTimes(1);
        expect(frameContext.spatialGrid).toBeNull();
    });

    it("removes stale runtime spatial grid entries when tracked targets disappear", () => {
        const scene = new Scene();
        const camera = new PerspectiveCamera();
        const target = namedObject("tracked-target");
        target.position.set(10, 0, 0);
        scene.add(target);
        scene.updateMatrixWorld(true);
        camera.updateMatrixWorld(true);

        const game = Object.create(GameManager.prototype) as any;
        game.engine = {scene, camera};
        game.state = GAME_STATE.STARTED;
        game.inputManager = {
            update: vi.fn(),
            getAction: vi.fn(() => false),
        };
        let behaviorVisible = true;
        const getBehaviors = vi.fn(() => (
            behaviorVisible
                ? [
                    {
                        target,
                        throttleConfig: {enableDistanceThrottling: true},
                    },
                ]
                : []
        ));
        game.behaviorManager = {
            getBehaviors,
            update: vi.fn(),
        };
        game.lambdaManager = {
            forEachRegisteredObject: vi.fn(),
            update: vi.fn(),
        };

        game.update({}, 0.016);
        const firstContext = game.behaviorManager.update.mock.calls[0][1];
        const firstGrid = firstContext.spatialGrid;
        expect(firstGrid.getDistanceSq(target.uuid, new Vector3())).toBeCloseTo(100);

        behaviorVisible = false;
        game.update({}, 0.016);
        const secondContext = game.behaviorManager.update.mock.calls[1][1];
        expect(secondContext).toBe(firstContext);
        expect(secondContext.spatialGrid).toBeNull();
        expect(firstGrid.getDistanceSq(target.uuid, new Vector3())).toBeNull();
        expect(getBehaviors).toHaveBeenCalledTimes(2);
    });

    it("reuses the runtime spatial tracking callback across frames", () => {
        const scene = new Scene();
        const camera = new PerspectiveCamera();
        const target = namedObject("tracked-target");
        target.position.set(4, 0, 0);
        scene.add(target);
        scene.updateMatrixWorld(true);
        camera.updateMatrixWorld(true);

        const callbacks: Array<(object: Object3D) => void> = [];
        const game = Object.create(GameManager.prototype) as any;
        game.engine = {scene, camera};
        game.state = GAME_STATE.STARTED;
        game.inputManager = {
            update: vi.fn(),
            getAction: vi.fn(() => false),
        };
        game.behaviorManager = {
            getBehaviors: vi.fn(() => [
                {
                    target,
                    throttleConfig: {enableDistanceThrottling: true},
                },
            ]),
            update: vi.fn(),
        };
        game.lambdaManager = {
            forEachRegisteredObject: vi.fn((callback: (object: Object3D) => void) => {
                callbacks.push(callback);
                callback(target);
            }),
            update: vi.fn(),
        };

        game.update({}, 0.016);
        game.update({}, 0.016);

        expect(callbacks).toHaveLength(2);
        expect(callbacks[1]).toBe(callbacks[0]);
        expect((game as any).runtimeSpatialTrackingGrid).toBeNull();
        expect((game as any).runtimeSpatialTrackingIds).toBeNull();
        const frameContext = game.behaviorManager.update.mock.calls[1][1];
        expect(frameContext.spatialGrid.getDistanceSq(target.uuid, new Vector3())).toBeCloseTo(16);
    });

    it("feeds render pressure to the runtime budget before gameplay systems update", () => {
        const scene = new Scene();
        const camera = new PerspectiveCamera();
        vi.spyOn(performance, "now").mockReturnValue(200);

        const game = Object.create(GameManager.prototype) as any;
        game.engine = {
            scene,
            camera,
        };
        game.runtimeFrameBudgetMs = 6;
        game.runtimeTargetFrameMs = 1000 / 60;
        game.runtimeDeltaPressureThreshold = 1.25;
        game.state = GAME_STATE.STARTED;
        game.inputManager = {
            update: vi.fn(),
            getAction: vi.fn(() => false),
        };
        game.collisionDetector = {update: vi.fn()};
        game.behaviorManager = {
            getBehaviors: vi.fn(() => []),
            update: vi.fn(),
        };
        game.lambdaManager = {
            forEachRegisteredObject: vi.fn(),
            update: vi.fn(),
        };
        game.objectPicker = {update: vi.fn()};
        const snapshot = {
            enabled: true,
            pressure: "warning",
            managedTextureBytes: 0,
            totalManagedTextureBytes: 0,
            targetTextureBytes: 1,
            usageRatio: 0,
            reason: "managed-texture-render-pressure",
            updatedAt: 200,
            framesInPressure: 1,
            isMobile: false,
        };
        game.runtimeBudgetCoordinator = {
            updateForFrame: vi.fn(() => snapshot),
        };
        game.configurePressureDrivenBudgetManagers = vi.fn();

        game.update({}, 0.2);

        const frameContext = game.behaviorManager.update.mock.calls[0][1];
        expect(frameContext.frameStartTime).toBe(200);
        expect(frameContext.frameDeadline).toBe(206);
        expect(frameContext.underRenderPressure).toBe(true);
        expect(frameContext.renderAvgMs).toBeCloseTo(39.583);
        expect(game.runtimeBudgetCoordinator.updateForFrame).toHaveBeenCalledWith({}, {
            underRenderPressure: true,
            now: 200,
        });
        expect(game.configurePressureDrivenBudgetManagers).toHaveBeenCalledWith(snapshot);
        expect(game.runtimeBudgetCoordinator.updateForFrame.mock.invocationCallOrder[0])
            .toBeLessThan(game.behaviorManager.update.mock.invocationCallOrder[0]);
        expect(game.runtimeBudgetCoordinator.updateForFrame.mock.invocationCallOrder[0])
            .toBeLessThan(game.lambdaManager.update.mock.invocationCallOrder[0]);
    });
});

describe("GameManager.setupGamePlayerAccount", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("skips unified service startup in OSS builds", async () => {
        const game = Object.create(GameManager.prototype) as any;
        game.unifiedGameServices = {
            start: vi.fn(async () => {}),
        };
        vi.spyOn(console, "debug").mockImplementation(() => {});

        await game.setupGamePlayerAccount();

        expect(game.unifiedGameServices.start).not.toHaveBeenCalled();
    });
});

describe("GameManager.createLambdaInstancesFromScene", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("skips the full scene component traversal when no lambda instances exist", async () => {
        const scene = new Scene();
        const child = namedObject("child");
        child.userData.lambdaComponents = [
            {
                lambdaId: "missing",
                instanceId: "missing-instance",
                enabled: true,
                autoApply: true,
                componentData: {},
            },
        ];
        scene.add(child);
        const game = Object.create(GameManager.prototype) as any;
        game.engine = {scene};
        game.lambdaManager = {createInstance: vi.fn(), registerObject: vi.fn()};
        game.registerLambdaComponentsForObject = vi.fn();
        vi.spyOn(console, "log").mockImplementation(() => {});

        await game.createLambdaInstancesFromScene();

        expect(game.lambdaManager.createInstance).not.toHaveBeenCalled();
        expect(game.registerLambdaComponentsForObject).not.toHaveBeenCalled();
        expect(game.lambdaManager.registerObject).not.toHaveBeenCalled();
    });

    it("skips component traversal when all lambda definitions are disabled", async () => {
        const scene = new Scene();
        scene.userData.lambdaInstances = [
            {lambdaId: "disabled-scene", instanceId: "scene-instance", enabled: false, attributes: {}},
        ];
        scene.userData.projectLambdaInstances = [
            {lambdaId: "disabled-project", instanceId: "project-instance", enabled: false, attributes: {}},
        ];
        const child = namedObject("child");
        child.userData.lambdaComponents = [
            {
                lambdaId: "disabled-scene",
                instanceId: "scene-instance",
                enabled: true,
                autoApply: true,
                componentData: {},
            },
        ];
        scene.add(child);
        const game = Object.create(GameManager.prototype) as any;
        game.engine = {scene};
        game.lambdaManager = {createInstance: vi.fn(), registerObject: vi.fn()};
        game.registerLambdaComponentsForObject = vi.fn();
        vi.spyOn(console, "log").mockImplementation(() => {});

        await game.createLambdaInstancesFromScene();

        expect(game.lambdaManager.createInstance).not.toHaveBeenCalled();
        expect(game.registerLambdaComponentsForObject).not.toHaveBeenCalled();
        expect(game.lambdaManager.registerObject).not.toHaveBeenCalled();
    });

    it("creates project lambda instances first and registers scene objects after creation", async () => {
        const scene = new Scene();
        scene.userData.lambdaInstances = [
            {lambdaId: "shared", instanceId: "scene-shared", enabled: true, attributes: {source: "scene"}},
            {lambdaId: "scene-only", instanceId: "scene-only", enabled: true, attributes: {source: "scene"}},
        ];
        scene.userData.projectLambdaInstances = [
            {lambdaId: "shared", instanceId: "project-shared", enabled: true, attributes: {source: "project"}},
        ];
        const child = namedObject("child");
        child.userData.lambdaComponents = [
            {
                lambdaId: "shared",
                instanceId: "project-shared",
                enabled: true,
                autoApply: true,
                componentData: {value: 1},
            },
        ];
        scene.add(child);
        const game = Object.create(GameManager.prototype) as any;
        game.engine = {scene};
        game.lambdaManager = {
            createInstance: vi.fn(async () => ({})),
            registerObject: vi.fn(),
        };
        vi.spyOn(console, "log").mockImplementation(() => {});

        await game.createLambdaInstancesFromScene();

        expect(game.lambdaManager.createInstance.mock.calls.map(([lambdaId]: [string]) => lambdaId)).toEqual([
            "shared",
            "scene-only",
        ]);
        expect(game.lambdaManager.createInstance).toHaveBeenNthCalledWith(1, "shared", expect.objectContaining({
            uuid: "project-shared",
            attributes: {source: "project"},
            yieldToFrame: expect.any(Function),
        }));
        expect(game.lambdaManager.registerObject).toHaveBeenCalledWith("project-shared", child, {value: 1});
    });

    it("yields while registering lambda components across large scenes", async () => {
        const writableGlobal = globalThis as typeof globalThis & {requestAnimationFrame?: typeof requestAnimationFrame};
        const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
        const requestAnimationFrameSpy = vi.fn((frameCallback: FrameRequestCallback) => {
            frameCallback(0);
            return 1;
        }) as unknown as typeof requestAnimationFrame;
        writableGlobal.requestAnimationFrame = requestAnimationFrameSpy;

        try {
            const scene = new Scene();
            scene.userData.projectLambdaInstances = [
                {lambdaId: "project-lambda", instanceId: "project-instance", enabled: true, attributes: {}},
            ];
            for (let i = 0; i < 260; i++) {
                const child = namedObject(`child-${i}`);
                child.userData.lambdaComponents = [
                    {
                        lambdaId: "project-lambda",
                        instanceId: "project-instance",
                        enabled: true,
                        autoApply: true,
                        componentData: {index: i},
                    },
                ];
                scene.add(child);
            }
            const game = Object.create(GameManager.prototype) as any;
            game.engine = {scene};
            game.lambdaManager = {
                createInstance: vi.fn(async () => ({})),
                registerObject: vi.fn(),
            };
            vi.spyOn(console, "log").mockImplementation(() => {});

            await game.createLambdaInstancesFromScene();

            expect(requestAnimationFrameSpy).toHaveBeenCalled();
            expect(game.lambdaManager.registerObject).toHaveBeenCalledTimes(260);
        } finally {
            if (originalRequestAnimationFrame) {
                globalThis.requestAnimationFrame = originalRequestAnimationFrame;
            } else {
                Reflect.deleteProperty(writableGlobal, "requestAnimationFrame");
            }
        }
    });
});

describe("GameManager.detectSceneRuntimeFeatures", () => {
    it("detects behavior and lambda usage while yielding across large scenes", async () => {
        const scene = new Scene();
        for (let i = 0; i < 260; i++) {
            const child = namedObject(`child-${i}`);
            if (i === 240) {
                child.userData.lambdaComponents = [{lambdaId: "lambda", instanceId: "instance"}];
            }
            if (i === 259) {
                child.userData.behaviors = [{id: "aiNpc", uuid: "ai-npc-behavior", enabled: true}];
            }
            scene.add(child);
        }
        const game = Object.create(GameManager.prototype) as any;
        const yieldToFrame = vi.fn(async () => {});

        const features = await game.detectSceneRuntimeFeatures(scene, "aiNpc", yieldToFrame);

        expect(features).toEqual({usesBehaviorId: true, usesLambdas: true});
        expect(yieldToFrame).toHaveBeenCalled();
    });

    it("uses scene-level lambda metadata without requiring component discovery", async () => {
        const scene = new Scene();
        scene.userData.projectLambdaInstances = [{lambdaId: "project-lambda", instanceId: "project-instance"}];
        const game = Object.create(GameManager.prototype) as any;
        const yieldToFrame = vi.fn(async () => {});

        const features = await game.detectSceneRuntimeFeatures(scene, "aiNpc", yieldToFrame);

        expect(features).toEqual({usesBehaviorId: false, usesLambdas: true});
    });
});

describe("GameManager object UUID lookup", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("indexes deep scene UUID lookups without Three's recursive getObjectByProperty", () => {
        const scene = new Scene();
        const deepRoot = namedObject("deep-root");
        const deepLeaf = addDeepChain(deepRoot, 512);
        const lateObject = namedObject("late-object");
        scene.add(deepRoot);
        const game = Object.create(GameManager.prototype) as any;
        game.engine = {scene};
        const getObjectByPropertySpy = vi.spyOn(scene, "getObjectByProperty");
        const traverseSpy = vi.spyOn(scene, "traverse");

        expect(game.getObjectByUUID(deepLeaf.uuid)).toBe(deepLeaf);
        expect(game.getObjectByUUID(deepLeaf.uuid)).toBe(deepLeaf);

        deepLeaf.removeFromParent();
        expect(game.getObjectByUUID(deepLeaf.uuid)).toBeNull();

        scene.add(lateObject);
        expect(game.getObjectByUUID(lateObject.uuid)).toBe(lateObject);
        expect(getObjectByPropertySpy).not.toHaveBeenCalled();
        expect(traverseSpy).not.toHaveBeenCalled();
    });
});

describe("GameManager.update HUD ticking", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("ticks HUD managers before gameplay state gates", () => {
        const game = Object.create(GameManager.prototype) as any;
        game.state = GAME_STATE.NOT_STARTED;
        game.hud = {update: vi.fn()};
        game.inputManager = {update: vi.fn()};

        game.update({} as never, 1 / 60);

        expect(game.hud.update).toHaveBeenCalledWith(1 / 60);
        expect(game.inputManager.update).not.toHaveBeenCalled();
    });
});

describe("GameManager runtime budget configuration", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("does not re-read quality settings every frame for runtime budget updates", () => {
        const game = Object.create(GameManager.prototype) as any;
        const getCurrentSettings = vi.fn(() => ({runtimeBudget: {enabled: true}}));
        const update = vi.fn();

        game.state = GAME_STATE.STARTED;
        game.engine = {
            qualityManager: {
                getCurrentSettings,
            },
        } as unknown as GameManager["engine"];
        game.runtimeBudgetCoordinator = {
            configureFromQuality: vi.fn(),
            update,
        };

        game.update({} as never, 1 / 60);

        expect(getCurrentSettings).not.toHaveBeenCalled();
        expect(game.runtimeBudgetCoordinator.configureFromQuality).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith({}, expect.objectContaining({
            underRenderPressure: false,
        }));
    });

    it("reuses runtime budget manager options across frames", () => {
        const game = Object.create(GameManager.prototype) as any;
        const firstTextureManager = {configureFromQuality: vi.fn(), update: vi.fn()};
        const secondTextureManager = {configureFromQuality: vi.fn(), update: vi.fn()};
        const seenTextureManagers: unknown[] = [];
        const snapshot = {
            enabled: true,
            pressure: "normal",
            targetTextureBytes: 1024,
            isMobile: false,
        };
        const updateForFrame = vi.fn((options) => {
            seenTextureManagers.push(options.textureResidencyManager);
            return snapshot;
        });

        game.state = GAME_STATE.STARTED;
        game.engine = {
            scene: {userData: {}},
            camera: {},
        } as unknown as GameManager["engine"];
        game.runtimeBudgetCoordinator = {updateForFrame};
        game.textureResidencyManager = firstTextureManager;

        game.update({} as never, 1 / 60);
        const firstOptions = updateForFrame.mock.calls[0]![0];

        game.textureResidencyManager = secondTextureManager;
        game.update({} as never, 1 / 60);

        game.textureResidencyManager = undefined;
        game.update({} as never, 1 / 60);

        expect(updateForFrame).toHaveBeenCalledTimes(3);
        expect(updateForFrame.mock.calls[1]![0]).toBe(firstOptions);
        expect(updateForFrame.mock.calls[2]![0]).toBe(firstOptions);
        expect(seenTextureManagers).toEqual([firstTextureManager, secondTextureManager, undefined]);
        expect(firstTextureManager.update).toHaveBeenCalledOnce();
        expect(secondTextureManager.update).toHaveBeenCalledOnce();
    });

    it("reconfigures plot and texture budget policies only when runtime pressure changes", () => {
        const game = Object.create(GameManager.prototype) as any;
        const settings = {runtimeBudget: {enabled: true}};
        const getCurrentSettings = vi.fn(() => settings);
        const normalSnapshot = {
            enabled: true,
            pressure: "normal",
            targetTextureBytes: 1024,
            isMobile: false,
        };
        const warningSnapshot = {
            ...normalSnapshot,
            pressure: "warning",
        };
        const plotOverrides = {runtimePressure: "warning"};
        const textureOverrides = {runtimePressure: "warning"};

        game.state = GAME_STATE.STARTED;
        game.engine = {
            scene: {userData: {}},
            camera: {},
            qualityManager: {getCurrentSettings},
        } as unknown as GameManager["engine"];
        game.runtimeBudgetCoordinator = {
            update: vi.fn()
                .mockReturnValueOnce(normalSnapshot)
                .mockReturnValueOnce({...normalSnapshot})
                .mockReturnValueOnce(warningSnapshot),
            getPlotBudgetOverrides: vi.fn(() => plotOverrides),
            getTextureResidencyOverrides: vi.fn(() => textureOverrides),
        };
        game.plotBudgetManager = {
            configureFromQuality: vi.fn(),
            update: vi.fn(),
        };
        game.textureResidencyManager = {
            configureFromQuality: vi.fn(),
            update: vi.fn(),
        };
        (game.engine as unknown as {game: typeof game}).game = game;

        game.update({} as never, 1 / 60);
        game.update({} as never, 1 / 60);
        game.update({} as never, 1 / 60);

        expect(game.plotBudgetManager.configureFromQuality).toHaveBeenCalledTimes(2);
        expect(game.textureResidencyManager.configureFromQuality).toHaveBeenCalledTimes(2);
        expect(game.plotBudgetManager.update).toHaveBeenCalledTimes(3);
        expect(game.textureResidencyManager.update).toHaveBeenCalledTimes(3);
        expect(getCurrentSettings).toHaveBeenCalledTimes(4);
    });

    it("reconfigures runtime budget managers when quality settings change", () => {
        const game = Object.create(GameManager.prototype) as any;
        const settings = {runtimeBudget: {enabled: true}};
        const getCurrentSettings = vi.fn(() => settings);
        const plotOverrides = {runtimePressure: "warning"};
        const textureOverrides = {runtimePressure: "warning"};
        let qualityChangedListener: (() => void) | undefined;
        const qualityManager = {
            getCurrentSettings,
            on: vi.fn((_event: "qualityChanged", listener: () => void) => {
                qualityChangedListener = listener;
            }),
            off: vi.fn(),
        };

        game.engine = {qualityManager} as unknown as GameManager["engine"];
        game.runtimeBudgetCoordinator = {
            configureFromQuality: vi.fn(),
            getPlotBudgetOverrides: vi.fn(() => plotOverrides),
            getTextureResidencyOverrides: vi.fn(() => textureOverrides),
        };
        game.plotBudgetManager = {
            configureFromQuality: vi.fn(),
        };
        game.textureResidencyManager = {
            configureFromQuality: vi.fn(),
        };
        (game.engine as unknown as {game: typeof game}).game = game;
        game.handleRuntimeQualityChanged = () => game.configureRuntimeBudgetManagersFromQuality();

        game.listenRuntimeQualityChanges();
        qualityChangedListener?.();

        expect(qualityManager.on).toHaveBeenCalledWith("qualityChanged", game.handleRuntimeQualityChanged);
        expect(game.runtimeBudgetCoordinator.configureFromQuality).toHaveBeenCalledWith(settings);
        expect(game.plotBudgetManager.configureFromQuality).toHaveBeenCalledWith(settings, plotOverrides);
        expect(game.textureResidencyManager.configureFromQuality).toHaveBeenCalledWith(settings, textureOverrides);

        game.unlistenRuntimeQualityChanges();
        expect(qualityManager.off).toHaveBeenCalledWith("qualityChanged", game.handleRuntimeQualityChanged);
    });

    it("commits script-owned dynamic players without inheriting stale physics motion", () => {
        const game = Object.create(GameManager.prototype) as any;
        const player = new Object3D();
        player.position.set(0, -1.25, 80);
        player.userData.physics = {enabled: true, ctype: "Dynamic", mass: 1};
        const physics = {
            setOrigin: vi.fn(),
            setRotation: vi.fn(),
            setScale: vi.fn(),
            setLinearVelocity: vi.fn(),
            setAngularVelocity: vi.fn(),
            setCollisionBehavior: vi.fn(),
        };

        game.player = player;
        game.physics = physics;
        game.playerTransformOwnership = "script";
        game.hasScriptDrivenPlayerTransform = false;
        game.playerPhysicsPosition = new Vector3();
        game.playerPhysicsQuaternion = new Quaternion();
        game.playerPhysicsScale = new Vector3();
        game.playerPhysicsZeroVelocity = new Vector3();

        game.commitScriptDrivenPlayerTransform();

        expect(physics.setOrigin).toHaveBeenCalledWith(player.uuid, expect.objectContaining({x: 0, z: 80}));
        expect(physics.setLinearVelocity).toHaveBeenCalledWith(player.uuid, game.playerPhysicsZeroVelocity);
        expect(physics.setAngularVelocity).toHaveBeenCalledWith(player.uuid, game.playerPhysicsZeroVelocity);
        expect(physics.setCollisionBehavior).toHaveBeenCalledWith(player.uuid, CollisionBehavior.Ghost);
    });
});
