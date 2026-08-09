import { Scene } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import PlayerEvent from "./PlayerEvent";

const createHarness = () => {
    const canvas = document.createElement("canvas");
    const app = {
        calls: [] as unknown[],
        game: {},
        physics: {
            physics: {
                getPhysicsEngineType: (): string | undefined => undefined,
            },
        },
        on: vi.fn(),
    };

    return {
        app,
        scene: new Scene(),
        camera: {},
        renderer: {
            domElement: canvas,
        },
    };
};

describe("PlayerEvent", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        delete (globalThis as {__erthAmmo__?: unknown}).__erthAmmo__;
        delete (globalThis as {requestAnimationFrame?: unknown}).requestAnimationFrame;
    });

    it("caches lifecycle handlers and calls only scripts that implement them", async () => {
        const { app, scene, camera, renderer } = createHarness();
        const playerEvent = new PlayerEvent(app);

        await playerEvent.create(scene, camera, renderer, {
            scripted: {
                source: `
                    function init() { app.calls.push("init"); }
                    function start() { app.calls.push("start"); }
                    function update(clock, deltaTime) { app.calls.push(["update", deltaTime]); }
                    function stop() { app.calls.push("stop"); }
                `,
            },
            noUpdate: {
                source: `
                    function start() { app.calls.push("start-only"); }
                `,
            },
        });

        expect(playerEvent.initHandlers).toHaveLength(1);
        expect(playerEvent.startHandlers).toHaveLength(2);
        expect(playerEvent.updateHandlers).toHaveLength(1);
        expect(playerEvent.stopHandlers).toHaveLength(1);

        playerEvent.init();
        playerEvent.start();
        playerEvent.update(null, 0.016);
        playerEvent.update(null, 0.032);
        playerEvent.stop();

        expect(app.calls).toEqual([
            "init",
            "start",
            "start-only",
            ["update", 0.016],
            ["update", 0.032],
            "stop",
        ]);
    });

    it("clears cached handlers on dispose", async () => {
        const { app, scene, camera, renderer } = createHarness();
        const playerEvent = new PlayerEvent(app);

        await playerEvent.create(scene, camera, renderer, {
            scripted: {
                source: `
                    function update() {}
                `,
            },
        });

        expect(playerEvent.updateHandlers).toHaveLength(1);

        playerEvent.dispose();

        expect(playerEvent.boundEventHandlers).toHaveLength(0);
        expect(playerEvent.updateHandlers).toHaveLength(0);
        expect(playerEvent.events).toHaveLength(0);
    });

    it("compiles and registers owned scripts in one pass", async () => {
        const { app, scene, camera, renderer } = createHarness();
        const playerEvent = new PlayerEvent(app);
        const order: string[] = [];
        const scripts = Object.create({
            inherited: {source: "inherited", event: {name: "inherited"}},
        });
        scripts.first = {source: "first", event: {name: "first"}};
        scripts.second = {source: "second", event: {name: "second"}};

        vi.spyOn(playerEvent as any, "createScriptEvent").mockImplementation((script: any) => {
            order.push(`compile:${script.event.name}`);
            return script.event;
        });
        vi.spyOn(playerEvent as any, "registerScriptEvent").mockImplementation((...args: unknown[]) => {
            const event = args[0] as {name: string};
            const index = args[1] as number;
            order.push(`register:${event.name}:${index}`);
        });

        await playerEvent.create(scene, camera, renderer, scripts);

        expect(playerEvent.events).toEqual([scripts.first.event, scripts.second.event]);
        expect(order).toEqual([
            "compile:first",
            "register:first:0",
            "compile:second",
            "register:second:1",
        ]);
    });

    it("yields while registering large script sets", async () => {
        const { app, scene, camera, renderer } = createHarness();
        const playerEvent = new PlayerEvent(app);
        const scripts: Record<string, {source: string}> = {};
        for (let i = 0; i < 9; i++) {
            scripts[`script-${i}`] = {source: `function update() { app.calls.push(${i}); }`};
        }
        const requestAnimationFrameSpy = vi.fn((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        }) as unknown as typeof requestAnimationFrame;
        (globalThis as {requestAnimationFrame?: typeof requestAnimationFrame}).requestAnimationFrame =
            requestAnimationFrameSpy;

        await playerEvent.create(scene, camera, renderer, scripts);

        expect(requestAnimationFrameSpy).toHaveBeenCalled();
        expect(playerEvent.events).toHaveLength(9);
        expect(playerEvent.updateHandlers).toHaveLength(9);
    });

    it("does not expose a stale Ammo singleton to Rapier scripts", async () => {
        const { app, scene, camera, renderer } = createHarness();
        app.physics.physics.getPhysicsEngineType = vi.fn(() => "rapier");
        const staleAmmo = { stale: true };
        (globalThis as {__erthAmmo__?: unknown}).__erthAmmo__ = staleAmmo;
        const playerEvent = new PlayerEvent(app);
        const createScriptEvent = vi.spyOn(playerEvent, "createScriptEvent");

        await playerEvent.create(scene, camera, renderer, { scripted: { source: "" } });

        expect(createScriptEvent).toHaveBeenCalledTimes(1);
        expect(createScriptEvent.mock.calls[0]?.[5]).toBeUndefined();
        delete (globalThis as {__erthAmmo__?: unknown}).__erthAmmo__;
    });
});
