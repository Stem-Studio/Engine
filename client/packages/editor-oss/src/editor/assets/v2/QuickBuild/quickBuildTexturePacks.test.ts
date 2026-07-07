import {afterEach, describe, expect, it, vi} from "vitest";
import * as THREE from "three";

import {createQuickBuildObject} from "./quickBuildObjects";
import {
    applyQuickBuildTexturePreset,
    clearQuickBuildTexturePackCaches,
    formatQuickBuildTexturePresetCredit,
    getTexturePresetsForKind,
    loadQuickBuildTexture,
    loadQuickBuildTexturePack,
    loadQuickBuildTexturePackIndex,
} from "./quickBuildTexturePacks";
import type {QuickBuildTexturePackManifest, QuickBuildTexturePreset} from "./quickBuildTexturePacks";

function response(body: unknown, ok = true) {
    return {
        ok,
        json: vi.fn().mockResolvedValue(body),
    } as unknown as Response;
}

afterEach(() => {
    clearQuickBuildTexturePackCaches();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("quickBuildTexturePacks", () => {
    it("formats texture preset license and attribution for UI affordances", () => {
        expect(formatQuickBuildTexturePresetCredit({
            label: "Tiny World Grass",
            license: "AGPL-3.0",
            attribution: "Tiny World Builder textures by Jason Kneen",
        })).toBe("Tiny World Grass (AGPL-3.0) - Tiny World Builder textures by Jason Kneen");
    });

    it("loads pack indexes and resolves manifest URLs relative to the index", async () => {
        const fetcher = vi.fn().mockResolvedValue(response({
            schema: "stem.quickBuildTexturePackIndex.v1",
            packs: [
                {
                    id: "tiny-world-builder",
                    label: "Tiny World Builder",
                    manifestUrl: "./tiny-world-builder/manifest.json",
                    license: "AGPL-3.0",
                },
            ],
        }));
        vi.stubGlobal("fetch", fetcher);

        const index = await loadQuickBuildTexturePackIndex("http://assets.test/packs/manifest.json");

        expect(fetcher).toHaveBeenCalledWith("http://assets.test/packs/manifest.json");
        expect(index?.packs[0]?.manifestUrl).toBe("http://assets.test/packs/tiny-world-builder/manifest.json");
    });

    it("caches parsed pack indexes and manifests for the current session", async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce(response({
                schema: "stem.quickBuildTexturePackIndex.v1",
                packs: [],
            }))
            .mockResolvedValueOnce(response({
                schema: "stem.quickBuildTexturePack.v1",
                id: "test-pack",
                label: "Test Pack",
                license: "custom",
                presets: [],
            }));
        vi.stubGlobal("fetch", fetcher);

        await loadQuickBuildTexturePackIndex("http://assets.test/packs/manifest.json");
        await loadQuickBuildTexturePackIndex("http://assets.test/packs/manifest.json");
        await loadQuickBuildTexturePack("http://assets.test/packs/test/manifest.json");
        await loadQuickBuildTexturePack("http://assets.test/packs/test/manifest.json");

        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("disposes loaded texture cache entries when caches are cleared", async () => {
        const texture = new THREE.Texture() as THREE.Texture<HTMLImageElement>;
        const disposeSpy = vi.spyOn(texture, "dispose");
        vi.spyOn(THREE.TextureLoader.prototype, "load").mockImplementation(
            (_url, onLoad) => {
                onLoad?.(texture);
                return texture;
            },
        );

        await loadQuickBuildTexture("http://assets.test/grass.png");
        clearQuickBuildTexturePackCaches();
        await Promise.resolve();

        expect(disposeSpy).toHaveBeenCalledTimes(1);
    });

    it("returns null when the optional pack index is not deployed", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({}, false)));

        await expect(loadQuickBuildTexturePackIndex("http://assets.test/packs/manifest.json")).resolves.toBeNull();
    });

    it("rejects malformed pack indexes and retries after a failed cache entry", async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce(response({schema: "invalid", packs: []}))
            .mockResolvedValueOnce(response({
                schema: "stem.quickBuildTexturePackIndex.v1",
                packs: [],
            }));
        vi.stubGlobal("fetch", fetcher);

        await expect(loadQuickBuildTexturePackIndex("http://assets.test/packs/manifest.json")).rejects.toThrow(
            "Invalid Quick Build texture pack index",
        );
        await expect(loadQuickBuildTexturePackIndex("http://assets.test/packs/manifest.json")).resolves.toEqual({
            schema: "stem.quickBuildTexturePackIndex.v1",
            packs: [],
        });
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("loads pack manifests and resolves texture URLs relative to the manifest", async () => {
        const fetcher = vi.fn().mockResolvedValue(response({
            schema: "stem.quickBuildTexturePack.v1",
            id: "tiny-world-builder",
            label: "Tiny World Builder",
            license: "AGPL-3.0",
            presets: [
                {
                    id: "grass",
                    label: "Grass",
                    category: "terrain",
                    stampKinds: ["ground"],
                    url: "./textures/grass.png",
                    license: "AGPL-3.0",
                },
            ],
        }));
        vi.stubGlobal("fetch", fetcher);

        const pack = await loadQuickBuildTexturePack("http://assets.test/packs/tiny-world-builder/manifest.json");

        expect(pack.presets[0]?.url).toBe("http://assets.test/packs/tiny-world-builder/textures/grass.png");
    });

    it("rejects missing and malformed pack manifests", async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce(response({}, false))
            .mockResolvedValueOnce(response({
                schema: "stem.quickBuildTexturePack.v1",
                id: "test-pack",
                label: "Test Pack",
                license: "custom",
                presets: [],
            }))
            .mockResolvedValueOnce(response({schema: "invalid", presets: []}));
        vi.stubGlobal("fetch", fetcher);

        await expect(loadQuickBuildTexturePack("http://assets.test/packs/missing/manifest.json")).rejects.toThrow(
            "Could not load Quick Build texture pack manifest",
        );
        await expect(loadQuickBuildTexturePack("http://assets.test/packs/missing/manifest.json")).resolves.toMatchObject({
            id: "test-pack",
        });
        await expect(loadQuickBuildTexturePack("http://assets.test/packs/bad/manifest.json")).rejects.toThrow(
            "Invalid Quick Build texture pack manifest",
        );
    });

    it("keeps Tiny World reference sheets out of placeable Quick Build presets", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
            schema: "stem.quickBuildTexturePack.v1",
            id: "tiny-world-builder",
            label: "Tiny World Builder",
            license: "AGPL-3.0",
            presets: [
                {
                    id: "tw-hjcliejbeaa9ah2",
                    label: "Reference Sheet",
                    category: "terrain",
                    stampKinds: ["ground"],
                    url: "./textures/HJCliEjbEAA9Ah2.jpeg",
                    license: "AGPL-3.0",
                    attribution: "Tiny World Builder textures by Jason Kneen",
                },
                {
                    id: "tw-terrain-variants-grass-plain-01",
                    label: "Grass Plain 01",
                    category: "terrain",
                    stampKinds: ["ground"],
                    url: "./textures/terrain-variants/grass-plain-01.png",
                    license: "AGPL-3.0",
                    attribution: "Tiny World Builder textures by Jason Kneen",
                },
            ],
        })));

        const pack = await loadQuickBuildTexturePack("http://assets.test/packs/tiny-world-builder/manifest.json");

        expect(pack.presets[0]).toMatchObject({category: "reference", stampKinds: []});
        expect(getTexturePresetsForKind(pack, "ground").map(preset => preset.id)).toEqual([
            "tw-terrain-variants-grass-plain-01",
        ]);
    });

    it("filters presets by compatible quick build stamp kind", () => {
        const water = {
            id: "water",
            label: "Water",
            category: "water",
            stampKinds: ["water"],
            url: "http://assets.test/water.png",
            license: "AGPL-3.0",
        } satisfies QuickBuildTexturePreset;
        const grass = {
            id: "grass",
            label: "Grass",
            category: "terrain",
            stampKinds: ["ground", "sand", "farm"],
            url: "http://assets.test/grass.png",
            license: "AGPL-3.0",
        } satisfies QuickBuildTexturePreset;
        const planks = {
            id: "planks",
            label: "Planks",
            category: "wood",
            stampKinds: ["bridge", "fence", "house"],
            url: "http://assets.test/planks.png",
            license: "AGPL-3.0",
        } satisfies QuickBuildTexturePreset;
        const pack = {
            schema: "stem.quickBuildTexturePack.v1",
            id: "test-pack",
            label: "Test Pack",
            license: "AGPL-3.0",
            presets: [water, grass, planks],
        } satisfies QuickBuildTexturePackManifest;

        expect(getTexturePresetsForKind(pack, "water")).toEqual([water]);
        expect(getTexturePresetsForKind(pack, "ground")).toEqual([grass]);
        expect(getTexturePresetsForKind(pack, "sand")).toEqual([grass]);
        expect(getTexturePresetsForKind(pack, "farm")).toEqual([grass]);
        expect(getTexturePresetsForKind(pack, "bridge")).toEqual([planks]);
        expect(getTexturePresetsForKind(pack, "fence")).toEqual([planks]);
    });

    it("applies compatible texture presets to quick build stamp top materials", () => {
        const object = createQuickBuildObject("ground");
        const texture = new THREE.Texture();
        const preset = {
            id: "grass",
            label: "Grass",
            category: "terrain",
            stampKinds: ["ground"],
            url: "http://assets.test/grass.png",
            license: "AGPL-3.0",
        } satisfies QuickBuildTexturePreset;

        expect(applyQuickBuildTexturePreset(object, preset, texture)).toBe(true);

        let texturedMaterialSlots = 0;
        object.traverse(child => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) return;

            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach(material => {
                if ((material as THREE.MeshStandardMaterial).map === texture) texturedMaterialSlots += 1;
            });
            expect((materials[0] as THREE.MeshStandardMaterial).map).not.toBe(texture);
            expect((materials[2] as THREE.MeshStandardMaterial).map).toBe(texture);
        });
        expect(texturedMaterialSlots).toBe(1);
        expect(object.userData.quickBuildTexture).toMatchObject({
            presetId: "grass",
            label: "Grass",
            license: "AGPL-3.0",
        });
    });

    it("applies water tile textures as opaque top materials", () => {
        const object = createQuickBuildObject("water");
        const texture = new THREE.Texture();
        const preset = {
            id: "water",
            label: "Water",
            category: "water",
            stampKinds: ["water"],
            url: "http://assets.test/water.png",
            license: "AGPL-3.0",
        } satisfies QuickBuildTexturePreset;

        expect(applyQuickBuildTexturePreset(object, preset, texture)).toBe(true);

        const mesh = object.children[0] as THREE.Mesh;
        const materials = mesh.material as THREE.MeshStandardMaterial[];
        expect(materials[2]?.map).toBe(texture);
        expect(materials[2]?.transparent).toBe(false);
        expect(materials[2]?.opacity).toBe(1);
        expect(materials[2]?.depthWrite).toBe(true);
    });

    it("applies connected bridge textures only to bridge deck pieces", () => {
        const object = createQuickBuildObject("bridge");
        const texture = new THREE.Texture();
        const preset = {
            id: "planks",
            label: "Planks",
            category: "wood",
            stampKinds: ["bridge"],
            url: "http://assets.test/planks.png",
            license: "AGPL-3.0",
        } satisfies QuickBuildTexturePreset;

        expect(applyQuickBuildTexturePreset(object, preset, texture)).toBe(true);

        const texturedParts: string[] = [];
        object.traverse(child => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) return;
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            if (materials.some(material => (material as THREE.MeshStandardMaterial).map === texture)) {
                texturedParts.push(String(mesh.userData.quickBuildPart));
            }
        });

        expect(texturedParts).toContain("bridge-center");
        expect(texturedParts).toContain("bridge-east");
        expect(texturedParts).toContain("bridge-west");
        expect(texturedParts).not.toContain("bridge-rail");
    });

    it("repairs legacy hidden quick build materials when repainting occupied cells", () => {
        const object = new THREE.Group();
        object.visible = false;
        object.userData.quickBuild = {kind: "ground", level: 1};
        object.userData.isQuickBuildObject = true;
        object.userData.editorVisibility = false;

        const material = new THREE.MeshStandardMaterial({color: 0x4f8f3a});
        material.visible = false;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 0.12, 4), material);
        mesh.userData.quickBuildPart = "ground-tile";
        object.add(mesh);

        const texture = new THREE.Texture();
        const preset = {
            id: "grass",
            label: "Grass",
            category: "terrain",
            stampKinds: ["ground"],
            url: "http://assets.test/grass.png",
            license: "AGPL-3.0",
        } satisfies QuickBuildTexturePreset;

        expect(applyQuickBuildTexturePreset(object, preset, texture)).toBe(true);

        const nextMaterial = mesh.material as THREE.MeshStandardMaterial;
        expect(object.visible).toBe(true);
        expect(object.userData.editorVisibility).toBe(true);
        expect(object.userData.isBatchable).toBe(false);
        expect(mesh.userData.isBatchable).toBe(false);
        expect(nextMaterial.visible).toBe(true);
        expect(nextMaterial.map).toBe(texture);
    });
});
