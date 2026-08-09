import {beforeEach, describe, expect, it, vi} from "vitest";

const uikitMocks = vi.hoisted(() => ({
    initNodeMaterials: vi.fn<() => Promise<void>>(),
    initGlyphNodeMaterials: vi.fn<() => Promise<void>>(),
    setDefaultRenderOrder: vi.fn<(renderOrder: number) => void>(),
}));

vi.mock("@ni2khanna/uikit", () => uikitMocks);

describe("ensureUIKitRuntimeInitialized", () => {
    beforeEach(() => {
        vi.resetModules();
        uikitMocks.initNodeMaterials.mockReset().mockResolvedValue(undefined);
        uikitMocks.initGlyphNodeMaterials.mockReset().mockResolvedValue(undefined);
        uikitMocks.setDefaultRenderOrder.mockReset();
    });

    it("finishes node and glyph initialization before UIKit construction can continue", async () => {
        let releaseNodeMaterials!: () => void;
        uikitMocks.initNodeMaterials.mockImplementation(
            () => new Promise<void>(resolve => {
                releaseNodeMaterials = resolve;
            }),
        );

        const {ensureUIKitRuntimeInitialized} = await import("./UIKitInitialization");
        let constructed = false;
        const constructAfterInitialization = ensureUIKitRuntimeInitialized().then(() => {
            constructed = true;
        });

        await vi.waitFor(() => {
            expect(uikitMocks.initNodeMaterials).toHaveBeenCalledOnce();
        });
        expect(constructed).toBe(false);
        expect(uikitMocks.initGlyphNodeMaterials).not.toHaveBeenCalled();

        releaseNodeMaterials();
        await constructAfterInitialization;

        expect(uikitMocks.initGlyphNodeMaterials).toHaveBeenCalledOnce();
        expect(uikitMocks.setDefaultRenderOrder).toHaveBeenCalledWith(10_000);
        expect(constructed).toBe(true);
    });

    it("sets the UI render order before consumer construction can continue", async () => {
        const callOrder: string[] = [];
        uikitMocks.initNodeMaterials.mockImplementation(async () => {
            callOrder.push("node-materials");
        });
        uikitMocks.initGlyphNodeMaterials.mockImplementation(async () => {
            callOrder.push("glyph-materials");
        });
        uikitMocks.setDefaultRenderOrder.mockImplementation(() => {
            callOrder.push("render-order");
        });

        const {ensureUIKitRuntimeInitialized} = await import("./UIKitInitialization");
        await ensureUIKitRuntimeInitialized().then(() => {
            callOrder.push("consumer");
        });

        expect(callOrder).toEqual([
            "node-materials",
            "glyph-materials",
            "render-order",
            "consumer",
        ]);
        expect(uikitMocks.setDefaultRenderOrder).toHaveBeenCalledWith(10_000);
    });

    it("shares one initialization across concurrent WebGL and WebGPU callers", async () => {
        const {ensureUIKitRuntimeInitialized} = await import("./UIKitInitialization");

        const webglInitialization = ensureUIKitRuntimeInitialized();
        const webgpuInitialization = ensureUIKitRuntimeInitialized();

        expect(webgpuInitialization).toBe(webglInitialization);
        await Promise.all([webglInitialization, webgpuInitialization]);
        expect(uikitMocks.initNodeMaterials).toHaveBeenCalledOnce();
        expect(uikitMocks.initGlyphNodeMaterials).toHaveBeenCalledOnce();
        expect(uikitMocks.setDefaultRenderOrder).toHaveBeenCalledOnce();
    });

    it("shares a failed initialization without repeatedly invoking UIKit", async () => {
        uikitMocks.initNodeMaterials.mockRejectedValue(new Error("node material initialization failed"));
        const {ensureUIKitRuntimeInitialized} = await import("./UIKitInitialization");

        const firstInitialization = ensureUIKitRuntimeInitialized();
        const secondInitialization = ensureUIKitRuntimeInitialized();

        expect(secondInitialization).toBe(firstInitialization);
        await expect(firstInitialization).rejects.toThrow("node material initialization failed");
        await expect(secondInitialization).rejects.toThrow("node material initialization failed");
        expect(uikitMocks.initNodeMaterials).toHaveBeenCalledOnce();
        expect(uikitMocks.initGlyphNodeMaterials).not.toHaveBeenCalled();
        expect(uikitMocks.setDefaultRenderOrder).not.toHaveBeenCalled();
    });
});
