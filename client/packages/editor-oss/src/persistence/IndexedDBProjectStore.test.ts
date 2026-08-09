// @vitest-environment jsdom
import "fake-indexeddb/auto";
import {IDBFactory} from "fake-indexeddb";

import {beforeEach, describe, expect, it, vi} from "vitest";

import type {IndexedDBProjectStore as IndexedDBProjectStoreType} from "./IndexedDBProjectStore";
import type {ProjectBody} from "./types";
import type {StoredAsset} from "./types";

const sampleBody = (name = "Demo"): ProjectBody => ({
    meta: {
        id: "",
        name,
        createdAt: "",
        updatedAt: "",
    },
    sceneJson: JSON.stringify({hello: "world"}),
});

describe("IndexedDBProjectStore round trip", () => {
    let IndexedDBProjectStore: typeof IndexedDBProjectStoreType;
    let store: IndexedDBProjectStoreType;

    beforeEach(async () => {
        // Reset both the IDB factory and the module-level dbPromise cache so
        // each test starts from a clean DB. `vi.resetModules` re-evaluates
        // the store module, dropping its cached `dbPromise`.
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
        await new Promise(r => setTimeout(r, 5));
        const b = await store.save(sampleBody("B"));
        const result = await store.list();
        expect(result.projects.map(p => p.id)).toEqual([b.id, a.id]);
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

    it("deletes a project", async () => {
        const meta = await store.save(sampleBody("To Delete"));
        await store.delete(meta.id);
        await expect(store.load(meta.id)).rejects.toThrow("not found");
        const result = await store.list();
        expect(result.projects).toHaveLength(0);
    });

    it("exports as JSON blob and imports back", async () => {
        const original = await store.save(sampleBody("Exportable"));

        const blob = await store.exportToBlob(original.id);
        expect(blob.type).toBe("application/json");
        const parsed = JSON.parse(await blob.text()) as ProjectBody;
        expect(parsed.meta.name).toBe("Exportable");

        // Delete original so import has fresh state.
        await store.delete(original.id);

        const imported = await store.importFromBlob(blob);
        expect(imported.id).not.toBe(original.id); // fresh id assigned
        expect(imported.name).toBe("Exportable");
    });

    it("rejects malformed import blobs", async () => {
        const garbage = new Blob([JSON.stringify({not: "a project"})], {type: "application/json"});
        await expect(store.importFromBlob(garbage)).rejects.toThrow("not a valid .stemscript");
    });

    it("keeps the prior scene and assets when an atomic commit aborts", async () => {
        const originalBody = sampleBody("Last Known Good");
        originalBody.meta.id = "atomic-project";
        const oldAsset: StoredAsset = {
            assetId: "old",
            revisionId: "r1",
            type: "model",
            format: "glb",
            name: "Old",
            data: "T0xE",
        };
        await store.commitProject(originalBody, [oldAsset]);

        const brokenBody = sampleBody("Broken Replacement");
        brokenBody.meta.id = "atomic-project";
        const uncloneableAsset = {
            ...oldAsset,
            assetId: "new",
            metadata: {uncloneable: () => undefined},
        } as unknown as StoredAsset;

        await expect(store.commitProject(brokenBody, [uncloneableAsset])).rejects.toThrow();

        expect((await store.load("atomic-project")).meta.name).toBe("Last Known Good");
        expect((await store.loadAssets("atomic-project")).map(asset => asset.assetId)).toEqual(["old"]);
    });
});
