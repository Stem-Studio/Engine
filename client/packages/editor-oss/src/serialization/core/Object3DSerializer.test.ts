import {Object3D} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import Object3DSerializer from "./Object3DSerializer";

describe("Object3DSerializer", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("omits default Object3D properties without stringifying every field", () => {
        const object = new Object3D();
        const stringify = vi.spyOn(JSON, "stringify");

        const json = new Object3DSerializer().toJSON(object) as any;
        const stringifyCalls = stringify.mock.calls.length;

        expect(stringifyCalls).toBe(0);
        expect(json.uuid).toBe(object.uuid);
        expect(json.position).toBeUndefined();
        expect(json.quaternion).toBeUndefined();
        expect(json.rotation).toBeUndefined();
        expect(json.scale).toBeUndefined();
        expect(json.visible).toBeUndefined();
        expect(json.type).toBeUndefined();
    });

    it("serializes non-default transforms and parent data compatibly", () => {
        const parent = new Object3D();
        const object = new Object3D();
        parent.add(object);
        object.name = "SerializedObject";
        object.position.set(1, 2, 3);
        object.rotation.set(0.25, 0.5, 0.75, "YXZ");
        object.scale.set(2, 3, 4);
        object.up.set(0, 0, 1);
        object.visible = false;

        const json = new Object3DSerializer().toJSON(object) as any;

        expect(json.parent).toBe(parent.uuid);
        expect(json.name).toBe("SerializedObject");
        expect(json.position).toBe(object.position);
        expect(json.rotation).toEqual({
            x: object.rotation.x,
            y: object.rotation.y,
            z: object.rotation.z,
            order: object.rotation.order,
        });
        expect(json.scale).toBe(object.scale);
        expect(json.up).toBe(object.up);
        expect(json.visible).toBe(false);
    });

    it("restores copied transform fields and parent uuid from json", () => {
        const parent = new Object3D();
        const object = new Object3D();
        parent.add(object);
        object.position.set(4, 5, 6);
        object.rotation.set(0.1, 0.2, 0.3, "ZYX");
        object.scale.set(1.5, 2.5, 3.5);
        object.up.set(0, 0, 1);

        const json = new Object3DSerializer().toJSON(object) as any;
        const restored = new Object3DSerializer().fromJSON(json);

        expect(restored.uuid).toBe(object.uuid);
        expect(restored.parentUuid).toBe(parent.uuid);
        expect(restored.position.equals(object.position)).toBe(true);
        expect(restored.rotation.equals(object.rotation)).toBe(true);
        expect(restored.scale.equals(object.scale)).toBe(true);
        expect(restored.up.equals(object.up)).toBe(true);
    });
});
