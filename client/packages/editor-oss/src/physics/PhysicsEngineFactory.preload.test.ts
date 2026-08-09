import {describe, expect, it, vi, afterEach} from "vitest";

import {PhysicsEngineType} from "./common/types";
import {PhysicsEngineFactory} from "./PhysicsEngineFactory";

const {fakeWorkers} = vi.hoisted(() => ({
    fakeWorkers: [] as Array<{
        postMessage: ReturnType<typeof vi.fn>;
        terminate: ReturnType<typeof vi.fn>;
        addEventListener: (event: string, listener: (message: MessageEvent) => void) => void;
        removeEventListener: (event: string, listener: (message: MessageEvent) => void) => void;
        emitReady: () => void;
    }>,
}));

vi.mock("./worker/PhysicsWorker.ts?worker", () => {
    return {
        default: class FakePhysicsWorker {
            postMessage = vi.fn();
            terminate = vi.fn();
            private listeners = new Set<(message: MessageEvent) => void>();

            constructor() {
                fakeWorkers.push(this);
            }

            addEventListener(event: string, listener: (message: MessageEvent) => void) {
                if (event === "message") {
                    this.listeners.add(listener);
                }
            }

            removeEventListener(event: string, listener: (message: MessageEvent) => void) {
                if (event === "message") {
                    this.listeners.delete(listener);
                }
            }

            emitReady() {
                const message = {data: {event: "physics:ready"}} as MessageEvent;
                for (const listener of [...this.listeners]) {
                    listener(message);
                }
            }
        },
    };
});

describe("PhysicsEngineFactory preload worker", () => {
    afterEach(() => {
        fakeWorkers.splice(0);
        (PhysicsEngineFactory as unknown as {workerCache: unknown}).workerCache = null;
    });

    it("keeps the worker preload promise pending until the worker is ready", async () => {
        const handle = await PhysicsEngineFactory.preloadWorker(PhysicsEngineType.Ammo, -9.8);
        let ready = false;
        handle.ready.then(() => {
            ready = true;
        });

        await Promise.resolve();
        expect(ready).toBe(false);

        fakeWorkers[0]!.emitReady();
        await handle.ready;

        expect(ready).toBe(true);
        expect(handle.isReady()).toBe(true);
    });

    it("reuses only when engine type and gravity match", async () => {
        const first = PhysicsEngineFactory.preloadWorker(PhysicsEngineType.Ammo, -9.8);
        const sameGravity = PhysicsEngineFactory.preloadWorker(PhysicsEngineType.Ammo, -9.8);

        expect(sameGravity).toBe(first);
        await first;
        expect(fakeWorkers).toHaveLength(1);

        const changedGravity = PhysicsEngineFactory.preloadWorker(PhysicsEngineType.Ammo, -24);
        expect(changedGravity).not.toBe(first);
        await Promise.resolve();
        expect(fakeWorkers[0]?.terminate).toHaveBeenCalledOnce();
        await changedGravity;
        expect(fakeWorkers).toHaveLength(2);
    });

    it("keys preloads by solver quality and forwards it to the worker", async () => {
        const first = PhysicsEngineFactory.preloadWorker(PhysicsEngineType.Ammo, -9.8, 6);
        const sameQuality = PhysicsEngineFactory.preloadWorker(PhysicsEngineType.Ammo, -9.8, 6);

        expect(sameQuality).toBe(first);
        await vi.waitFor(() => expect(fakeWorkers).toHaveLength(1));
        expect(fakeWorkers[0]?.postMessage).toHaveBeenCalledWith({
            event: "physics:start",
            engineType: PhysicsEngineType.Ammo,
            options: {gravity: -9.8, solverIterations: 6},
        });

        const changedQuality = PhysicsEngineFactory.preloadWorker(PhysicsEngineType.Ammo, -9.8, 7);
        expect(changedQuality).not.toBe(first);
        await Promise.resolve();
        expect(fakeWorkers[0]?.terminate).toHaveBeenCalledOnce();
        await changedQuality;
        expect(fakeWorkers).toHaveLength(2);
    });
});
