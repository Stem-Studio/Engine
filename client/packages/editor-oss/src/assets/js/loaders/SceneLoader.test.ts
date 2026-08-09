import {BoxGeometry, Mesh, MeshStandardMaterial, Object3D, Scene, Texture} from "three";
import {beforeEach, describe, expect, it, vi} from "vitest";

const hoisted = vi.hoisted(() => ({
    ajaxGet: vi.fn(),
    sceneAsGroupFromJson: vi.fn(),
    getGifTexture: vi.fn(),
}));

vi.mock("../../../utils/Ajax", () => ({
    default: {
        get: hoisted.ajaxGet,
    },
}));

vi.mock("../../../serialization/Converter", () => ({
    default: class MockConverter {
        sceneAsGroupFromJson = hoisted.sceneAsGroupFromJson;
    },
}));

vi.mock("../../../utils/GifTexture", () => ({
    THREE_GetGifTexture: hoisted.getGifTexture,
}));

import SceneLoader from "./SceneLoader";

describe("SceneLoader", () => {
    beforeEach(() => {
        hoisted.ajaxGet.mockReset();
        hoisted.sceneAsGroupFromJson.mockReset();
        hoisted.getGifTexture.mockReset();
    });

    it("awaits GIF texture replacement through deep scenes without recursive Object3D traversal", async () => {
        const scene = new Scene();
        let cursor: Object3D = scene;
        for (let i = 0; i < 12000; i++) {
            const child = new Object3D();
            cursor.add(child);
            cursor = child;
        }

        const gifTexture = new Texture() as Texture & {gifUrl?: string};
        gifTexture.gifUrl = "/textures/animated.gif";
        const replacementTexture = new Texture();
        const material = new MeshStandardMaterial({map: gifTexture});
        const mesh = new Mesh(new BoxGeometry(), material);
        cursor.add(mesh);

        const traverseSpy = vi.spyOn(scene, "traverse");
        const callback = vi.fn((loadedScene: Object3D) => {
            expect(loadedScene).toBe(scene);
            expect(material.map).toBe(replacementTexture);
        });

        hoisted.ajaxGet.mockResolvedValue({data: {Code: 200, Data: {scene: "payload"}}});
        hoisted.sceneAsGroupFromJson.mockResolvedValue({scene});
        hoisted.getGifTexture.mockImplementation(async () => replacementTexture);

        await expect(new SceneLoader().load("/scene.json", callback)).resolves.toBe(scene);

        expect(hoisted.getGifTexture).toHaveBeenCalledWith("/textures/animated.gif");
        expect(callback).toHaveBeenCalledTimes(1);
        expect(traverseSpy).not.toHaveBeenCalled();
    });
});
