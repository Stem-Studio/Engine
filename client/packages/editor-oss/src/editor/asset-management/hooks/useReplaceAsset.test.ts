import {renderHook} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";

const hoisted = vi.hoisted(() => ({
    addMutateAsync: vi.fn(),
    removeMutateAsync: vi.fn(),
    changeAssetRevision: vi.fn(),
    changeModelRevision: vi.fn(),
    changePrefabRevision: vi.fn(),
    changeLambdaRevision: vi.fn(),
    changeQuarksRevision: vi.fn(),
    updateSceneBehaviorRevision: vi.fn(),
    getBehaviorRevisionData: vi.fn(),
    assetSource: null,
}));

vi.mock("./useChangeAssetRevision", () => ({
    useChangeAssetRevision: () => hoisted.changeAssetRevision,
}));
vi.mock("./useChangeModelRevision", () => ({
    useChangeModelRevision: () => hoisted.changeModelRevision,
}));
vi.mock("./useChangePrefabRevision", () => ({
    useChangePrefabRevision: () => hoisted.changePrefabRevision,
}));
vi.mock("./useChangeLambdaRevision", () => ({
    useChangeLambdaRevision: () => hoisted.changeLambdaRevision,
}));
vi.mock("./useChangeQuarksRevision", () => ({
    useChangeQuarksRevision: () => hoisted.changeQuarksRevision,
}));
vi.mock("@stem/network/api/asset", () => ({
    AssetType: {
        Animation: "animation",
        Audio: "audio",
        Behavior: "behavior",
        File: "file",
        Image: "image",
        Lambda: "lambda",
        Model: "model",
        Npc: "npc",
        Prefab: "prefab",
        Quarks: "quarks",
        Script: "script",
        Video: "video",
    },
}));
vi.mock("@stem/network/api/behavior", () => ({
    getBehaviorRevisionData: (...args: unknown[]) => hoisted.getBehaviorRevisionData(...args),
}));
vi.mock("../../behaviors/util", () => ({
    updateSceneBehaviorRevision: (...args: unknown[]) => hoisted.updateSceneBehaviorRevision(...args),
}));
vi.mock("../../../context/AssetSourceContext", () => ({
    useAssetSource: () => hoisted.assetSource,
}));
vi.mock("./assets", () => ({
    useAddEditorDependencies: () => ({mutateAsync: hoisted.addMutateAsync}),
    useRemoveEditorDependencies: () => ({mutateAsync: hoisted.removeMutateAsync}),
}));

import {useReplaceAsset} from "./useReplaceAsset";

const setupAssetSource = () => {
    hoisted.assetSource = {kind: "scene", id: "scene-1"} as never;
};

