import {describe, expect, it, vi} from "vitest";
import {Object3D, Vector3} from "three";

import {PHYSICS_EVENTS} from "../common/events";
import {BodyShapeType, type IDispatcher, type ObjectMotionState} from "../common/types";
import type {PreloadedPhysicsWorker} from "../PhysicsEngineFactory";
import PhysicsProxy from "./PhysicsProxy";

class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: ((event: MessageEvent) => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();
    private listeners = new Set<(event: MessageEvent) => void>();

    emit(data: unknown): void {
        const event = {data} as MessageEvent;
        for (const listener of [...this.listeners]) {
            listener(event);
        }
        this.onmessage?.(event);
    }

    addEventListener(type: string, listener: (event: MessageEvent) => void): void {
        if (type === "message") {
            this.listeners.add(listener);
        }
    }

    removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
        if (type === "message") {
            this.listeners.delete(listener);
        }
    }
}

function createSubject() {
    const worker = new FakeWorker();
    let isReady = false;
    const readyCallbacks: Array<() => void> = [];
    let resolveReady: () => void = () => {};
    const readyPromise = new Promise<void>(resolve => {
        resolveReady = resolve;
    });
    const readyListener = (event: MessageEvent<{event?: string}>) => {
        if (event.data.event !== PHYSICS_EVENTS.READY) {
            return;
        }
        isReady = true;
        worker.removeEventListener("message", readyListener);
        resolveReady();
        for (const callback of readyCallbacks.splice(0)) {
            callback();
        }
    };
    worker.addEventListener("message", readyListener);
    const dispatcher = {
        onReady: vi.fn(),
        onBodyUpdate: vi.fn(),
        onCollision: vi.fn(),
        onSimulationComplete: vi.fn(),
    } satisfies IDispatcher;
    const preloaded = {
        worker: worker as unknown as Worker,
        isReady: () => isReady,
        onReady: (callback: () => void) => {
            if (isReady) {
                callback();
            } else {
                readyCallbacks.push(callback);
            }
        },
        ready: readyPromise,
    } satisfies PreloadedPhysicsWorker;
    const proxy = new PhysicsProxy(dispatcher, -9.8, preloaded);
    const start = proxy.start();
    worker.emit({event: PHYSICS_EVENTS.READY});

    return {proxy, worker, dispatcher, start};
}

