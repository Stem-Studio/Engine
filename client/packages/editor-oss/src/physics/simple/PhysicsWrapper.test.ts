import {Object3D, Scene} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import global from "@stem/editor-oss/global";
import {PhysicsWrapper} from "./PhysicsWrapper";
import {MultiplayerUtils} from "./MultiplayerUtils";

function addDeepChain(root: Object3D, depth = 12_000): Object3D {
    let cursor = root;
    for (let i = 0; i < depth; i++) {
        const child = new Object3D();
        cursor.add(child);
        cursor = child;
    }
    return cursor;
}

describe("PhysicsWrapper", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        global.app = null;
    });

    it("tags cloned player descendants without recursive Object3D traversal", async () => {
        const scene = new Scene();
        const player = new Object3D();
        player.userData.physics = {enabled: true};
        const leaf = addDeepChain(player);
        scene.add(player);
        const addPlayerObject = vi.fn(async () => player);
        const setPlayer = vi.fn();
        const clonePlayerObject = vi
            .spyOn(MultiplayerUtils, "clonePlayerObject")
            .mockResolvedValue(player);
        const traverse = vi.spyOn(Object3D.prototype, "traverse").mockImplementation(() => {
            throw new Error("recursive traversal should not be used");
        });
        global.app = {
            game: {
                useAvatar: vi.fn(() => false),
            },
        } as any;
        const wrapper = Object.create(PhysicsWrapper.prototype) as PhysicsWrapper;
        (wrapper as any).scene = scene;
        (wrapper as any).physics = {addPlayerObject};
        (wrapper as any).mpClient = {
            getSlot: vi.fn(() => 2),
            setPlayer,
            userId: "local-user",
        };

        const result = await wrapper.addPlayerObject("prefab-uuid", true);

        expect(result).toBe(player);
        expect(clonePlayerObject).toHaveBeenCalledWith(wrapper, "prefab-uuid", scene, undefined, 2);
        expect(addPlayerObject).toHaveBeenCalledWith(player.uuid, true, undefined);
        expect(setPlayer).toHaveBeenCalledWith(player);
        expect(player.userData.originalPlayerObject).toBe(true);
        expect(leaf.userData.originalPlayerObject).toBe(true);
        expect(traverse).not.toHaveBeenCalled();
    });

    it("does not register a multiplayer player when physics rejects character-controller setup", async () => {
        const scene = new Scene();
        const player = new Object3D();
        player.userData.physics = {enabled: true};
        scene.add(player);
        const addPlayerObject = vi.fn(async () => {
            throw new Error("Failed to add character controller");
        });
        const setPlayer = vi.fn();
        vi.spyOn(MultiplayerUtils, "clonePlayerObject").mockResolvedValue(player);
        global.app = {
            game: {
                useAvatar: vi.fn(() => false),
            },
        } as any;
        const wrapper = Object.create(PhysicsWrapper.prototype) as PhysicsWrapper;
        (wrapper as any).scene = scene;
        (wrapper as any).physics = {addPlayerObject};
        (wrapper as any).mpClient = {
            getSlot: vi.fn(() => 2),
            setPlayer,
            userId: "local-user",
        };

        await expect(wrapper.addPlayerObject("prefab-uuid", true)).rejects.toThrow("Failed to add character controller");

        expect(setPlayer).not.toHaveBeenCalled();
    });
});
