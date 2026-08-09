import {Object3D} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import {collectParticleEmitterObjects} from "./editorPreviewVisuals";

describe("editorPreviewVisuals", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("collects particle emitters without Three's recursive traverse", () => {
        const root = new Object3D();
        const nested = new Object3D();
        const rootEmitter = Object.assign(new Object3D(), {system: {id: "root"}});
        const nestedEmitter = Object.assign(new Object3D(), {system: {id: "nested"}});
        root.add(rootEmitter);
        root.add(nested);
        nested.add(nestedEmitter);
        vi.spyOn(Object3D.prototype, "traverse").mockImplementation(() => {
            throw new Error("recursive Object3D.traverse should not be used");
        });

        expect(collectParticleEmitterObjects(root)).toEqual([rootEmitter, nestedEmitter]);
    });
});