describe("PhysicsProxy body update batching", () => {
    it("fully detaches the worker and clears retained scene state on terminate", async () => {
        const {proxy, worker, start} = createSubject();
        await start;

        proxy.addShape("shape-a", {type: BodyShapeType.BOX, width: 1, height: 1, length: 1});
        const body = new Object3D();
        proxy.addBox(body, {
            uuid: "body-a",
            type: BodyShapeType.BOX,
            template: "",
            name: "Body",
            position: {x: 0, y: 0, z: 0},
            quaternion: {x: 0, y: 0, z: 0, w: 1},
            scale: {x: 1, y: 1, z: 1},
            mass: 1,
            friction: 0.5,
            rollingFriction: 0.5,
            spinningFriction: 0.5,
            contactStiffness: 0.5,
            contactDamping: 0.5,
            width: 1,
            height: 1,
            length: 1,
        });
        proxy.movePlayerObject("player-a", new Vector3(1, 0, 0), true);
        proxy.setLinearVelocity("body-a", new Vector3(2, 0, 0));
        void proxy.ping();

        proxy.terminate();

        const internal = proxy as any;
        expect(worker.onmessage).toBeNull();
        expect(worker.onerror).toBeNull();
        expect(worker.onmessageerror).toBeNull();
        expect(proxy.getDynamicBodyObject("body-a")).toBeUndefined();
        expect(internal.shapeUuids.size).toBe(0);
        expect(internal.shapeTypes.size).toBe(0);
        expect(internal.pingCallbacks.size).toBe(0);
        expect(internal.pendingPlayerMoves.size).toBe(0);
        expect(internal.pendingLinearVelocity.size).toBe(0);
        expect(internal.objectUpdates).toEqual({});

        proxy.terminate();
        expect(worker.terminate).toHaveBeenCalledOnce();
    });

    it("rejects dynamic concave bodies before local map registration or worker dispatch", async () => {
        const {proxy, worker, start} = createSubject();
        await start;
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            proxy.addShape("mesh-shape", {
                type: BodyShapeType.CONCAVE_HULL,
                vertices: [[0, 0, 0, 1, 0, 0, 0, 1, 0]],
                indexes: [[0, 1, 2]],
            });
            proxy.addBody(new Object3D(), "mesh-shape", {
                uuid: "dynamic-mesh",
                template: "",
                name: "Dynamic Mesh",
                position: {x: 0, y: 0, z: 0},
                quaternion: {x: 0, y: 0, z: 0, w: 1},
                scale: {x: 1, y: 1, z: 1},
                mass: 1,
                friction: 0.5,
                rollingFriction: 0.5,
                spinningFriction: 0.5,
                contactStiffness: 0.5,
                contactDamping: 0.5,
            });

            expect(proxy.getDynamicBodyObject("dynamic-mesh")).toBeUndefined();
            expect(worker.postMessage).toHaveBeenCalledTimes(1);
            expect(warn).toHaveBeenCalledWith(expect.stringContaining("concave hull"));
        } finally {
            warn.mockRestore();
            proxy.terminate();
        }
    });

    it("dispatches and resolves READY once when both listener paths receive it", async () => {
        const {proxy, worker, dispatcher, start} = createSubject();
        const resolved = vi.fn();
        void start.then(resolved);
        await start;
        worker.emit({event: PHYSICS_EVENTS.READY});
        await Promise.resolve();

        expect(dispatcher.onReady).toHaveBeenCalledOnce();
        expect(resolved).toHaveBeenCalledOnce();
    });

    it("forwards shape replacement only for a known worker shape", async () => {
        const {proxy, worker, start} = createSubject();
        await start;

        proxy.setRigidBodyShape("body-a", "shape-a");
        expect(worker.postMessage).not.toHaveBeenCalledWith({
            event: PHYSICS_EVENTS.SET.SHAPE,
            uuid: "body-a",
            newShapeUuid: "shape-a",
        });

        proxy.addShape("shape-a", {type: BodyShapeType.BOX, width: 1, height: 1, length: 1});
        proxy.setRigidBodyShape("body-a", "shape-a");

        expect(worker.postMessage).toHaveBeenLastCalledWith({
            event: PHYSICS_EVENTS.SET.SHAPE,
            uuid: "body-a",
            newShapeUuid: "shape-a",
        });
    });

    it("forwards character kicks through the worker transport", async () => {
        const {proxy, worker, start} = createSubject();
        await start;

        proxy.kickNearbyObjects("character-a", 5);

        expect(worker.postMessage).toHaveBeenLastCalledWith({
            event: PHYSICS_EVENTS.APPLY.KICK_NEARBY_OBJECTS,
            uuid: "character-a",
            kickImpulse: 5,
        });
    });

    it("forwards solver quality changes through the worker transport", async () => {
        const {proxy, worker, start} = createSubject();
        await start;

        proxy.setSolverIterations(7);

        expect(worker.postMessage).toHaveBeenLastCalledWith({
            event: PHYSICS_EVENTS.SET.SOLVER_ITERATIONS,
            solverIterations: 7,
        });
    });

    it("consumes a body batch and retains individual updates as a compatibility fallback", async () => {
        const {proxy, worker, dispatcher, start} = createSubject();
        await start;
        const motionState = {
            linearVelocity: {x: 2, y: 0, z: 0},
            angularVelocity: {x: 0, y: 1.5, z: 0},
        } as ObjectMotionState;
        const update = {
            uuid: "body-a",
            position: {x: 1, y: 2, z: 3},
            quaternion: {x: 0, y: 0, z: 0, w: 1},
            scale: {x: 1, y: 1, z: 1},
            motionState,
            dt: 1 / 60,
        };

        worker.emit({
            event: PHYSICS_EVENTS.BODY.UPDATE_BATCH,
            updates: [update, {...update, uuid: "body-b"}],
        });
        worker.emit({event: PHYSICS_EVENTS.BODY.UPDATE, ...update, uuid: "legacy-body"});

        expect(dispatcher.onBodyUpdate).toHaveBeenCalledTimes(3);
        expect(dispatcher.onBodyUpdate).toHaveBeenNthCalledWith(
            1,
            "body-a",
            update.position,
            update.quaternion,
            update.scale,
            update.dt,
            motionState,
        );
        expect(dispatcher.onBodyUpdate).toHaveBeenLastCalledWith(
            "legacy-body",
            update.position,
            update.quaternion,
            update.scale,
            update.dt,
            motionState,
        );
        expect(proxy.getLinearVelocity("body-a")).toEqual(motionState.linearVelocity);
        expect(proxy.getAngularVelocity("body-a")).toEqual(motionState.angularVelocity);

        proxy.remove("body-a");
        expect(proxy.getLinearVelocity("body-a")).toBeNull();
        expect(proxy.getAngularVelocity("body-a")).toBeNull();
    });

    it("preserves pause ordering and simulate back-pressure until SIMULATE_DONE", async () => {
        const {proxy, worker, start} = createSubject();
        await start;

        proxy.simulate(0.01);
        proxy.simulate(0.02);
        proxy.pause();

        expect(worker.postMessage.mock.calls.map(call => call[0].event)).toEqual([
            PHYSICS_EVENTS.BATCH.UPDATE,
            PHYSICS_EVENTS.SIMULATE,
        ]);

        worker.emit({event: PHYSICS_EVENTS.SIMULATE_DONE});

        expect(worker.postMessage.mock.calls.map(call => call[0].event)).toEqual([
            PHYSICS_EVENTS.BATCH.UPDATE,
            PHYSICS_EVENTS.SIMULATE,
            PHYSICS_EVENTS.PAUSE,
        ]);

        proxy.simulate(0.01);
        expect(worker.postMessage).toHaveBeenLastCalledWith({
            event: PHYSICS_EVENTS.SIMULATE,
            deltaTime: 0.03,
        });
    });

    it("preserves authoritative catch-up steps and dispatches the next immediately on ack", async () => {
        const {proxy, worker, dispatcher, start} = createSubject();
        await start;

        expect(proxy.simulateFixedStep(1 / 60, 2)).toBe(true);
        expect(proxy.simulateFixedStep(1 / 60, 2)).toBe(true);
        expect(proxy.simulateFixedStep(1 / 60, 2)).toBe(true);
        expect(
            worker.postMessage.mock.calls.filter(call => call[0].event === PHYSICS_EVENTS.SIMULATE),
        ).toHaveLength(1);

        worker.emit({
            event: PHYSICS_EVENTS.SIMULATE_DONE,
            authoritativeFixedStep: true,
            deltaTime: 1 / 60,
        });

        expect(dispatcher.onSimulationComplete).toHaveBeenCalledTimes(1);
        const simulateMessages = worker.postMessage.mock.calls
            .map(call => call[0])
            .filter(message => message.event === PHYSICS_EVENTS.SIMULATE);
        expect(simulateMessages).toHaveLength(2);
        expect(simulateMessages).toEqual([
            expect.objectContaining({deltaTime: 1 / 60, substeps: 2, authoritativeFixedStep: true}),
            expect.objectContaining({deltaTime: 1 / 60, substeps: 2, authoritativeFixedStep: true}),
        ]);
        const secondSimulateCall = worker.postMessage.mock.calls.findIndex(
            (call, index) =>
                index > 1 &&
                call[0].event === PHYSICS_EVENTS.SIMULATE,
        );
        expect(dispatcher.onSimulationComplete.mock.invocationCallOrder[0]).toBeLessThan(
            worker.postMessage.mock.invocationCallOrder[secondSimulateCall]!,
        );

        worker.emit({
            event: PHYSICS_EVENTS.SIMULATE_DONE,
            authoritativeFixedStep: true,
            deltaTime: 1 / 60,
        });
        worker.emit({
            event: PHYSICS_EVENTS.SIMULATE_DONE,
            authoritativeFixedStep: true,
            deltaTime: 1 / 60,
        });
        expect(dispatcher.onSimulationComplete).toHaveBeenCalledTimes(3);
        expect(
            worker.postMessage.mock.calls.filter(call => call[0].event === PHYSICS_EVENTS.SIMULATE),
        ).toHaveLength(3);
    });

    it("delivers body updates before authoritative completion", async () => {
        const {proxy, worker, dispatcher, start} = createSubject();
        await start;
        proxy.simulateFixedStep(1 / 60, 1);
        const update = {
            uuid: "body-a",
            position: {x: 1, y: 2, z: 3},
            quaternion: {x: 0, y: 0, z: 0, w: 1},
            scale: {x: 1, y: 1, z: 1},
            dt: 1 / 60,
        };

        worker.emit({event: PHYSICS_EVENTS.BODY.UPDATE_BATCH, updates: [update]});
        worker.emit({
            event: PHYSICS_EVENTS.SIMULATE_DONE,
            authoritativeFixedStep: true,
            deltaTime: 1 / 60,
        });

        expect(dispatcher.onBodyUpdate.mock.invocationCallOrder[0]).toBeLessThan(
            dispatcher.onSimulationComplete.mock.invocationCallOrder[0]!,
        );
    });

    it("bounds the authoritative backlog and clears queued completions on pause", async () => {
        const {proxy, worker, dispatcher, start} = createSubject();
        await start;
        const accepted: boolean[] = [];
        for (let step = 0; step < 34; step++) {
            accepted.push(proxy.simulateFixedStep(1 / 60, 1));
        }
        expect(accepted.filter(Boolean)).toHaveLength(33);
        expect(accepted.at(-1)).toBe(false);

        proxy.pause();
        worker.emit({
            event: PHYSICS_EVENTS.SIMULATE_DONE,
            authoritativeFixedStep: true,
            deltaTime: 1 / 60,
        });

        expect(dispatcher.onSimulationComplete).not.toHaveBeenCalled();
        expect(
            worker.postMessage.mock.calls.filter(call => call[0].event === PHYSICS_EVENTS.SIMULATE),
        ).toHaveLength(1);
    });
});
