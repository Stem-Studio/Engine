
// @vitest-environment jsdom
import {beforeEach, describe, expect, it} from "vitest";

import {FileSystemProjectStore} from "./FileSystemProjectStore";
import type {ProjectBody, StoredAsset} from "./types";

const sampleBody = (name = "Demo", id = ""): ProjectBody => ({
    meta: {
        id,
        name,
        createdAt: "",
        updatedAt: "",
    },
    sceneJson: JSON.stringify({name}),
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

const notFound = (what: string): DOMException =>
    new DOMException(`missing ${what}`, "NotFoundError");

type StoredFile = Uint8Array<ArrayBuffer>;

const textToBytes = (value: string): StoredFile =>
    new TextEncoder().encode(value) as StoredFile;

const toStoredBytes = async (
    value: Blob | string | BufferSource,
): Promise<StoredFile> => {
    if (typeof value === "string") {
        return textToBytes(value);
    }

    if (value instanceof Blob) {
        return new Uint8Array(await value.arrayBuffer()) as StoredFile;
    }

    const source = value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(
              value.buffer as ArrayBuffer,
              value.byteOffset,
              value.byteLength,
          );

    return new Uint8Array(source) as StoredFile;
};

class MemoryFileHandle {
    readonly kind = "file" as const;

    constructor(
        readonly name: string,
        private readonly read: () => StoredFile | undefined,
        private readonly write: (value: StoredFile) => void,
    ) {}

    async getFile(): Promise<File> {
        const data = this.read();

        if (data === undefined) {
            throw notFound(`file ${this.name}`);
        }

        return new File(
            [data.buffer as ArrayBuffer],
            this.name,
            {type: "application/octet-stream"},
        );
    }

    async createWritable(): Promise<{
        write(data: Blob | string | BufferSource): Promise<void>;
        close(): Promise<void>;
    }> {
        let pending: StoredFile = textToBytes("");

        return {
            write: async data => {
                pending = await toStoredBytes(data);
            },
            close: async () => {
                this.write(pending);
            },
        };
    }
}

class MemoryDirectoryHandle {
    readonly kind = "directory" as const;
    readonly files = new Map<string, StoredFile>();
    readonly subdirs = new Map<string, MemoryDirectoryHandle>();

    constructor(readonly name = "projects") {}

    async getFileHandle(
        name: string,
        options?: {create?: boolean},
    ): Promise<MemoryFileHandle> {
        if (!this.files.has(name) && !options?.create) {
            throw notFound(`file ${name}`);
        }

        if (!this.files.has(name)) {
            this.files.set(name, textToBytes(""));
        }

        return new MemoryFileHandle(
            name,
            () => this.files.get(name),
            value => this.files.set(name, value),
        );
    }

    async getDirectoryHandle(
        name: string,
        options?: {create?: boolean},
    ): Promise<MemoryDirectoryHandle> {
        if (!this.subdirs.has(name)) {
            if (!options?.create) {
                throw notFound(`directory ${name}`);
            }

            this.subdirs.set(name, new MemoryDirectoryHandle(name));
        }

        return this.subdirs.get(name)!;
    }

    async removeEntry(name: string): Promise<void> {
        this.files.delete(name);
        this.subdirs.delete(name);
    }

    async *entries(): AsyncIterableIterator<
        [string, MemoryFileHandle | MemoryDirectoryHandle]
    > {
        for (const name of this.files.keys()) {
            yield [
                name,
                new MemoryFileHandle(
                    name,
                    () => this.files.get(name),
                    value => this.files.set(name, value),
                ),
            ];
        }

        for (const [name, sub] of this.subdirs) {
            yield [name, sub];
        }
    }

    /** Test helper: stage an asset folder with a manifest and asset files. */
    seedAssetDir(
        projectId: string,
        manifest: unknown,
        assetFiles: Record<string, string> = {},
    ): MemoryDirectoryHandle {
        const sub = new MemoryDirectoryHandle(projectId);

        sub.files.set(
            "assets.json",
            textToBytes(
                typeof manifest === "string"
                    ? manifest
                    : JSON.stringify(manifest),
            ),
        );

        for (const [file, content] of Object.entries(assetFiles)) {
            sub.files.set(file, textToBytes(content));
        }

        this.subdirs.set(projectId, sub);

        return sub;
    }
}

describe("FileSystemProjectStore", () => {
    let dir: MemoryDirectoryHandle;
    let store: FileSystemProjectStore;

    beforeEach(() => {
        dir = new MemoryDirectoryHandle();
        store = new FileSystemProjectStore(dir as never);
    });

    it("removes stale same-id filenames after a rename save", async () => {
        const first = await store.save(sampleBody("Old Name"));

        await store.save(sampleBody("New Name", first.id));

        const names = [...dir.files.keys()];

        expect(names).toHaveLength(1);
        expect(names[0]).toContain("New_Name");

        const loaded = await store.load(first.id);

        expect(loaded.meta.name).toBe("New Name");
    });

    it("deletes all same-id files when cleaning up an existing duplicate folder", async () => {
        const id = "project-1";

        const oldBody = sampleBody("Old", id);
        const newBody = sampleBody("New", id);

        oldBody.meta.updatedAt = "2026-01-01T00:00:00.000Z";
        newBody.meta.updatedAt = "2026-01-02T00:00:00.000Z";

        dir.files.set(
            `Old.${id}.stemscript.json`,
            textToBytes(JSON.stringify(oldBody)),
        );

        dir.files.set(
            `New.${id}.stemscript.json`,
            textToBytes(JSON.stringify(newBody)),
        );

        const loaded = await store.load(id);

        expect(loaded.meta.name).toBe("New");

        await store.delete(id);

        expect([...dir.files.keys()]).toEqual([]);
    });

    it("loadAssets returns [] when the project has no asset subdirectory", async () => {
        await expect(
            store.loadAssets("project-without-assets"),
        ).resolves.toEqual([]);
    });

    it("loadAssets returns the recorded assets when the manifest is valid", async () => {
        dir.seedAssetDir(
            "project-1",
            [
                {
                    file: "a.glb",
                    assetId: "a",
                    revisionId: "r",
                    type: "model",
                    name: "A",
                },
            ],
            {"a.glb": "GLBDATA"},
        );

        const assets = await store.loadAssets("project-1");

        expect(assets).toHaveLength(1);
        expect(assets[0]!.assetId).toBe("a");
    });

    it("loadAssets throws on a corrupt asset manifest", async () => {
        dir.seedAssetDir(
            "project-1",
            "{ this is not valid json",
        );

        await expect(
            store.loadAssets("project-1"),
        ).rejects.toThrow(/manifest.*unreadable|malformed/i);
    });

    it("loadAssets throws when a manifest-listed asset file is missing", async () => {
        dir.seedAssetDir(
            "project-1",
            [
                {
                    file: "b.glb",
                    assetId: "b",
                    revisionId: "r",
                    type: "model",
                    name: "B",
                },
            ],
        );

        await expect(
            store.loadAssets("project-1"),
        ).rejects.toThrow();
    });

    it("exports and imports a project together with its binary assets", async () => {
        const original = await store.save(sampleBody("Exportable"));
        const asset = sampleAsset();

        await store.saveAssets(original.id, [asset]);

        const blob = await store.exportToBlob(original.id);

        expect(blob.type).toBe("application/zip");

        // Remove the original so the imported project gets a new ID.
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

        await expect(
            store.loadAssets(imported.id),
        ).resolves.toEqual([]);
    });

    it("rejects malformed import blobs", async () => {
        const garbage = new Blob(
            [JSON.stringify({not: "a project"})],
            {type: "application/json"},
        );

        await expect(
            store.importFromBlob(garbage),
        ).rejects.toThrow();
    });
});
