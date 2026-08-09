import {
    BoxGeometry,
    Group,
    Mesh,
    MeshStandardMaterial,
    Object3D,
    Texture,
    TextureLoader,
} from "three";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import GLTFLoaderExtended from "./GLTFLoaderExtended";
import type {TextureOverrides} from "../../../texture/TextureMapping";

type GLTFLoaderExtendedTextureOverrideAccess = {
    applyTextureOverrides(object: Group, overrides: TextureOverrides): Promise<void>;
};

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

const addDeepObjectChain = (root: Object3D, depth = 12_000): Object3D => {
    let current = root;

    for (let i = 0; i < depth; i++) {
        const child = new Object3D();
        current.add(child);
        current = child;
    }

    return current;
};

describe("GLTFLoaderExtended texture overrides", () => {
    beforeEach(() => {
        Object.defineProperty(URL, "createObjectURL", {
            configurable: true,
            value: vi.fn(() => "blob://texture"),
        });
        Object.defineProperty(URL, "revokeObjectURL", {
            configurable: true,
            value: vi.fn(),
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        Object.defineProperty(URL, "createObjectURL", {
            configurable: true,
            value: originalCreateObjectURL,
        });
        Object.defineProperty(URL, "revokeObjectURL", {
            configurable: true,
            value: originalRevokeObjectURL,
        });
    });

    it("deduplicates in-flight loads for override slots using the same texture ref", async () => {
        const texture = new Texture() as ReturnType<TextureLoader["load"]>;
        const loadSpy = vi.spyOn(TextureLoader.prototype, "load").mockImplementation(
            ((_url, onLoad) => {
                queueMicrotask(() => onLoad?.(texture));
                return texture;
            }) as TextureLoader["load"],
        );

        const material = new MeshStandardMaterial();
        const mesh = new Mesh(new BoxGeometry(), material);
        const object = new Group();
        object.add(mesh);

        const ref = {
            blob: new Blob(["texture"], {type: "image/png"}),
            path: "textures/shared.png",
        };

        const loader = new GLTFLoaderExtended() as unknown as GLTFLoaderExtendedTextureOverrideAccess;
        await loader.applyTextureOverrides(object, {
            map: ref,
            roughnessMap: ref,
        });

        expect(loadSpy).toHaveBeenCalledTimes(1);
        expect(material.map).toBe(texture);
        expect(material.roughnessMap).toBe(texture);
        expect(object.userData.textureOverrides).toEqual({
            map: true,
            roughnessMap: true,
        });
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob://texture");
    });

    it("applies overrides through deep hierarchies without recursive Object3D traversal", async () => {
        const texture = new Texture() as ReturnType<TextureLoader["load"]>;
        vi.spyOn(TextureLoader.prototype, "load").mockImplementation(
            ((_url, onLoad) => {
                queueMicrotask(() => onLoad?.(texture));
                return texture;
            }) as TextureLoader["load"],
        );

        const material = new MeshStandardMaterial();
        const mesh = new Mesh(new BoxGeometry(), material);
        const object = new Group();
        const leaf = addDeepObjectChain(object);
        leaf.add(mesh);
        const traverseSpy = vi.spyOn(object, "traverse");

        const loader = new GLTFLoaderExtended() as unknown as GLTFLoaderExtendedTextureOverrideAccess;
        await loader.applyTextureOverrides(object, {
            map: {
                blob: new Blob(["texture"], {type: "image/png"}),
                path: "textures/deep.png",
            },
        });

        expect(material.map).toBe(texture);
        expect(object.userData.textureOverrides).toEqual({map: true});
        expect(traverseSpy).not.toHaveBeenCalled();
    });
});
