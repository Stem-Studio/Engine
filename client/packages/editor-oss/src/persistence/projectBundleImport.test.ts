// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from "vitest";

import {
    getOssAssetsForProject,
    resetOssAssetRegistryForTests,
} from "@stem/network/api/asset";

import {importProjectBundleFiles} from "./projectBundleImport";
import type {ProjectStore} from "./ProjectStore";
import type {ProjectBody, ProjectMeta, StoredAsset} from "./types";

const OLD_PROJECT_ID = "oss-old-project";
const OLD_ASSET_ID = "oss-asset-old-model";
const OLD_REVISION_ID = "oss-rev-oss-asset-old-model";
const OLD_REVISION_ID_2 = "oss-rev-oss-asset-old-model-v2";
const OTHER_ASSET_ID = "oss-asset-other-model";
const OTHER_REVISION_ID = "oss-rev-oss-asset-other-model";

const withRelativePath = (file: File, path: string): File => {
    Object.defineProperty(file, "webkitRelativePath", {value: path, configurable: true});
    return file;
};

const makeFile = (path: string, content: string, type = "application/json"): File =>
    withRelativePath(new File([content], path.split("/").pop()!, {type}), path);

const makeProjectBody = (overrides: Partial<ProjectBody> = {}): ProjectBody => ({
    meta: {
        id: OLD_PROJECT_ID,
        name: "Imported Game",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        ...overrides.meta,
    },
    sceneJson: JSON.stringify([
        {
            uuid: OLD_PROJECT_ID,
            userData: {
                assetResolutionContext: {
                    assetIdToRevisionId: {[OLD_ASSET_ID]: OLD_REVISION_ID},
                    logicalIdToAssetId: {pawn: OLD_ASSET_ID},
                },
                scripts: {
                    [OLD_ASSET_ID]: `const hardcoded = "${OLD_ASSET_ID}:${OLD_REVISION_ID}";`,
                },
                behaviors: [{
                    id: OLD_ASSET_ID,
                    attributesData: {
                        pawnModel: {assetId: OLD_ASSET_ID, revisionId: OLD_REVISION_ID},
                    },
                }],
            },
        },
        {modelId: OLD_ASSET_ID},
    ]),
    ...overrides,
});

type ManifestInput = {
    assetId?: string;
    revisionId?: string;
    file?: string;
    name?: string;
};

const makeManifestEntry = (overrides: ManifestInput = {}) => ({
    assetId: overrides.assetId ?? OLD_ASSET_ID,
    revisionId: overrides.revisionId ?? OLD_REVISION_ID,
    type: "model",
    format: "glb",
    name: overrides.name ?? "Pawn",
    contentType: "model/gltf-binary",
    metadata: {
        sourceAssetId: overrides.assetId ?? OLD_ASSET_ID,
        sourceRevisionId: overrides.revisionId ?? OLD_REVISION_ID,
    },
    file: overrides.file ?? `${overrides.assetId ?? OLD_ASSET_ID}.glb`,
});

const makeManifest = (entries = [makeManifestEntry()]): string => JSON.stringify(entries);

const makeLegacyManifest = (): string => JSON.stringify([{
    assetId: OLD_ASSET_ID,
    revisionId: OLD_REVISION_ID,
    type: "model",
    format: "glb",
    name: "Pawn",
    contentType: "model/gltf-binary",
    metadata: {
        sourceAssetId: OLD_ASSET_ID,
        sourceRevisionId: OLD_REVISION_ID,
    },
    file: `${OLD_ASSET_ID}.glb`,
}]);

type CommitRecord = {body: ProjectBody; assets: StoredAsset[]};

const makeStore = () => {
    const commits: CommitRecord[] = [];
    const store: ProjectStore = {
        kind: "indexeddb",
        list: vi.fn(),
        load: vi.fn(),
        save: vi.fn(),
        delete: vi.fn(),
        exportToBlob: vi.fn(),
        importFromBlob: vi.fn(),
        saveAssets: vi.fn(),
        loadAssets: vi.fn(),
        commitProject: vi.fn(async (body, assets): Promise<ProjectMeta> => {
            commits.push({body, assets});
            return body.meta;
        }),
    };
    return {store, commits};
};

