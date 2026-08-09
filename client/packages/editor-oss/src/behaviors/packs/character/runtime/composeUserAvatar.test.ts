/* eslint-disable @typescript-eslint/no-explicit-any */
import {BoxGeometry, Group, Mesh, MeshStandardMaterial, Object3D} from "three";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("@stem/network/api/asset", () => ({
    getAsset: vi.fn(),
    getAssetRevision: vi.fn(),
}));

const sharedLoad = vi.fn();
vi.mock("../../../../assets/js/loaders/ModelLoader", () => {
    class FakeModelLoader {
        load = sharedLoad;
    }
    return {default: FakeModelLoader};
});

import {getAsset, getAssetRevision} from "@stem/network/api/asset";
import {composeUserAvatar} from "./composeUserAvatar";

const mockedGetAsset = getAsset as unknown as ReturnType<typeof vi.fn>;
const mockedGetAssetRevision = getAssetRevision as unknown as ReturnType<typeof vi.fn>;
const mockedLoad = sharedLoad;

function makePartObject(name: string): Group {
    // A minimal Object3D with a real Mesh child carrying a material so we can
    // observe color overrides without touching three.js internals.
    const grp = new Group();
    grp.name = name;
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({color: 0x000000}));
    mesh.name = "skin_mesh";
    grp.add(mesh);
    return grp;
}

describe("composeUserAvatar", () => {
    beforeEach(() => {
        mockedGetAsset.mockReset();
        mockedGetAssetRevision.mockReset();
        mockedLoad.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("returns null when parts list is empty", async () => {
        const result = await composeUserAvatar({parts: []});
        expect(result).toBeNull();
    });

    it("fetches head revision for each part and attaches them under a root", async () => {
        mockedGetAsset
            .mockResolvedValueOnce({id: "body-asset", headRevisionId: "body-head"})
            .mockResolvedValueOnce({id: "hair-asset", headRevisionId: "hair-head"});
        mockedGetAssetRevision
            .mockResolvedValueOnce({dataUrl: "https://cdn/body.glb"})
            .mockResolvedValueOnce({dataUrl: "https://cdn/hair.glb"});

        mockedLoad
            .mockResolvedValueOnce(makePartObject("Body"))
            .mockResolvedValueOnce(makePartObject("Hair"));

        const result = await composeUserAvatar({
            parts: [
                {group: "Body", assetId: "body-asset"},
                {group: "Hair", assetId: "hair-asset"},
            ],
        });

        expect(result).not.toBeNull();
        expect(result!.children).toHaveLength(2);
        expect(mockedGetAssetRevision).toHaveBeenNthCalledWith(1, "body-asset", "body-head", {
            includeDataUrl: true,
        });
        expect(mockedGetAssetRevision).toHaveBeenNthCalledWith(2, "hair-asset", "hair-head", {
            includeDataUrl: true,
        });
    });

    it("skips a part if its asset has no head revision", async () => {
        mockedGetAsset
            .mockResolvedValueOnce({id: "body-asset", headRevisionId: "body-head"})
            .mockResolvedValueOnce({id: "broken-asset"}); // no headRevisionId
        mockedGetAssetRevision.mockResolvedValueOnce({dataUrl: "https://cdn/body.glb"});

        mockedLoad.mockResolvedValueOnce(makePartObject("Body"));

        const result = await composeUserAvatar({
            parts: [
                {group: "Body", assetId: "body-asset"},
                {group: "Hair", assetId: "broken-asset"},
            ],
        });

        expect(result).not.toBeNull();
        expect(result!.children).toHaveLength(1);
    });

    it("applies skinTone to skin/body-named meshes", async () => {
        mockedGetAsset.mockResolvedValueOnce({id: "body-asset", headRevisionId: "head-1"});
        mockedGetAssetRevision.mockResolvedValueOnce({dataUrl: "https://cdn/body.glb"});

        const part = makePartObject("Body");
        mockedLoad.mockResolvedValueOnce(part);
        const traverse = vi.spyOn(Object3D.prototype, "traverse").mockImplementation(() => {
            throw new Error("recursive traversal should not be used");
        });

        const result = await composeUserAvatar({
            parts: [{group: "Body", assetId: "body-asset"}],
            skinTone: "#ff0000",
        });

        expect(result).not.toBeNull();
        const skinMesh = (((result!.children[0] as Group).children[0] as Group).children[0] as Mesh);
        const material = skinMesh.material as MeshStandardMaterial;
        expect(skinMesh).not.toBeNull();
        expect(material.color.r).toBeCloseTo(1);
        expect(material.color.g).toBeCloseTo(0);
        expect(material.color.b).toBeCloseTo(0);
        expect(traverse).not.toHaveBeenCalled();
    });

    it("returns null when zero parts resolve", async () => {
        mockedGetAsset.mockResolvedValueOnce({id: "broken"});
        const result = await composeUserAvatar({parts: [{group: "Body", assetId: "broken"}]});
        expect(result).toBeNull();
    });
});
