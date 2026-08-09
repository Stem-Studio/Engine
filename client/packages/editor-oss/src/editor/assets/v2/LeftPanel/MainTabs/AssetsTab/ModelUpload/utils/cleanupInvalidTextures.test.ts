import * as THREE from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import {cleanupInvalidTextures, detectMissingTextures} from "./cleanupInvalidTextures";

vi.mock("/assets/textures/default-placeholder.png", () => ({
    default: "/assets/textures/default-placeholder.png",
}));

const createMesh = (material: THREE.Material) =>
    new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);

describe("cleanupInvalidTextures", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("does not load the default placeholder texture when no invalid textures exist", async () => {
        const loadSpy = vi.spyOn(THREE.TextureLoader.prototype, "load");
        const root = new THREE.Object3D();
        root.add(createMesh(new THREE.MeshBasicMaterial({color: 0xffffff})));

        const changed = await cleanupInvalidTextures(root);

        expect(changed).toBe(false);
        expect(loadSpy).not.toHaveBeenCalled();
    });

    it("loads the placeholder texture only when replacing an invalid diffuse map", async () => {
        const replacementTexture = new THREE.Texture() as THREE.Texture<HTMLImageElement>;
        (replacementTexture as THREE.Texture & {image: {width: number; height: number}}).image = {width: 2, height: 2};
        const loadSpy = vi.spyOn(THREE.TextureLoader.prototype, "load").mockImplementation(
            (_url, onLoad) => {
                onLoad?.(replacementTexture);
                return replacementTexture;
            },
        );
        const invalidTexture = new THREE.Texture();
        invalidTexture.image = {width: 0, height: 0};
        const material = new THREE.MeshBasicMaterial({map: invalidTexture});
        const root = new THREE.Object3D();
        root.add(createMesh(material));

        const changed = await cleanupInvalidTextures(root);

        expect(changed).toBe(true);
        expect(loadSpy).toHaveBeenCalledTimes(1);
        expect(material.map).not.toBe(invalidTexture);
    });

    it("repairs a shared material slot once instead of leaking overwritten clones", async () => {
        const cloneSpy = vi.spyOn(THREE.Texture.prototype, "clone");
        const invalidTexture = new THREE.Texture();
        invalidTexture.image = {width: 0, height: 0};
        const material = new THREE.MeshBasicMaterial({map: invalidTexture});
        const root = new THREE.Object3D();
        root.add(createMesh(material), createMesh(material));

        const changed = await cleanupInvalidTextures(root);

        expect(changed).toBe(true);
        expect(cloneSpy).toHaveBeenCalledTimes(1);
        expect(material.map).not.toBe(invalidTexture);
    });

    it("handles deep imported hierarchies without Three's recursive traversal", async () => {
        const traverseSpy = vi.spyOn(THREE.Object3D.prototype, "traverse");
        const validTexture = new THREE.Texture();
        validTexture.image = {width: 2, height: 2};
        const root = new THREE.Object3D();
        let parent = root;
        for (let i = 0; i < 12_000; i++) {
            const child = new THREE.Object3D();
            parent.add(child);
            parent = child;
        }
        parent.add(createMesh(new THREE.MeshBasicMaterial({map: validTexture})));

        expect(detectMissingTextures(root)).toBe(false);
        await expect(cleanupInvalidTextures(root, {
            batchSize: Number.MAX_SAFE_INTEGER,
            frameBudgetMs: Number.MAX_SAFE_INTEGER,
        })).resolves.toBe(false);
        expect(traverseSpy).not.toHaveBeenCalled();
    });
});