const makeBundleFiles = (body = makeProjectBody()): File[] => [
    makeFile(`Imported_Game.${OLD_PROJECT_ID}.stemscript.json`, JSON.stringify(body)),
    makeFile(`${OLD_PROJECT_ID}/assets.json`, makeManifest()),
    makeFile(`${OLD_PROJECT_ID}/${OLD_ASSET_ID}.glb`, "glb-bytes", "model/gltf-binary"),
];

describe("importProjectBundleFiles", () => {
    beforeEach(() => {
        resetOssAssetRegistryForTests();
        vi.stubGlobal("fetch", vi.fn(async () => {
            throw new Error("remote fetch should not be used");
        }));
    });

    it("imports a project bundle, remaps scene asset references, copies blobs, and registers local assets", async () => {
        const {store, commits} = makeStore();

        const result = await importProjectBundleFiles(makeBundleFiles(), store);

        expect(result.oldProjectId).toBe(OLD_PROJECT_ID);
        expect(result.assetsImported).toBe(1);
        expect(result.meta.id).toMatch(/^oss-/);
        expect(result.meta.id).not.toBe(OLD_PROJECT_ID);
        expect(store.commitProject).toHaveBeenCalledTimes(1);
        expect(globalThis.fetch).not.toHaveBeenCalled();

        const committed = commits[0]!;
        expect(committed.body.meta.id).toBe(result.meta.id);
        expect(committed.body.meta.extra?.importedFromProjectId).toBe(OLD_PROJECT_ID);
        expect(committed.assets).toHaveLength(1);

        const importedAsset = committed.assets[0]!;
        expect(importedAsset.assetId).toMatch(/^oss-asset-/);
        expect(importedAsset.assetId).not.toBe(OLD_ASSET_ID);
        expect(importedAsset.revisionId).toBe(`oss-rev-${importedAsset.assetId}`);
        expect(importedAsset.data).toBe(btoa("glb-bytes"));
        expect(importedAsset.metadata?.sourceAssetId).toBe(importedAsset.assetId);

        expect(committed.body.sceneJson).not.toContain(OLD_PROJECT_ID);
        expect(committed.body.sceneJson).not.toContain(OLD_ASSET_ID);
        expect(committed.body.sceneJson).not.toContain(OLD_REVISION_ID);
        expect(committed.body.sceneJson).toContain(importedAsset.assetId);
        expect(committed.body.sceneJson).toContain(importedAsset.revisionId);

        const registered = getOssAssetsForProject(result.meta.id);
        expect(registered).toHaveLength(1);
        expect(registered[0]!.assetId).toBe(importedAsset.assetId);
        expect(registered[0]!.dataUrl).toBe(`data:model/gltf-binary;base64,${btoa("glb-bytes")}`);
    });

    it("mints fresh project and asset IDs on duplicate imports", async () => {
        const {store, commits} = makeStore();

        const first = await importProjectBundleFiles(makeBundleFiles(), store);
        const second = await importProjectBundleFiles(makeBundleFiles(), store);

        expect(first.meta.id).not.toBe(second.meta.id);
        expect(commits[0]!.assets[0]!.assetId).not.toBe(commits[1]!.assets[0]!.assetId);
    });

    it("fails loudly and non-destructively when a manifest-listed asset file is missing", async () => {
        const {store} = makeStore();
        const files = [
            makeFile(`Imported_Game.${OLD_PROJECT_ID}.stemscript.json`, JSON.stringify(makeProjectBody())),
            makeFile(`${OLD_PROJECT_ID}/assets.json`, makeLegacyManifest()),
        ];

        await expect(importProjectBundleFiles(files, store)).rejects.toThrow(/Missing required asset file/);
        expect(store.commitProject).not.toHaveBeenCalled();
    });

    it("fails before commit when assetResolutionContext references an asset missing from the manifest", async () => {
        const {store} = makeStore();
        const files = [
            makeFile(`Imported_Game.${OLD_PROJECT_ID}.stemscript.json`, JSON.stringify(makeProjectBody())),
            makeFile(`${OLD_PROJECT_ID}/assets.json`, makeManifest([makeManifestEntry({
                assetId: OTHER_ASSET_ID,
                revisionId: OTHER_REVISION_ID,
                file: `${OTHER_ASSET_ID}.glb`,
            })])),
            makeFile(`${OLD_PROJECT_ID}/${OTHER_ASSET_ID}.glb`, "other-glb", "model/gltf-binary"),
        ];

        await expect(importProjectBundleFiles(files, store)).rejects.toThrow(/asset is missing from the sidecar manifest/);
        expect(store.commitProject).not.toHaveBeenCalled();
    });

    it("fails before commit when assetResolutionContext references a revision missing from the manifest", async () => {
        const {store} = makeStore();
        const files = [
            makeFile(`Imported_Game.${OLD_PROJECT_ID}.stemscript.json`, JSON.stringify(makeProjectBody())),
            makeFile(`${OLD_PROJECT_ID}/assets.json`, makeManifest([makeManifestEntry({
                revisionId: OLD_REVISION_ID_2,
                file: `${OLD_ASSET_ID}-v2.glb`,
            })])),
            makeFile(`${OLD_PROJECT_ID}/${OLD_ASSET_ID}-v2.glb`, "v2-glb", "model/gltf-binary"),
        ];

        await expect(importProjectBundleFiles(files, store)).rejects.toThrow(/revision is missing from the sidecar manifest/);
        expect(store.commitProject).not.toHaveBeenCalled();
    });

    it("commits when every assetResolutionContext pair has an exact manifest entry", async () => {
        const {store, commits} = makeStore();

        await importProjectBundleFiles(makeBundleFiles(), store);

        expect(store.commitProject).toHaveBeenCalledTimes(1);
        expect(commits[0]!.assets).toHaveLength(1);
        expect(commits[0]!.assets[0]!.data).toBe(btoa("glb-bytes"));
    });

    it("rejects revision-history bundles before commit because local stores key assets by assetId", async () => {
        const {store} = makeStore();
        const body = makeProjectBody({
            bundledAssets: {
                [OLD_ASSET_ID]: `head=${OLD_REVISION_ID}; previous=${OLD_REVISION_ID_2}`,
            },
        });
        const files = [
            makeFile(`Imported_Game.${OLD_PROJECT_ID}.stemscript.json`, JSON.stringify(body)),
            makeFile(`${OLD_PROJECT_ID}/assets.json`, makeManifest([
                makeManifestEntry({file: `${OLD_ASSET_ID}.glb`}),
                makeManifestEntry({
                    revisionId: OLD_REVISION_ID_2,
                    file: `${OLD_ASSET_ID}-v2.glb`,
                    name: "Pawn v2",
                }),
            ])),
            makeFile(`${OLD_PROJECT_ID}/${OLD_ASSET_ID}.glb`, "glb-v1", "model/gltf-binary"),
            makeFile(`${OLD_PROJECT_ID}/${OLD_ASSET_ID}-v2.glb`, "glb-v2", "model/gltf-binary"),
        ];

        await expect(importProjectBundleFiles(files, store)).rejects.toThrow(/Revision-history bundles are not supported/);
        expect(store.commitProject).not.toHaveBeenCalled();
    });

    it("imports a single .stemscript.json only when it has no sidecar asset references", async () => {
        const {store, commits} = makeStore();
        const body = makeProjectBody({
            sceneJson: JSON.stringify([{uuid: "scene-root", userData: {game: {isGame: true}}}]),
        });

        const result = await importProjectBundleFiles([
            makeFile(`Self_Contained.${OLD_PROJECT_ID}.stemscript.json`, JSON.stringify(body)),
        ], store);

        expect(result.assetsImported).toBe(0);
        expect(commits[0]!.assets).toEqual([]);
    });

    it("rejects a single .stemscript.json when sidecar assets are required", async () => {
        const {store} = makeStore();

        await expect(importProjectBundleFiles([
            makeFile(`Needs_Assets.${OLD_PROJECT_ID}.stemscript.json`, JSON.stringify(makeProjectBody())),
        ], store)).rejects.toThrow(/Import the containing folder/);
        expect(store.commitProject).not.toHaveBeenCalled();
    });

    it("rejects an incomplete project folder when the sidecar asset manifest is absent", async () => {
        const {store} = makeStore();

        await expect(importProjectBundleFiles([
            makeFile(`Needs_Assets.${OLD_PROJECT_ID}.stemscript.json`, JSON.stringify(makeProjectBody())),
            makeFile("README.txt", "not an asset manifest", "text/plain"),
        ], store)).rejects.toThrow(/Import the containing folder/);
        expect(store.commitProject).not.toHaveBeenCalled();
    });
});
