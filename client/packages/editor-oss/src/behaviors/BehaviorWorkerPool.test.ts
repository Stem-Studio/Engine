import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import type {Behavior} from "./Behavior";
import {resetActiveWorkerCount} from "./worker/BehaviorWorkerBridge";
import {BehaviorWorkerPool} from "./worker/BehaviorWorkerPool";

class MockWorker {
    static instances: MockWorker[] = [];

    onmessage: ((event: MessageEvent) => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();

    constructor() {
        MockWorker.instances.push(this);
    }

    respond(type: string, data: unknown): void {
        this.onmessage?.({data: {type, data}} as MessageEvent);
    }
}

function createBehavior(): Behavior {
    return {
        id: "test.behavior",
        uuid: "test-uuid",
        onWorkerMessage: vi.fn(),
    } as unknown as Behavior;
}

describe("BehaviorWorkerPool", () => {
    beforeEach(() => {
        resetActiveWorkerCount();
        MockWorker.instances = [];
    });

    afterEach(() => {
        resetActiveWorkerCount();
        vi.restoreAllMocks();
    });

    it("drains queued jobs in FIFO order without shifting the pending queue", () => {
        const behavior = createBehavior();
        const pool = new BehaviorWorkerPool(behavior, "test-pool", {count: 1}) as unknown as {
            init(WorkerConstructor: new () => Worker): boolean;
            sendMessage(type: string, data: unknown): void;
            queue: Array<{type: string; data: unknown}>;
            dispose(): void;
        };

        expect(pool.init(MockWorker as unknown as new () => Worker)).toBe(true);
        const worker = MockWorker.instances[0]!;

        pool.sendMessage("job", {id: 1});
        pool.sendMessage("job", {id: 2});
        pool.sendMessage("job", {id: 3});

        expect(worker.postMessage).toHaveBeenCalledTimes(1);
        expect(worker.postMessage).toHaveBeenLastCalledWith({type: "job", data: {id: 1}});

        const shiftSpy = vi.spyOn(pool.queue, "shift");

        worker.respond("done", {id: 1});
        expect(worker.postMessage).toHaveBeenCalledTimes(2);
        expect(worker.postMessage).toHaveBeenLastCalledWith({type: "job", data: {id: 2}});

        worker.respond("done", {id: 2});
        expect(worker.postMessage).toHaveBeenCalledTimes(3);
        expect(worker.postMessage).toHaveBeenLastCalledWith({type: "job", data: {id: 3}});

        worker.respond("done", {id: 3});

        expect(shiftSpy).not.toHaveBeenCalled();
        expect(behavior.onWorkerMessage).toHaveBeenCalledTimes(3);
        expect(pool.queue).toHaveLength(0);

        shiftSpy.mockRestore();
        pool.dispose();
    });

    it("dispatches jobs across free workers before queuing", () => {
        const behavior = createBehavior();
        const pool = new BehaviorWorkerPool(behavior, "test-pool", {count: 2});

        expect(pool.init(MockWorker as unknown as new () => Worker)).toBe(true);
        const first = MockWorker.instances[0]!;
        const second = MockWorker.instances[1]!;

        pool.sendMessage("job", {id: 1});
        pool.sendMessage("job", {id: 2});

        expect(first.postMessage).toHaveBeenCalledWith({type: "job", data: {id: 1}});
        expect(second.postMessage).toHaveBeenCalledWith({type: "job", data: {id: 2}});

        pool.dispose();
    });
});