describe("useReplaceAsset", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setupAssetSource();
        hoisted.addMutateAsync.mockResolvedValue(undefined);
        hoisted.removeMutateAsync.mockResolvedValue(undefined);
        hoisted.changeAssetRevision.mockResolvedValue(undefined);
        hoisted.changeModelRevision.mockResolvedValue(undefined);
        hoisted.changePrefabRevision.mockResolvedValue(undefined);
        hoisted.changeLambdaRevision.mockResolvedValue(undefined);
        hoisted.changeQuarksRevision.mockResolvedValue(undefined);
        hoisted.getBehaviorRevisionData.mockResolvedValue({code: "code", config: {id: "x"}});
    });

    it("model swap: adds new dep, runs swap, removes old dep — in that order", async () => {
        const callOrder: string[] = [];
        hoisted.addMutateAsync.mockImplementation(() => callOrder.push("addDependencies"));
        hoisted.changeModelRevision.mockImplementation(() => callOrder.push("changeModelRevision"));
        hoisted.removeMutateAsync.mockImplementation(() => callOrder.push("removeDependencies"));

        const {result} = renderHook(() => useReplaceAsset());
        await result.current({
            originalAssetId: "old",
            newAssetId: "new",
            newRevisionId: "rev-new",
            assetType: "model",
        });

        expect(hoisted.addMutateAsync).toHaveBeenCalledWith({new: "rev-new"});
        expect(hoisted.changeModelRevision).toHaveBeenCalledWith("old", "rev-new", undefined, "new");
        expect(hoisted.removeMutateAsync).toHaveBeenCalledWith(["old"]);

        expect(callOrder).toEqual(["addDependencies", "changeModelRevision", "removeDependencies"]);
    });

    it("lambda swap: dispatches to changeLambdaRevision", async () => {
        const {result} = renderHook(() => useReplaceAsset());
        await result.current({
            originalAssetId: "old-lambda",
            newAssetId: "new-lambda",
            newRevisionId: "rev-l",
            assetType: "lambda",
        });

        expect(hoisted.addMutateAsync).toHaveBeenCalledWith({"new-lambda": "rev-l"});
        expect(hoisted.changeLambdaRevision).toHaveBeenCalledWith("old-lambda", "rev-l", "new-lambda");
        expect(hoisted.removeMutateAsync).toHaveBeenCalledWith(["old-lambda"]);
    });

    it("quarks swap: dispatches to changeQuarksRevision and forwards excludeUuids", async () => {
        const {result} = renderHook(() => useReplaceAsset());
        await result.current({
            originalAssetId: "old-vfx",
            newAssetId: "new-vfx",
            newRevisionId: "rev-q",
            assetType: "quarks",
            excludeUuids: ["uuid-a"],
        });

        expect(hoisted.addMutateAsync).toHaveBeenCalledWith({"new-vfx": "rev-q"});
        expect(hoisted.changeQuarksRevision).toHaveBeenCalledWith("old-vfx", "rev-q", "new-vfx", ["uuid-a"]);
        expect(hoisted.removeMutateAsync).toHaveBeenCalledWith(["old-vfx"]);
    });

    it("prefab swap: forwards excludeUuids", async () => {
        const {result} = renderHook(() => useReplaceAsset());
        await result.current({
            originalAssetId: "old-prefab",
            newAssetId: "new-prefab",
            newRevisionId: "rev-p",
            assetType: "prefab",
            excludeUuids: ["uuid-b"],
        });

        expect(hoisted.changePrefabRevision).toHaveBeenCalledWith(
            "old-prefab",
            "rev-p",
            "new-prefab",
            ["uuid-b"],
        );
    });

    it("prefab swap: same orchestration", async () => {
        const {result} = renderHook(() => useReplaceAsset());
        await result.current({
            originalAssetId: "old-prefab",
            newAssetId: "new-prefab",
            newRevisionId: "rev-p",
            assetType: "prefab",
        });

        expect(hoisted.addMutateAsync).toHaveBeenCalledWith({"new-prefab": "rev-p"});
        expect(hoisted.changePrefabRevision).toHaveBeenCalledWith("old-prefab", "rev-p", "new-prefab", undefined);
        expect(hoisted.removeMutateAsync).toHaveBeenCalledWith(["old-prefab"]);
    });

    it("behavior swap: fetches new revision data and calls updateSceneBehaviorRevision with newAssetId", async () => {
        hoisted.getBehaviorRevisionData.mockResolvedValue({code: "src", config: {id: "b1"}});

        const {result} = renderHook(() => useReplaceAsset());
        await result.current({
            originalAssetId: "old-b",
            newAssetId: "new-b",
            newRevisionId: "rev-b",
            assetType: "behavior",
        });

        expect(hoisted.getBehaviorRevisionData).toHaveBeenCalledWith("new-b", "rev-b");
        expect(hoisted.updateSceneBehaviorRevision).toHaveBeenCalledWith({
            assetId: "old-b",
            revisionId: "rev-b",
            code: "src",
            config: {id: "b1"},
            newAssetId: "new-b",
        });
        expect(hoisted.removeMutateAsync).toHaveBeenCalledWith(["old-b"]);
    });

    it("skips dep mutations when no AssetSource is available", async () => {
        hoisted.assetSource = null;
        const {result} = renderHook(() => useReplaceAsset());

        await result.current({
            originalAssetId: "old",
            newAssetId: "new",
            newRevisionId: "rev",
            assetType: "model",
        });

        expect(hoisted.addMutateAsync).not.toHaveBeenCalled();
        expect(hoisted.removeMutateAsync).not.toHaveBeenCalled();
        expect(hoisted.changeModelRevision).toHaveBeenCalledTimes(1);
    });

    const genericAssetTypes = ["image", "audio", "video", "animation", "npc", "file", "script"] as const;
    it.each(genericAssetTypes)(
        "%s swap: remaps generic AssetRefs through useChangeAssetRevision",
        async assetType => {
            const {result} = renderHook(() => useReplaceAsset());
            await result.current({
                originalAssetId: "old-ref",
                newAssetId: "new-ref",
                newRevisionId: "rev-ref",
                assetType,
            });

            expect(hoisted.addMutateAsync).toHaveBeenCalledWith({"new-ref": "rev-ref"});
            expect(hoisted.changeAssetRevision).toHaveBeenCalledWith(
                "old-ref",
                "rev-ref",
                undefined,
                "new-ref",
            );
            expect(hoisted.removeMutateAsync).toHaveBeenCalledWith(["old-ref"]);
        },
    );

    it("propagates the swap error and skips the dep removal so the new dep stays attached for retry", async () => {
        hoisted.changeModelRevision.mockRejectedValue(new Error("loader failed"));

        const {result} = renderHook(() => useReplaceAsset());
        await expect(
            result.current({
                originalAssetId: "old",
                newAssetId: "new",
                newRevisionId: "rev",
                assetType: "model",
            }),
        ).rejects.toThrow("loader failed");

        expect(hoisted.addMutateAsync).toHaveBeenCalledTimes(1);
        expect(hoisted.removeMutateAsync).not.toHaveBeenCalled();
    });

    it("throws on unsupported asset types after adding the new dep — caller decides cleanup", async () => {
        const {result} = renderHook(() => useReplaceAsset());
        await expect(
            result.current({
                originalAssetId: "old",
                newAssetId: "new",
                newRevisionId: "rev",
                assetType: "scene",
            }),
        ).rejects.toThrow(/not yet supported/);

        expect(hoisted.addMutateAsync).toHaveBeenCalledTimes(1);
        expect(hoisted.removeMutateAsync).not.toHaveBeenCalled();
    });
});
