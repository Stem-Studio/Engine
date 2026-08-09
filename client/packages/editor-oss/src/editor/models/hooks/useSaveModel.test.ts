import {renderHook} from "@testing-library/react";
import {Object3D} from "three";
import {beforeEach, describe, expect, it, vi} from "vitest";

const hoisted = vi.hoisted(() => ({
    forkAsset: vi.fn(),
    getAsset: vi.fn(),
    createModelRevision: vi.fn(),
    changeModelRevision: vi.fn(),
    replaceAsset: vi.fn(),
    setAssetRevision: vi.fn(),
    showToast: vi.fn(),
    canFork: true,
    gltfExporterParse: vi.fn(),
    gltfExporterRegister: vi.fn(),
    globalMock: {
        app: {editor: {projectUserId: "scene-owner"}},
    },
}));

vi.mock("three/addons/exporters/GLTFExporter.js", () => ({
    GLTFExporter: class {
        setTextureUtils = vi.fn();
        register = (...args: unknown[]) => hoisted.gltfExporterRegister(...args);
        parse = (...args: unknown[]) => hoisted.gltfExporterParse(...args);
    },
}));
vi.mock("three/addons/utils/WebGLTextureUtils.js", () => ({}));
vi.mock("toastywave", () => ({toast: {warn: vi.fn()}}));

vi.mock("@stem/network/api/asset", () => ({
    AssetType: {Model: "model"},
    AssetDerivativeType: {},
    SUPPORTED_MODEL_CONTENT_TYPES: {glb: ["model/gltf-binary"]},
    forkAsset: (...args: unknown[]) => hoisted.forkAsset(...args),
    getAsset: (...args: unknown[]) => hoisted.getAsset(...args),
}));
vi.mock("../../../asset-management/AssetResolutionContext", () => ({
    emptyAssetResolutionContext: {},
    getAssetResolutionContext: () => ({}),
    resolveAssetRevisionId: () => "rev-parent",
}));
vi.mock("../../../context", () => ({useModelsTabContext: () => ({})}));
vi.mock("../../../context/AssetResolutionContext", () => ({
    useAssetResolutionContext: () => ({
        context: {},
        setAssetRevision: hoisted.setAssetRevision,
    }),
}));
vi.mock("../../../global", () => ({default: hoisted.globalMock}));
vi.mock("../../../model/util", () => ({
    createLods: vi.fn().mockResolvedValue([]),
    isModelAssetInstance: vi.fn(),
    loadModel: vi.fn(),
}));
vi.mock("../../../showToast", () => ({
    showToast: (...args: unknown[]) => hoisted.showToast(...args),
}));
vi.mock("../../../utils/Converter", () => ({
    default: {dataURLtoFile: vi.fn(() => new File([""], "thumb"))},
}));
vi.mock("../../../utils/MeshUtils", () => ({default: {dispose: vi.fn()}}));
vi.mock("../../../utils/ModelUtils", () => ({
    ModelUtils: {
        createThumbnailFromModel: vi.fn().mockResolvedValue("data:image/png;base64,abc"),
        compressModel: vi.fn().mockImplementation(async (buf: ArrayBuffer) => buf),
    },
}));
vi.mock("../../../utils/ObjectUtils", () => ({cloneObject: (o: unknown) => o}));
vi.mock("../../../v2/pages/services", () => ({
    generateUniqueName: vi.fn(),
    getObjectNamesInScene: vi.fn(() => new Set<string>()),
}));
vi.mock("../../asset-management/hooks/assets", () => ({
    useCreateAssetDerivativeWithData: () => ({mutateAsync: vi.fn()}),
    useCreateAssetRevisionWithData: () => ({mutateAsync: vi.fn().mockResolvedValue({id: "rev-saved"})}),
    useCreateAssetWithData: () => ({mutateAsync: vi.fn()}),
    useGetAsset: () => vi.fn(),
    useListEditorAssets: () => ({data: undefined}),
}));
vi.mock("../../asset-management/hooks/useChangeModelRevision", () => ({
    useChangeModelRevision: () => hoisted.changeModelRevision,
}));
vi.mock("../../asset-management/hooks/useReplaceAsset", () => ({
    useReplaceAsset: () => hoisted.replaceAsset,
}));
vi.mock("../../assets/v2/common/hooks/useCanEditAsset", () => ({
    useCanEditAsset: () => ({canFork: hoisted.canFork}),
}));
vi.mock("../../assets/v2/materials/materialUtils", () => ({
    applyMaterialSettingsToObject: vi.fn(),
}));
vi.mock("../../assets/v2/LeftPanel/MainTabs/AssetsTab/ModelUpload/constants", () => ({
    DEFAULT_UPLOAD_SETTINGS: {lodSettings: []},
}));
vi.mock("../../../command/Commands", () => ({
    AddObjectCommand: vi.fn(),
    RemoveObjectCommand: vi.fn(),
}));

