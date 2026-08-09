import {Texture} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import TextureSerializer from "./TextureSerializer";

describe("TextureSerializer", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("omits default texture properties without stringifying every field", () => {
        const texture = new Texture();
        const stringify = vi.spyOn(JSON, "stringify");

        const json = new TextureSerializer().toJSON(texture) as any;
        const stringifyCalls = stringify.mock.calls.length;

        expect(stringifyCalls).toBe(0);
        expect(json.uuid).toBe(texture.uuid);
        expect(json.type).toBeUndefined();
        expect(json.offset).toBeUndefined();
        expect(json.repeat).toBeUndefined();
        expect(json.center).toBeUndefined();
        expect(json.userData).toBeUndefined();
    });

    it("serializes non-default vector and scalar fields compatibly", () => {
        const texture = new Texture();
        texture.name = "Serialized Texture";
        texture.offset.set(0.25, 0.5);
        texture.repeat.set(2, 3);
        texture.center.set(0.5, 0.5);
        texture.rotation = Math.PI / 4;
        texture.flipY = false;
        texture.userData = {imageId: "asset-1", custom: true};

        const json = new TextureSerializer().toJSON(texture) as any;

        expect(json.name).toBe("Serialized Texture");
        expect(json.offset).toEqual([0.25, 0.5]);
        expect(json.repeat).toEqual([2, 3]);
        expect(json.center).toEqual([0.5, 0.5]);
        expect(json.rotation).toBe(Math.PI / 4);
        expect(json.flipY).toBe(false);
        expect(json.userData).toEqual({imageId: "asset-1", custom: true});
    });

    it("restores serialized vector fields and scalar values", () => {
        const texture = new Texture();
        texture.offset.set(0.1, 0.2);
        texture.repeat.set(4, 5);
        texture.center.set(0.25, 0.75);
        texture.rotation = 1.25;

        const json = new TextureSerializer().toJSON(texture) as any;
        const restored = new TextureSerializer().fromJSON(json, new Texture(document.createElement("img")), {}) as Texture;

        expect(restored.offset.equals(texture.offset)).toBe(true);
        expect(restored.repeat.equals(texture.repeat)).toBe(true);
        expect(restored.center.equals(texture.center)).toBe(true);
        expect(restored.rotation).toBe(1.25);
    });
});
