import {Object3D} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import {capturePlaymodeSnapshot, capturePlaymodeSnapshotAsync, diffPlaymodeSnapshot} from "./playmodeSnapshot";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("capturePlaymodeSnapshot", () => {
    it("clones behavior attributes without JSON.stringify when structuredClone fails", () => {
        vi.stubGlobal("structuredClone", vi.fn(() => {
            throw new Error("structuredClone unavailable");
        }));
        const stringifySpy = vi.spyOn(JSON, "stringify");
        const scene = new Object3D();
        const object = new Object3D();
        scene.add(object);
        object.userData.behaviors = [{
            uuid: "behavior-1",
            id: "test.behavior",
            attributesData: {
                nested: {speed: 4},
                values: [1, undefined, Number.NaN],
                ignored: undefined,
            },
        }];

        const snapshot = capturePlaymodeSnapshot(scene);
        const behaviorSnapshot = snapshot.objects.get(object.uuid)?.behaviors?.[0];

        expect(stringifySpy).not.toHaveBeenCalled();
        expect(behaviorSnapshot?.attributesData).toEqual({
            nested: {speed: 4},
            values: [1, null, null],
        });

        object.userData.behaviors[0].attributesData.nested.speed = 9;
        expect(behaviorSnapshot?.attributesData).toEqual({
            nested: {speed: 4},
            values: [1, null, null],
        });
    });

    it("diffs behavior attributes with JSON-compatible equality without JSON.stringify", () => {
        const scene = new Object3D();
        const object = new Object3D();
        scene.add(object);
        object.userData.behaviors = [{
            uuid: "behavior-1",
            id: "test.behavior",
            attributesData: {
                nested: {speed: 4},
                values: [1, undefined, Number.NaN],
                ignored: undefined,
            },
        }];
        const snapshot = capturePlaymodeSnapshot(scene);
        object.userData.behaviors[0].attributesData = {
            nested: {speed: 4},
            values: [1, null, null],
        };
        const stringifySpy = vi.spyOn(JSON, "stringify");

        expect(diffPlaymodeSnapshot(scene, snapshot).behaviorAttributes).toEqual([]);
        expect(stringifySpy).not.toHaveBeenCalled();

        object.userData.behaviors[0].attributesData.nested.speed = 5;
        expect(diffPlaymodeSnapshot(scene, snapshot).behaviorAttributes).toEqual([{
            uuid: object.uuid,
            objectName: object.type,
            behaviorUuid: "behavior-1",
            behaviorId: "test.behavior",
            key: "nested",
            before: {speed: 4},
            after: {speed: 5},
        }]);
        expect(stringifySpy).not.toHaveBeenCalled();
    });

    it("diffs deeply nested scenes without Three recursive traversal", () => {
        const scene = new Object3D();
        let cursor = scene;
        for (let i = 0; i < 12000; i++) {
            const child = new Object3D();
            cursor.add(child);
            cursor = child;
        }
        const snapshot = capturePlaymodeSnapshot(scene);
        cursor.position.x = 42;
        const traverseSpy = vi.spyOn(scene, "traverse");

        const diff = diffPlaymodeSnapshot(scene, snapshot);

        expect(diff.transforms).toHaveLength(1);
        expect(diff.transforms[0]?.uuid).toBe(cursor.uuid);
        expect(traverseSpy).not.toHaveBeenCalled();
    });

    it("async capture yields while preserving captured objects", async () => {
        const requestAnimationFrameSpy = vi.fn((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        });
        vi.stubGlobal("requestAnimationFrame", requestAnimationFrameSpy);

        const scene = new Object3D();
        for (let i = 0; i < 260; i++) {
            const child = new Object3D();
            child.name = `child-${i}`;
            scene.add(child);
        }

        const snapshot = await capturePlaymodeSnapshotAsync(scene);

        expect(requestAnimationFrameSpy).toHaveBeenCalled();
        expect(snapshot.objects.size).toBe(261);
        expect(snapshot.objects.get(scene.uuid)?.depth).toBe(0);
        expect([...snapshot.objects.values()].filter(snap => snap.depth === 1)).toHaveLength(260);
    });
});