// Mock useCreateModelRevision (defined in the file under test) by stubbing
// its underlying createAssetRevisionWithData mutation above; we surface a
// hoisted spy here so tests can assert on the call. The real
// useCreateModelRevision wrapper just forwards through.
import {useSaveModel} from "./models";

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const setupGltfParseToFireImmediately = () => {
    hoisted.gltfExporterParse.mockImplementation((_input, onComplete) => {
        Promise.resolve().then(() => onComplete(new ArrayBuffer(8)));
    });
};

const makeSelection = (overrides: {modelId?: string; Name?: string} = {}): Object3D => ({
    userData: {modelId: overrides.modelId ?? "model-1", Name: overrides.Name ?? "robot.glb"},
    children: [],
} as unknown as Object3D);

const makeExportSource = (): Object3D => ({
    children: [],
} as unknown as Object3D);

describe("useSaveModel", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.canFork = true;
        hoisted.globalMock.app.editor.projectUserId = "scene-owner";
        hoisted.replaceAsset.mockResolvedValue(undefined);
        hoisted.changeModelRevision.mockResolvedValue(undefined);
        // createModelRevision is exposed via the underlying mutation mock,
        // which always resolves to {id: "rev-saved"}.
        setupGltfParseToFireImmediately();
    });

    it("returns null when selection has no modelId", async () => {
        const {result} = renderHook(() => useSaveModel());
        const selection = {userData: {}} as Object3D;
        const ret = await result.current({selection, exportSource: makeExportSource()});

        expect(ret).toBeNull();
        expect(hoisted.getAsset).not.toHaveBeenCalled();
        expect(hoisted.gltfExporterParse).not.toHaveBeenCalled();
    });

    it("same-id save (asset owned by scene owner): no fork, calls changeModelRevision", async () => {
        hoisted.getAsset.mockResolvedValue({
            userId: "scene-owner",
            headRevisionId: "rev-old",
            metadata: {},
        });

        const selection = makeSelection();
        const {result} = renderHook(() => useSaveModel());
        const ret = await result.current({selection, exportSource: makeExportSource()});

        expect(hoisted.forkAsset).not.toHaveBeenCalled();
        expect(hoisted.replaceAsset).not.toHaveBeenCalled();
        expect(hoisted.changeModelRevision).toHaveBeenCalledWith("model-1", "rev-saved");
        expect(ret).toEqual({assetId: "model-1", revisionId: "rev-saved"});
        expect(selection.userData.modelId).toBe("model-1");
    });

    it("fork-on-save: forks → pin fork.head → createModelRevision against fork id → replaceAsset with saved revision", async () => {
        hoisted.getAsset.mockResolvedValue({
            userId: "someone-else",
            headRevisionId: "rev-old",
            metadata: {},
        });
        const callOrder: string[] = [];
        hoisted.forkAsset.mockImplementation(async () => {
            callOrder.push("fork");
            return {assetId: "fork-1", revisionId: "fork-head"};
        });
        hoisted.setAssetRevision.mockImplementation(() => callOrder.push("pin"));
        hoisted.gltfExporterParse.mockImplementation((_i, onComplete) => {
            callOrder.push("parse");
            Promise.resolve().then(() => onComplete(new ArrayBuffer(8)));
        });
        hoisted.replaceAsset.mockImplementation(async () => {
            callOrder.push("replace");
        });

        const selection = makeSelection();
        const {result} = renderHook(() => useSaveModel());
        const ret = await result.current({selection, exportSource: makeExportSource()});

        // Order is load-bearing: fork → pin so resolveAssetRevisionId
        // works → parse → replace with the actually-saved revision.
        expect(callOrder).toEqual(["fork", "pin", "parse", "replace"]);

        expect(hoisted.forkAsset).toHaveBeenCalledWith({
            assetId: "model-1",
            revisionId: "rev-old",
        });
        expect(hoisted.setAssetRevision).toHaveBeenCalledWith("fork-1", "fork-head");
        expect(hoisted.replaceAsset).toHaveBeenCalledWith({
            originalAssetId: "model-1",
            newAssetId: "fork-1",
            newRevisionId: "rev-saved",
            assetType: "model",
        });
        expect(hoisted.changeModelRevision).not.toHaveBeenCalled();
        // Patch selection.userData.modelId to fork id for second-save protection.
        expect(selection.userData.modelId).toBe("fork-1");
        expect(ret).toEqual({assetId: "fork-1", revisionId: "rev-saved"});
    });

    it("non-owned + !canFork: skips fork, falls through to changeModelRevision against original (back-end will reject)", async () => {
        hoisted.canFork = false;
        hoisted.getAsset.mockResolvedValue({
            userId: "someone-else",
            headRevisionId: "rev-old",
            metadata: {},
        });

        const selection = makeSelection();
        const {result} = renderHook(() => useSaveModel());
        await result.current({selection, exportSource: makeExportSource()});

        expect(hoisted.forkAsset).not.toHaveBeenCalled();
        expect(hoisted.replaceAsset).not.toHaveBeenCalled();
        expect(hoisted.changeModelRevision).toHaveBeenCalledWith("model-1", "rev-saved");
        expect(selection.userData.modelId).toBe("model-1");
    });

    it("fork failure: surfaces toast and does NOT proceed to GLB export or upload", async () => {
        hoisted.getAsset.mockResolvedValue({
            userId: "someone-else",
            headRevisionId: "rev-old",
            metadata: {},
        });
        hoisted.forkAsset.mockRejectedValue(new Error("fork failed"));

        const {result} = renderHook(() => useSaveModel());
        const ret = await result.current({selection: makeSelection(), exportSource: makeExportSource()});

        await flush();

        expect(ret).toBeNull();
        expect(hoisted.gltfExporterParse).not.toHaveBeenCalled();
        expect(hoisted.replaceAsset).not.toHaveBeenCalled();
        expect(hoisted.showToast).toHaveBeenCalledWith(expect.objectContaining({type: "error"}));
    });

    it("asset fetch failure: bails before any save action", async () => {
        hoisted.getAsset.mockRejectedValue(new Error("network down"));

        const {result} = renderHook(() => useSaveModel());
        const ret = await result.current({selection: makeSelection(), exportSource: makeExportSource()});

        expect(ret).toBeNull();
        expect(hoisted.forkAsset).not.toHaveBeenCalled();
        expect(hoisted.gltfExporterParse).not.toHaveBeenCalled();
        expect(hoisted.showToast).toHaveBeenCalledWith(expect.objectContaining({type: "error"}));
    });

    it("configureExporter callback runs before parse — caller can register custom plugins", async () => {
        hoisted.getAsset.mockResolvedValue({
            userId: "scene-owner",
            headRevisionId: "rev-old",
            metadata: {},
        });

        const configureExporter = vi.fn();
        const {result} = renderHook(() => useSaveModel());
        await result.current({
            selection: makeSelection(),
            exportSource: makeExportSource(),
            configureExporter,
        });

        expect(configureExporter).toHaveBeenCalledTimes(1);
        // configureExporter ran before parse — callers register plugins
        // there and they're picked up by the export.
        expect(configureExporter.mock.invocationCallOrder[0]).toBeLessThan(
            hoisted.gltfExporterParse.mock.invocationCallOrder[0]!,
        );
    });
});
