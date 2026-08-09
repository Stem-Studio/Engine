import {afterEach, describe, expect, it, vi} from "vitest";

const mockState = vi.hoisted(() => ({
    webgpuModuleLoads: 0,
    WebGPURenderer: vi.fn(function (this: Record<string, unknown>) {
        this.init = vi.fn(async () => undefined);
        this.dispose = vi.fn();
        return this;
    }),
}));

vi.mock("three/webgpu", () => {
    mockState.webgpuModuleLoads += 1;
    return {
        WebGPURenderer: mockState.WebGPURenderer,
    };
});

vi.mock("./Converter", () => ({
    default: {dataURLtoFile: vi.fn()},
}));

vi.mock("./modelFileDeduplication", () => ({
    deduplicateModelFiles: vi.fn((files: File[]) => files),
}));

vi.mock("./ModelUtils", () => ({
    ModelUtils: {createThumbnailFromModel: vi.fn()},
}));

vi.mock("@stem/network/api/asset", () => ({
    ModelFormat: {Glb: "glb"},
    SUPPORTED_MODEL_FORMATS_REGEX: /\.(glb)$/i,
}));

vi.mock("@stem/network/api/scene/v2", () => ({
    createScene: vi.fn(),
    publishScene: vi.fn(),
    sceneSettingsToCreateRequest: vi.fn(),
}));

vi.mock("../editor/assets/v2/LeftPanel/MainTabs/AssetsTab/ModelUpload/utils/zipFiles", () => ({
    zipFiles: vi.fn(),
}));

vi.mock("../global", () => ({
    default: {app: null},
}));

vi.mock("@stem/editor-oss/model/createModelWithData", () => ({
    createModelWithData: vi.fn(),
}));

vi.mock("@stem/editor-oss/model/convertToGlb", () => ({
    convertToGlb: vi.fn(),
}));

vi.mock("@stem/editor-oss/model/loadModelFromFile", () => ({
    loadModelFromFile: vi.fn(),
}));

vi.mock("@stem/editor-oss/showToast", () => ({
    showToast: vi.fn(),
}));

vi.mock("@stem/editor-oss/texture/TextureMapping", () => ({
    TextureType: {Unknown: "Unknown", Diffuse: "Diffuse"},
    detectTextureType: vi.fn(() => "Unknown"),
}));

describe("DashboardAssetPackImportUtils", () => {
    afterEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        mockState.webgpuModuleLoads = 0;
    });

    it("does not load WebGPU renderer support on module import", async () => {
        await import("./DashboardAssetPackImportUtils");

        expect(mockState.webgpuModuleLoads).toBe(0);
        expect(mockState.WebGPURenderer).not.toHaveBeenCalled();
    });
});
