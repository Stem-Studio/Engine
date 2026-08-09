
import { BoxGeometry, Mesh, MeshStandardMaterial, Object3D, Scene, Texture } from 'three';
import {vi} from "vitest";

import {
    checkSceneTextures,
    TextureSizeThresholds,
} from "./TextureCheckerUtils";

function addDeepChain(root: Object3D, depth = 12_000): Object3D {
    let cursor = root;
    for (let i = 0; i < depth; i++) {
        const child = new Object3D();
        cursor.add(child);
        cursor = child;
    }
    return cursor;
}

describe("TextureCheckerUtils", () => {
    let scene: Scene;
    let mesh: Mesh;
    let material: MeshStandardMaterial;

    beforeEach(() => {
        scene = new Scene();
        scene.name = "TextureCheckerTestScene";
        const geometry = new BoxGeometry(1, 1, 1);
        material = new MeshStandardMaterial();
        mesh = new Mesh(geometry, material);
        mesh.name = "TestCube";
        scene.add(mesh);
    });

    afterEach(() => {
        // Clean up scene children manually
        while (scene.children.length > 0) {
            scene.remove(scene.children[0]!);
        }
    });

    describe("checkSceneTextures", () => {
        it("should return no large textures when scene has no textures", () => {
            const result = checkSceneTextures(scene);

            expect(result.hasLargeTextures).toBe(false);
            expect(result.warningTextures).toHaveLength(0);
            expect(result.criticalTextures).toHaveLength(0);
            expect(result.totalTexturesChecked).toBe(0);
        });

        it("should detect a small texture and not report it", () => {
            const texture = new Texture();
            const canvas = document.createElement("canvas");
            canvas.width = 512;
            canvas.height = 512;
            texture.image = canvas;
            material.map = texture;

            const result = checkSceneTextures(scene);

            expect(result.hasLargeTextures).toBe(false);
            expect(result.warningTextures).toHaveLength(0);
            expect(result.criticalTextures).toHaveLength(0);
        });

        it("should detect a 2K texture as warning", () => {
            const texture = new Texture();
            const canvas = document.createElement("canvas");
            canvas.width = 2048;
            canvas.height = 2048;
            texture.image = canvas;
            texture.name = "TestTexture2K";
            material.map = texture;

            const result = checkSceneTextures(scene);

            expect(result.hasLargeTextures).toBe(true);
            expect(result.warningTextures).toHaveLength(1);
            expect(result.criticalTextures).toHaveLength(0);
            expect(result.warningTextures[0]!.width).toBe(2048);
            expect(result.warningTextures[0]!.height).toBe(2048);
        });

        it("should detect a 4K texture as critical", () => {
            const texture = new Texture();
            const canvas = document.createElement("canvas");
            canvas.width = 4096;
            canvas.height = 4096;
            texture.image = canvas;
            texture.name = "TestTexture4K";
            material.map = texture;

            const result = checkSceneTextures(scene);

            expect(result.hasLargeTextures).toBe(true);
            expect(result.warningTextures).toHaveLength(0);
            expect(result.criticalTextures).toHaveLength(1);
            expect(result.criticalTextures[0]!.width).toBe(4096);
            expect(result.criticalTextures[0]!.height).toBe(4096);
        });

        it("should detect multiple texture types on same material", () => {
            // Add diffuse texture
            const diffuseTexture = new Texture();
            const canvas1 = document.createElement("canvas");
            canvas1.width = 2048;
            canvas1.height = 2048;
            diffuseTexture.image = canvas1;
            diffuseTexture.name = "DiffuseTexture";
            material.map = diffuseTexture;

            // Add normal map
            const normalTexture = new Texture();
            const canvas2 = document.createElement("canvas");
            canvas2.width = 2048;
            canvas2.height = 2048;
            normalTexture.image = canvas2;
            normalTexture.name = "NormalTexture";
            material.normalMap = normalTexture;

            const result = checkSceneTextures(scene);

            expect(result.hasLargeTextures).toBe(true);
            expect(result.warningTextures.length).toBeGreaterThanOrEqual(2);
        });

        it("should use custom thresholds", () => {
            const customThresholds: TextureSizeThresholds = {
                warningSize: 1024 * 1024, // 1K
                criticalSize: 2048 * 2048, // 2K
                warningMemoryMB: 4,
                criticalMemoryMB: 16,
            };

            const texture = new Texture();
            const canvas = document.createElement("canvas");
            canvas.width = 1024;
            canvas.height = 1024;
            texture.image = canvas;
            material.map = texture;

            const result = checkSceneTextures(scene, customThresholds);

            expect(result.hasLargeTextures).toBe(true);
            expect(result.warningTextures).toHaveLength(1);
        });

        it("should handle multiple objects with textures", () => {
            // First object with 2K texture
            const texture1 = new Texture();
            const canvas1 = document.createElement("canvas");
            canvas1.width = 2048;
            canvas1.height = 2048;
            texture1.image = canvas1;
            texture1.name = "Texture1";
            material.map = texture1;

            // Second object with different 4K texture
            const geometry2 = new BoxGeometry(1, 1, 1);
            const material2 = new MeshStandardMaterial();
            const mesh2 = new Mesh(geometry2, material2);
            mesh2.name = "TestCube2";

            const texture2 = new Texture();
            const canvas2 = document.createElement("canvas");
            canvas2.width = 4096;
            canvas2.height = 4096;
            texture2.image = canvas2;
            texture2.name = "Texture2";
            material2.map = texture2;

            scene.add(mesh2);

            const result = checkSceneTextures(scene);

            expect(result.hasLargeTextures).toBe(true);
            expect(result.warningTextures).toHaveLength(1);
            expect(result.criticalTextures).toHaveLength(1);
        });

        it("should not count the same texture multiple times when shared", () => {
            // Create one texture shared by two materials
            const sharedTexture = new Texture();
            const canvas = document.createElement("canvas");
            canvas.width = 2048;
            canvas.height = 2048;
            sharedTexture.image = canvas;
            sharedTexture.name = "SharedTexture";

            material.map = sharedTexture;

            // Second object with same texture
            const geometry2 = new BoxGeometry(1, 1, 1);
            const material2 = new MeshStandardMaterial();
            material2.map = sharedTexture; // Same texture reference
            const mesh2 = new Mesh(geometry2, material2);
            mesh2.name = "TestCube2";
            scene.add(mesh2);

            const result = checkSceneTextures(scene);

            expect(result.hasLargeTextures).toBe(true);
            // Should only count once despite being used twice
            expect(result.totalTexturesChecked).toBe(1);
        });

        it("should handle textures without image data gracefully", () => {
            const texture = new Texture();
            // No image set
            material.map = texture;

            const result = checkSceneTextures(scene);

            expect(result.hasLargeTextures).toBe(false);
            expect(result.totalTexturesChecked).toBe(0);
        });

        it("should estimate memory usage correctly", () => {
            const texture = new Texture();
            const canvas = document.createElement("canvas");
            canvas.width = 2048;
            canvas.height = 2048;
            texture.image = canvas;
            material.map = texture;

            const result = checkSceneTextures(scene);

            expect(result.warningTextures).toHaveLength(1);
            const textureInfo = result.warningTextures[0]!;
            // For 2048x2048 RGBA with mipmaps: 2048*2048*4*1.33 / (1024*1024) ≈ 21.33 MB
            expect(textureInfo.estimatedMemoryMB).toBeGreaterThan(20);
            expect(textureInfo.estimatedMemoryMB).toBeLessThan(25);
        });

        it("should scan deeply nested scenes without Three recursive traversal", () => {
            const deepScene = new Scene();
            const leaf = addDeepChain(deepScene);
            const deepMaterial = new MeshStandardMaterial();
            const deepMesh = new Mesh(new BoxGeometry(1, 1, 1), deepMaterial);
            deepMesh.name = "DeepTexturedMesh";
            const texture = new Texture();
            const canvas = document.createElement("canvas");
            canvas.width = 2048;
            canvas.height = 2048;
            texture.image = canvas;
            texture.name = "DeepTexture2K";
            deepMaterial.map = texture;
            leaf.add(deepMesh);
            const traverse = vi.spyOn(deepScene, "traverse");

            const result = checkSceneTextures(deepScene);

            expect(traverse).not.toHaveBeenCalled();
            expect(result.hasLargeTextures).toBe(true);
            expect(result.warningTextures).toHaveLength(1);
            expect(result.warningTextures[0]!.objectName).toBe("DeepTexturedMesh");
        });
    });

    describe("texture type detection", () => {
        it("should correctly identify different texture types", () => {
            const createLargeTexture = () => {
                const texture = new Texture();
                const canvas = document.createElement("canvas");
                canvas.width = 2048;
                canvas.height = 2048;
                texture.image = canvas;
                return texture;
            };

            material.map = createLargeTexture(); // Diffuse
            material.normalMap = createLargeTexture(); // Normal
            material.roughnessMap = createLargeTexture(); // Roughness

            const result = checkSceneTextures(scene);

            const textureTypes = result.warningTextures.map(t => t.textureType);
            expect(textureTypes).toContain("Diffuse/Color");
            expect(textureTypes).toContain("Normal");
            expect(textureTypes).toContain("Roughness");
        });
    });
});
