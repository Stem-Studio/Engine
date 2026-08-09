import * as THREE from "three";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

const hoisted = vi.hoisted(() => ({
    appGlobal: {app: null as any},
    containerAdd: vi.fn(),
    containerDispose: vi.fn(),
    imageProps: [] as any[],
}));

vi.mock("@ni2khanna/uikit", () => ({
    Container: class {
        add = hoisted.containerAdd;
        dispose = hoisted.containerDispose;
    },
    Image: class {
        constructor(props: any) {
            hoisted.imageProps.push(props);
        }
    },
}));

vi.mock("@stem/editor-oss/global", () => ({
    default: hoisted.appGlobal,
}));

import {UIKitMiniMap} from "./UIKitMiniMap";

describe("UIKitMiniMap", () => {
    beforeEach(() => {
        hoisted.appGlobal.app = null;
        hoisted.containerAdd.mockClear();
        hoisted.containerDispose.mockClear();
        hoisted.imageProps.length = 0;
        (globalThis as any).requestAnimationFrame = vi.fn().mockReturnValue(1);
        (globalThis as any).cancelAnimationFrame = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete (globalThis as any).requestAnimationFrame;
        delete (globalThis as any).cancelAnimationFrame;
    });

    it("renders static image minimaps without starting a frame loop", () => {
        const miniMap = new UIKitMiniMap({uploadedMapImg: "map.png"} as any);

        expect(hoisted.imageProps[0]).toEqual(
            expect.objectContaining({
                src: "map.png",
                width: "100%",
                height: "100%",
            }),
        );
        expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();

        miniMap.dispose();

        expect(globalThis.cancelAnimationFrame).not.toHaveBeenCalled();
        expect(hoisted.containerDispose).toHaveBeenCalledOnce();
    });

    it("renders camera minimaps on update through the shared renderer only", () => {
        const scene = new THREE.Scene();
        const previousTarget = new THREE.WebGLRenderTarget(2, 2);
        const renderer = {
            getRenderTarget: vi.fn(() => previousTarget),
            setRenderTarget: vi.fn(),
            render: vi.fn(),
        };
        const renderTargetDispose = vi.spyOn(THREE.WebGLRenderTarget.prototype, "dispose");
        hoisted.appGlobal.app = {
            editor: {scene},
            renderer,
        };

        const miniMap = new UIKitMiniMap({useMiniMapCamera: true} as any);

        expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();
        expect(hoisted.imageProps[0]?.src).toBeInstanceOf(THREE.Texture);

        miniMap.update();

        expect(renderer.getRenderTarget).toHaveBeenCalledOnce();
        expect(renderer.render).toHaveBeenCalledWith(scene, expect.any(THREE.PerspectiveCamera));
        expect(renderer.setRenderTarget.mock.calls[0]?.[0]).toBeInstanceOf(THREE.WebGLRenderTarget);
        expect(renderer.setRenderTarget.mock.calls[1]?.[0]).toBe(previousTarget);

        miniMap.dispose();

        expect(globalThis.cancelAnimationFrame).not.toHaveBeenCalled();
        expect(renderTargetDispose).toHaveBeenCalled();
        previousTarget.dispose();
    });
});
