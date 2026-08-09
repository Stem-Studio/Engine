import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {PHYSICS_EVENTS} from "../common/events";
import type {IPhysics, ObjectMotionState} from "../common/types";

const {createLegacyPhysicsAdapterMock} = vi.hoisted(() => ({
    createLegacyPhysicsAdapterMock: vi.fn(),
}));

vi.mock("../PhysicsEngineFactory", () => ({
    PhysicsEngineFactory: {
        createLegacyPhysicsAdapter: createLegacyPhysicsAdapterMock,
    },
}));

const postMessageMock = vi.fn();

describe("PhysicsWorker body update batching", () => {
    beforeEach(() => {
        postMessageMock.mockClear();
        createLegacyPhysicsAdapterMock.mockReset();
        vi.stubGlobal("postMessage", postMessageMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    async function createSubject(simulate: (deltaTime: number) => void) {
        const {PhysicsWorker} = await import("./PhysicsWorker");
        const subject = new PhysicsWorker();
        (subject as unknown as {physics: IPhysics}).physics = {simulate} as IPhysics;
        return subject;
    }

    it("posts one outbound transform batch for all bodies before SIMULATE_DONE", async () => {
        let subject: Awaited<ReturnType<typeof createSubject>>;
        subject = await createSubject(() => {
            const dispatcher = (subject as unknown as {
                dispatcher: {
                    onBodyUpdate(
                        uuid: string,
                        position: {x: number; y: number; z: number},
                        rotation: {x: number; y: number; z: number; w: number},
                        scale: {x: number; y: number; z: number},
                        dt: number,
                        motionState: ObjectMotionState,
                    ): void;
                };
            }).dispatcher;
            const motionState = {linearVelocity: {x: 1, y: 0, z: 0}} as ObjectMotionState;
            dispatcher.onBodyUpdate("body-a", {x: 1, y: 2, z: 3}, {x: 0, y: 0, z: 0, w: 1}, {x: 1, y: 1, z: 1}, 1 / 60, motionState);
            dispatcher.onBodyUpdate("body-b", {x: 4, y: 5, z: 6}, {x: 0, y: 0, z: 0, w: 1}, {x: 2, y: 2, z: 2}, 1 / 60, motionState);
        });

        subject.onmessage({data: {event: PHYSICS_EVENTS.SIMULATE, deltaTime: 1 / 60}});

        expect(postMessageMock).toHaveBeenCalledTimes(2);
        expect(postMessageMock.mock.calls[0]![0]).toMatchObject({
            event: PHYSICS_EVENTS.BODY.UPDATE_BATCH,
            updates: [
                {uuid: "body-a", position: {x: 1, y: 2, z: 3}},
                {uuid: "body-b", position: {x: 4, y: 5, z: 6}},
            ],
        });
        expect(postMessageMock.mock.calls[1]![0]).toEqual({
            event: PHYSICS_EVENTS.SIMULATE_DONE,
            authoritativeFixedStep: false,
            deltaTime: 1 / 60,
        });
    });

    it("has the legacy adapter as the single READY owner during worker start", async () => {
        const {PhysicsWorker} = await import("./PhysicsWorker");
        const subject = new PhysicsWorker();
        createLegacyPhysicsAdapterMock.mockImplementation(
            (_engineType: unknown, dispatcher: {onReady(): void}) => Promise.resolve({
                start: () => {
                    dispatcher.onReady();
                    return Promise.resolve();
                },
            }),
        );

        subject.onmessage({
            data: {
                event: PHYSICS_EVENTS.START,
                engineType: "ammo",
                options: {gravity: -9.8},
            },
        });
        await vi.waitFor(() => {
            expect(postMessageMock).toHaveBeenCalledWith({event: PHYSICS_EVENTS.READY});
        });

        expect(
            postMessageMock.mock.calls.filter(call => call[0].event === PHYSICS_EVENTS.READY),
        ).toHaveLength(1);
    });

    it("acks a paused step without simulating or emitting an empty transform batch", async () => {
        const simulate = vi.fn();
        const subject = await createSubject(simulate);

        subject.onmessage({data: {event: PHYSICS_EVENTS.PAUSE}});
        postMessageMock.mockClear();
        subject.onmessage({data: {event: PHYSICS_EVENTS.SIMULATE, deltaTime: 1 / 60}});

        expect(simulate).not.toHaveBeenCalled();
        expect(postMessageMock).toHaveBeenCalledOnce();
        expect(postMessageMock).toHaveBeenCalledWith({
            event: PHYSICS_EVENTS.SIMULATE_DONE,
            authoritativeFixedStep: false,
            deltaTime: 1 / 60,
        });
    });

    it("forwards worker shape replacement to the adapter", async () => {
        const setRigidBodyShape = vi.fn();
        const subject = await createSubject(() => {});
        (subject as unknown as {physics: IPhysics}).physics = {setRigidBodyShape} as unknown as IPhysics;

        subject.onmessage({
            data: {
                event: PHYSICS_EVENTS.SET.SHAPE,
                uuid: "body-a",
                newShapeUuid: "shape-b",
            },
        });

        expect(setRigidBodyShape).toHaveBeenCalledOnce();
        expect(setRigidBodyShape).toHaveBeenCalledWith("body-a", "shape-b");
    });

    it("forwards character kicks to the adapter", async () => {
        const kickNearbyObjects = vi.fn();
        const subject = await createSubject(() => {});
        (subject as unknown as {physics: IPhysics}).physics = {kickNearbyObjects} as unknown as IPhysics;

        subject.onmessage({
            data: {
                event: PHYSICS_EVENTS.APPLY.KICK_NEARBY_OBJECTS,
                uuid: "character-a",
                kickImpulse: 5,
            },
        });

        expect(kickNearbyObjects).toHaveBeenCalledOnce();
        expect(kickNearbyObjects).toHaveBeenCalledWith("character-a", 5);
    });

    it("forwards solver quality changes to the adapter", async () => {
        const setSolverIterations = vi.fn();
        const subject = await createSubject(() => {});
        (subject as unknown as {physics: IPhysics}).physics = {setSolverIterations} as unknown as IPhysics;

        subject.onmessage({
            data: {
                event: PHYSICS_EVENTS.SET.SOLVER_ITERATIONS,
                solverIterations: 7,
            },
        });

        expect(setSolverIterations).toHaveBeenCalledOnce();
        expect(setSolverIterations).toHaveBeenCalledWith(7);
    });

    it("acks a step even if the physics engine throws", async () => {
        const subject = await createSubject(() => {
            throw new Error("simulate failed");
        });
        vi.spyOn(console, "error").mockImplementation(() => {});

        subject.onmessage({data: {event: PHYSICS_EVENTS.SIMULATE, deltaTime: 1 / 60}});

        expect(postMessageMock).toHaveBeenLastCalledWith({
            event: PHYSICS_EVENTS.SIMULATE_DONE,
            authoritativeFixedStep: false,
            deltaTime: 1 / 60,
        });
    });

    it("keeps worker debug drawing opt-in and transfers one frame per step", async () => {
        const initDebug = vi.fn();
        const vertices = new Float32Array([0, 0, 0, 1, 0, 0]);
        const colors = new Float32Array([1, 0, 0, 1, 0, 1, 0, 1]);
        const getDebugRenderData = vi.fn(() => ({vertices, colors, drawCount: 2}));
        const subject = await createSubject(() => {});
        (subject as unknown as {physics: IPhysics}).physics = {
            simulate: vi.fn(),
            initDebug,
            getDebugRenderData,
        } as unknown as IPhysics;

        subject.onmessage({data: {event: PHYSICS_EVENTS.DEBUG.ENABLE}});
        expect(initDebug).toHaveBeenCalledOnce();
        expect(postMessageMock).not.toHaveBeenCalled();

        subject.onmessage({data: {event: PHYSICS_EVENTS.SIMULATE, deltaTime: 1 / 60}});

        expect(getDebugRenderData).toHaveBeenCalledOnce();
        expect(postMessageMock).toHaveBeenNthCalledWith(
            1,
            {
                event: PHYSICS_EVENTS.DEBUG.FRAME,
                vertices,
                colors,
                drawCount: 2,
            },
            [vertices.buffer, colors.buffer],
        );
        expect(postMessageMock).toHaveBeenLastCalledWith({
            event: PHYSICS_EVENTS.SIMULATE_DONE,
            authoritativeFixedStep: false,
            deltaTime: 1 / 60,
        });
    });

    it("executes authoritative substeps before one completion ack", async () => {
        const simulate = vi.fn();
        const subject = await createSubject(simulate);

        subject.onmessage({
            data: {
                event: PHYSICS_EVENTS.SIMULATE,
                deltaTime: 1 / 30,
                substeps: 2,
                authoritativeFixedStep: true,
            },
        });

        expect(simulate).toHaveBeenCalledTimes(2);
        expect(simulate).toHaveBeenNthCalledWith(1, 1 / 60);
        expect(simulate).toHaveBeenNthCalledWith(2, 1 / 60);
        expect(postMessageMock).toHaveBeenLastCalledWith({
            event: PHYSICS_EVENTS.SIMULATE_DONE,
            authoritativeFixedStep: true,
            deltaTime: 1 / 30,
        });
    });
});
