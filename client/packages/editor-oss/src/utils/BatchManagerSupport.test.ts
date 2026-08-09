import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

const mockState = vi.hoisted(() => {
    const pixels = new Uint8Array(4 * 64 * 64);
    pixels.fill(255);
    for (let i = 0; i < 100; i++) {
        const offset = i * 4;
        pixels[offset] = i;
        pixels[offset + 1] = (i * 3) % 255;
        pixels[offset + 2] = (i * 7) % 255;
        pixels[offset + 3] = 255;
    }

    return {
        pixels,
        batchSceneMeshes: vi.fn(),
        webgpuModuleLoads: 0,
        WebGPURenderer: vi.fn(function (this: Record<string, unknown>) {
            this.init = vi.fn(async () => undefined);
            this.setSize = vi.fn();
            this.setRenderTarget = vi.fn();
            this.setClearColor = vi.fn();
            this.clear = vi.fn(async () => undefined);
            this.render = vi.fn(async () => undefined);
            this.readRenderTargetPixelsAsync = vi.fn(async () => pixels);
            this.dispose = vi.fn();
            return this;
        }),
    };
});

vi.mock("three/webgpu", () => {
    mockState.webgpuModuleLoads += 1;
    return {
        WebGPURenderer: mockState.WebGPURenderer,
    };
});

vi.mock("./BatchManager", () => ({
    default: class MockBatchManager {
        batchSceneMeshes = mockState.batchSceneMeshes;
    },
}));

describe("BatchManagerSupport", () => {
    beforeEach(() => {
        Object.defineProperty(globalThis.navigator, "gpu", {
            configurable: true,
            value: {requestAdapter: vi.fn(async () => ({}))},
        });
    });

    afterEach(() => {
        Object.defineProperty(globalThis.navigator, "gpu", {configurable: true, value: undefined});
        vi.resetModules();
        vi.clearAllMocks();
        mockState.webgpuModuleLoads = 0;
    });

    it("does not load or run the WebGPU support probe on module import", async () => {
        await import("./BatchManagerSupport");

        expect(mockState.webgpuModuleLoads).toBe(0);
        expect(mockState.WebGPURenderer).not.toHaveBeenCalled();
        expect(mockState.batchSceneMeshes).not.toHaveBeenCalled();
    });

    it("runs the WebGPU support probe only when requested", async () => {
        const {isBatchManagerSupportedAsync} = await import("./BatchManagerSupport");

        expect(mockState.webgpuModuleLoads).toBe(0);
        await expect(isBatchManagerSupportedAsync()).resolves.toBe(true);

        expect(mockState.webgpuModuleLoads).toBe(1);
        expect(mockState.WebGPURenderer).toHaveBeenCalledTimes(1);
        expect(mockState.batchSceneMeshes).toHaveBeenCalledTimes(1);
    });

    it("short-circuits without a WebGPU adapter", async () => {
        Object.defineProperty(globalThis.navigator, "gpu", {
            configurable: true,
            value: {requestAdapter: vi.fn(async () => null)},
        });

        const {isBatchManagerSupportedAsync} = await import("./BatchManagerSupport");

        await expect(isBatchManagerSupportedAsync()).resolves.toBe(false);
        expect(mockState.webgpuModuleLoads).toBe(0);
        expect(mockState.WebGPURenderer).not.toHaveBeenCalled();
    });

    it("awaits an in-flight probe started by the synchronous accessor", async () => {
        const {isBatchManagerSupported, isBatchManagerSupportedAsync} = await import("./BatchManagerSupport");

        expect(isBatchManagerSupported()).toBe(false);
        await expect(isBatchManagerSupportedAsync()).resolves.toBe(true);

        expect(mockState.WebGPURenderer).toHaveBeenCalledTimes(1);
        expect(mockState.batchSceneMeshes).toHaveBeenCalledTimes(1);
    });
});
