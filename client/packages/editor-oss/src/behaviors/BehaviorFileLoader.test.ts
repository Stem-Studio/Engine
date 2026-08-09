import {describe, expect, it, vi} from "vitest";

import {BehaviorFileLoader} from "./BehaviorFileLoader";
import type {BehaviorConstructor} from "./Behavior";

const makeDeferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(res => {
        resolve = res;
    });
    return {promise, resolve};
};

describe("BehaviorFileLoader.loadBehaviorsBatch", () => {
    it("loads with bounded concurrency while preserving input order", async () => {
        const paths = [
            {folder: "a", main: "A.ts"},
            {folder: "b", main: "B.ts"},
            {folder: "c", main: "C.ts"},
            {folder: "d", main: "D.ts"},
        ];
        const pending = new Map<string, {
            promise: Promise<BehaviorConstructor | null>;
            resolve: (value: BehaviorConstructor | null) => void;
        }>();
        const started: string[] = [];
        const loader = {
            loadFile: vi.fn((folder: string, main: string) => {
                const key = `${folder}/${main}`;
                started.push(key);
                const deferred = makeDeferred<BehaviorConstructor | null>();
                pending.set(key, deferred);
                return deferred.promise;
            }),
        };

        const loadPromise = BehaviorFileLoader.prototype.loadBehaviorsBatch.call(
            loader as unknown as BehaviorFileLoader,
            paths,
            2,
        );

        await vi.waitFor(() => {
            expect(started).toEqual(["a/A.ts", "b/B.ts"]);
        });

        pending.get("b/B.ts")!.resolve("class-b" as unknown as BehaviorConstructor);
        await vi.waitFor(() => {
            expect(started).toContain("c/C.ts");
        });
        expect(started).not.toContain("d/D.ts");

        pending.get("a/A.ts")!.resolve("class-a" as unknown as BehaviorConstructor);
        await vi.waitFor(() => {
            expect(started).toContain("d/D.ts");
        });

        pending.get("c/C.ts")!.resolve("class-c" as unknown as BehaviorConstructor);
        pending.get("d/D.ts")!.resolve("class-d" as unknown as BehaviorConstructor);

        await expect(loadPromise).resolves.toEqual(["class-a", "class-b", "class-c", "class-d"]);
        expect(loader.loadFile).toHaveBeenCalledTimes(4);
    });

    it("returns an empty array without starting workers for an empty batch", async () => {
        const loader = {
            loadFile: vi.fn(),
        };

        await expect(
            BehaviorFileLoader.prototype.loadBehaviorsBatch.call(loader as unknown as BehaviorFileLoader, [], 8),
        ).resolves.toEqual([]);
        expect(loader.loadFile).not.toHaveBeenCalled();
    });
});
