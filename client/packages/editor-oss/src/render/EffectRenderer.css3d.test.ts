import {Object3D, Scene} from "three";
import {describe, expect, it, vi} from "vitest";

import EffectRenderer from "./EffectRenderer";

describe("EffectRenderer CSS3D discovery", () => {
    it("polls no-CSS scenes at the configured interval", () => {
        const renderer = Object.create(EffectRenderer.prototype) as EffectRenderer & {
            css3DObjectScanIntervalMs: number;
            hasCSS3DObjects: boolean;
            lastCSS3DObjectScanTime: number;
            rendererCSS: {setExternalCSSObjects: () => void};
        };
        renderer.rendererCSS = {setExternalCSSObjects: vi.fn()};
        renderer.hasCSS3DObjects = false;
        renderer.lastCSS3DObjectScanTime = 100;
        renderer.css3DObjectScanIntervalMs = 1_000;
        renderer.getNow = vi.fn()
            .mockReturnValueOnce(1_099)
            .mockReturnValueOnce(1_100);

        expect(renderer.shouldSyncCSS3DObjects(false)).toBe(false);
        expect(renderer.shouldSyncCSS3DObjects(false)).toBe(true);
        expect(renderer.lastCSS3DObjectScanTime).toBe(1_100);
    });

    it("continues collecting every frame while CSS3D objects exist", () => {
        const renderer = Object.create(EffectRenderer.prototype) as EffectRenderer & {
            css3DObjectScanIntervalMs: number;
            hasCSS3DObjects: boolean;
            lastCSS3DObjectScanTime: number;
            rendererCSS: {setExternalCSSObjects: () => void};
        };
        renderer.rendererCSS = {setExternalCSSObjects: vi.fn()};
        renderer.hasCSS3DObjects = true;
        renderer.lastCSS3DObjectScanTime = 100;
        renderer.css3DObjectScanIntervalMs = 1_000;
        renderer.getNow = vi.fn(() => 101);

        expect(renderer.shouldSyncCSS3DObjects(false)).toBe(true);
        expect(renderer.lastCSS3DObjectScanTime).toBe(100);
    });

    it("discovers CSS3D objects in deep hierarchies without recursive traversal", () => {
        const renderer = Object.create(EffectRenderer.prototype) as EffectRenderer;
        const scene = new Scene();
        let cursor: Object3D = scene;
        for (let i = 0; i < 12_000; i++) {
            const child = new Object3D();
            cursor.add(child);
            cursor = child;
        }
        (cursor as Object3D & {isCSS3DObject?: boolean}).isCSS3DObject = true;
        const traverse = vi.spyOn(scene, "traverse").mockImplementation(() => {
            throw new Error("recursive traversal should not be used");
        });

        expect(renderer.sceneHasCSS3DObjects(scene)).toBe(true);
        expect(traverse).not.toHaveBeenCalled();
    });

    it("only submits CSS3D frames when the cached scene contains CSS3D objects", () => {
        const renderer = Object.create(EffectRenderer.prototype) as EffectRenderer & {
            rendererCSS: object;
            scene: Scene;
            camera: object;
            hasCSS3DObjects: boolean;
        };
        renderer.rendererCSS = {};
        renderer.scene = new Scene();
        renderer.camera = {};

        renderer.hasCSS3DObjects = false;
        expect(renderer.shouldRenderCSS3D(false)).toBe(false);
        expect(renderer.shouldRenderCSS3D(true)).toBe(false);

        renderer.hasCSS3DObjects = true;
        expect(renderer.shouldRenderCSS3D(false)).toBe(true);
        expect(renderer.shouldRenderCSS3D(true)).toBe(true);
    });
});
