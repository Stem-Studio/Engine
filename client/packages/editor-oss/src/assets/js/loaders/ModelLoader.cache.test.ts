import {BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, Object3D} from "three";
import {beforeEach, describe, expect, it, vi} from "vitest";

const hoisted = vi.hoisted(() => ({
    load: vi.fn(),
    dispose: vi.fn(),
}));

vi.mock("./GLTFLoader", () => {
    return {
        default: class FakeGLTFLoader {
            load = hoisted.load;
            dispose = hoisted.dispose;
        },
    };
});

vi.mock("../../../utils/DetectDevice", () => ({
    DetectDevice: {
        isIOS: () => false,
        isMobile: () => false,
    },
}));

import ModelLoader from "./ModelLoader";

describe("ModelLoader cache", () => {
    beforeEach(() => {
        ModelLoader.clearCache();
        hoisted.load.mockReset();
        hoisted.dispose.mockReset();
        hoisted.load.mockImplementation(async (url: string) => {
            const obj = new Object3D();
            obj.name = url;
            obj.userData = {};
            return obj;
        });
    });

    it("reuses cached roots while returning distinct scene instances", async () => {
        const first = await new ModelLoader().load("/shared.glb", {
            Type: "glb",
            CacheKey: "shared",
            DisableReupload: true,
        });
        const second = await new ModelLoader().load("/signed/shared.glb", {
            Type: "glb",
            CacheKey: "shared",
            DisableReupload: true,
        });

        expect(first).toBeTruthy();
        expect(second).toBeTruthy();
        expect(first).not.toBe(second);
        expect(first?.name).toBe("/shared.glb");
        expect(second?.name).toBe("/shared.glb");
        expect(hoisted.load).toHaveBeenCalledTimes(1);
        expect(hoisted.dispose).toHaveBeenCalledTimes(1);
    });

    it("normalizes geometry only when materializing scene instances", async () => {
        const root = new Object3D();
        root.name = "/shared.glb";
        root.userData = {};

        const geometry = new BufferGeometry();
        geometry.setAttribute(
            "position",
            new BufferAttribute(new Float32Array([
                0, 0, 0,
                1, 1, 1,
                2, 0, 0,
            ]), 3),
        );
        root.add(new Mesh(geometry, new MeshBasicMaterial()));
        hoisted.load.mockResolvedValueOnce(root);

        const normalizeSpy = vi.spyOn(
            ModelLoader.prototype as unknown as { normalizeGeometryAttributes(child: Object3D): void },
            "normalizeGeometryAttributes",
        );

        const first = await new ModelLoader().load("/shared.glb", {
            Type: "glb",
            CacheKey: "shared",
            DisableReupload: true,
        });
        const second = await new ModelLoader().load("/signed/shared.glb", {
            Type: "glb",
            CacheKey: "shared",
            DisableReupload: true,
        });

        expect(first).toBeTruthy();
        expect(second).toBeTruthy();
        expect(hoisted.load).toHaveBeenCalledTimes(1);
        expect(normalizeSpy).toHaveBeenCalledTimes(2);
        expect(normalizeSpy.mock.calls.every(([child]) => child !== root.children[0])).toBe(true);
        expect(root.children[0]?.userData.isRuntimeOnly).toBeUndefined();
    });

    it("evicts the least recently used cached root after the cache limit", async () => {
        for (let i = 0; i < 64; i++) {
            await new ModelLoader().load(`/model-${i}.glb`, {
                Type: "glb",
                CacheKey: `model-${i}`,
                DisableReupload: true,
            });
        }

        expect(hoisted.load).toHaveBeenCalledTimes(64);

        await new ModelLoader().load("/signed/model-0.glb", {
            Type: "glb",
            CacheKey: "model-0",
            DisableReupload: true,
        });
        await new ModelLoader().load("/model-64.glb", {
            Type: "glb",
            CacheKey: "model-64",
            DisableReupload: true,
        });

        expect(hoisted.load).toHaveBeenCalledTimes(65);

        await new ModelLoader().load("/signed/model-0-again.glb", {
            Type: "glb",
            CacheKey: "model-0",
            DisableReupload: true,
        });
        await new ModelLoader().load("/signed/model-1-again.glb", {
            Type: "glb",
            CacheKey: "model-1",
            DisableReupload: true,
        });

        expect(hoisted.load).toHaveBeenCalledTimes(66);
        expect(hoisted.load).toHaveBeenLastCalledWith(
            "/signed/model-1-again.glb",
            expect.objectContaining({CacheKey: "model-1"}),
            undefined,
        );
    });
});
