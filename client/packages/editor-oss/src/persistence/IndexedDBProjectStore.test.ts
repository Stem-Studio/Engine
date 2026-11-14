
// @vitest-environment jsdom
import "fake-indexeddb/auto";
import {IDBFactory} from "fake-indexeddb";

import {beforeEach, describe, expect, it, vi} from "vitest";

import type {IndexedDBProjectStore as IndexedDBProjectStoreType} from "./IndexedDBProjectStore";
import type {ProjectBody, StoredAsset} from "./types";

const sampleBody = (name = "Demo"): ProjectBody => ({
    meta: {
        id: "",
        name,
        createdAt: "",
        updatedAt: "",
    },
    sceneJson: JSON.stringify({hello: "world"}),
});

const sampleAsset = (): StoredAsset => ({
    assetId: "asset-model-1",
    revisionId: "revision-1",
    type: "model",
    format: "glb",
    name: "TestModel",
    contentType: "model/gltf-binary",
    data: "R0xCRGF0YQ==",
    thumbnailData: "UE5H",
    thumbnailContentType: "image/png",
});

describe("IndexedDBProjectStore round trip", () => {
    let IndexedDBProjectStore: typeof IndexedDBProjectStoreType;
    let store: IndexedDBProjectStoreType;

    beforeEach(async () => {
        // Reset both the IDB factory and the module-level dbPromise cache so
        // each test starts from a clean DB.
        vi.stubGlobal("indexedDB", new IDBFactory());
        vi.resetModules();

        const mod = await import("./IndexedDBProjectStore");
        IndexedDBProjectStore = mod.IndexedDBProjectStore;
        store = new IndexedDBProjectStore();
    });

    it("assigns id + timestamps on save", async () => {
        const meta = await store.save(sampleBody("First"));

        expect(meta.id).not.toBe("");
        expect(meta.name).toBe("First");
        expect(new Date(meta.createdAt).getTime()).toBeGreaterThan(0);
        expect(new Date(meta.updatedAt).getTime()).toBeGreaterThan(0);
    });

    it("round-trips a saved project via list+load", async () => {
        const meta = await store.save(sampleBody("Trip"));

        const result = await store.list();

        expect(result.projects).toHaveLength(1);
        expect(result.projects[0]!.id).toBe(meta.id);

        const loaded = await store.load(meta.id);

        expect(loaded.sceneJson).toBe(JSON.stringify({hello: "world"}));
    });

    it("sorts the list by updatedAt descending", async () => {
        const a = await store.save(sampleBody("A"));

        await new Promise(resolve => setTimeout(resolve, 5));

        const b = await store.save(sampleBody("B"));
        const result = await store.list();

        expect(result.projects.map(project => project.id)).toEqual([
            b.id,
            a.id,
        ]);
    });

    it("filters by search substring (case-insensitive)", async () => {
        await store.save(sampleBody("Garden Party"));
        await store.save(sampleBody("Space Shooter"));

        const result = await store.list({search: "GARDEN"});

        expect(result.projects).toHaveLength(1);
        expect(result.projects[0]!.name).toBe("Garden Party");
    });

    it("paginates", async () => {
        for (let i = 0; i < 5; i += 1) {
            await store.save(sampleBody(`Proj ${i}`));
        }

        const page1 = await store.list({page: 1, limit: 2});

        expect(page1.projects).toHaveLength(2);
        expect(page1.hasMore).toBe(true);

        const page3 = await store.list({page: 3, limit: 2});

        expect(page3.projects).toHaveLength(1);
        expect(page3.hasMore).toBe(false);
    });

    it("deletes a project and its assets", async () => {
        const meta = await store.save(sampleBody("To Delete"));

        await store.saveAssets(meta.id, [sampleAsset()]);
        await store.delete(meta.id);

        await expect(store.load(meta.id)).rejects.toThrow("not found");
        await expect(store.loadAssets(meta.id)).resolves.toEqual([]);

        const result = await store.list();

        expect(result.projects).toHaveLength(0);
    });

    it("exports and imports a project together with its binary assets", async () => {
        const original = await store.save(sampleBody("Exportable"));
        const asset = sampleAsset();

        await store.saveAssets(original.id, [asset]);

        const blob = await store.exportToBlob(original.id);

        expect(blob.type).toBe("application/zip");

        // Delete original so import has a fresh project ID.
        await store.delete(original.id);

        const imported = await store.importFromBlob(blob);

        expect(imported.id).not.toBe(original.id);
        expect(imported.name).toBe("Exportable");

        const restoredProject = await store.load(imported.id);
        const restoredAssets = await store.loadAssets(imported.id);

        expect(restoredProject.sceneJson).toBe(
            sampleBody("Exportable").sceneJson,
        );
        expect(restoredAssets).toEqual([asset]);
    });

    it("imports a legacy JSON project without binary assets", async () => {
        const legacyProject = sampleBody("Legacy Export");

        const blob = new Blob(
            [JSON.stringify(legacyProject)],
            {type: "application/json"},
        );

        const imported = await store.importFromBlob(blob);

        expect(imported.name).toBe("Legacy Export");

        const restored = await store.load(imported.id);

        expect(restored.sceneJson).toBe(legacyProject.sceneJson);
        await expect(store.loadAssets(imported.id)).resolves.toEqual([]);
    });

    it("rejects malformed import blobs", async () => {
        const garbage = new Blob(
            [JSON.stringify({not: "a project"})],
            {type: "application/json"},
        );

        await expect(store.importFromBlob(garbage)).rejects.toThrow(
            "not a valid Stem Studio project",
        );
    });
});
