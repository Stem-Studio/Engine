import {Object3D, Scene} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import {CollisionFlag, type IPhysics} from "../common/types";
import {MultiplayerUtils} from "./MultiplayerUtils";

const hoisted = vi.hoisted(() => ({
    globalMock: {
        app: {
            editor: {isMultiplayer: true},
            game: {
                initializeObject: vi.fn(),
                behaviorManager: {
                    getBehaviorsById: vi.fn(() => []),
                },
            },
        },
    },
}));

vi.mock("@stem/editor-oss/global", () => ({
    default: hoisted.globalMock,
}));

function addDeepChain(root: Object3D, depth = 12_000): Object3D {
    let cursor = root;
    for (let i = 0; i < depth; i++) {
        const child = new Object3D();
        cursor.add(child);
        cursor = child;
    }
    return cursor;
}

function createPhysicsStub(): IPhysics {
    return {
        removePrefab: vi.fn(),
        addObject: vi.fn(() => CollisionFlag.DYNAMIC),
    } as unknown as IPhysics;
}

describe("MultiplayerUtils", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        hoisted.globalMock.app.game.initializeObject.mockClear();
        hoisted.globalMock.app.game.behaviorManager.getBehaviorsById.mockClear();
    });

    it("validates synchronized child names in deep hierarchies without recursive lookup", () => {
        const root = new Object3D();
        root.userData.synchronizeChildren = ["target-child"];
        const leaf = addDeepChain(root);
        leaf.name = "target-child";
        const getObjectsByProperty = vi.spyOn(root, "getObjectsByProperty").mockImplementation(() => {
            throw new Error("recursive property lookup should not be used");
        });

        expect(MultiplayerUtils.isValidForChildrenSync(root)).toBe(true);
        expect(getObjectsByProperty).not.toHaveBeenCalled();

        const duplicate = new Object3D();
        duplicate.name = "target-child";
        root.add(duplicate);

        expect(MultiplayerUtils.isValidForChildrenSync(root)).toBe(false);
    });

    it("clones deeply nested player prefabs without recursive Three lookup or traversal", async () => {
        const scene = new Scene();
        const playerPrefab = addDeepChain(scene);
        playerPrefab.name = "PlayerPrefab";
        playerPrefab.userData.physics = {
            enabled: true,
            mass: 1,
            ctype: "dynamic",
            shape: "box",
        };
        MultiplayerUtils.setShouldSynchronizeChildren(playerPrefab, true);
        playerPrefab.userData.tags = ["player"];
        const behaviorChild = new Object3D();
        behaviorChild.userData.behaviors = [{id: "child-behavior"}];
        playerPrefab.add(behaviorChild);
        const physics = createPhysicsStub();
        const getObjectByProperty = vi.spyOn(scene, "getObjectByProperty").mockImplementation(() => {
            throw new Error("recursive scene lookup should not be used");
        });
        const traverse = vi.spyOn(Object3D.prototype, "traverse").mockImplementation(() => {
            throw new Error("recursive traversal should not be used");
        });

        const playerObject = await MultiplayerUtils.clonePlayerObject(physics, playerPrefab.uuid, scene, "remote-player");

        expect(playerObject.uuid).toBe("remote-player");
        expect(playerObject.visible).toBe(true);
        expect(physics.removePrefab).toHaveBeenCalledWith(playerPrefab.uuid);
        expect(physics.addObject).toHaveBeenCalledWith("remote-player", 1, CollisionFlag.DYNAMIC, playerObject);
        expect(hoisted.globalMock.app.game.initializeObject).toHaveBeenCalledTimes(1);
        expect(getObjectByProperty).not.toHaveBeenCalled();
        expect(traverse).not.toHaveBeenCalled();
    });
});
