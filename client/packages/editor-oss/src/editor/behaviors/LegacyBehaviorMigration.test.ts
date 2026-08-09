import {Object3D, Scene} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

const hoisted = vi.hoisted(() => ({
    createSceneAssetWithData: vi.fn(),
    legacyGetBehaviorsListForScene: vi.fn(),
    setAssetRevision: vi.fn(),
}));

vi.mock("@stem/network/api/scene/v2", () => ({
    createSceneAssetWithData: hoisted.createSceneAssetWithData,
}));

vi.mock("@stem/network/api/behavior", () => ({
    legacyGetBehaviorsListForScene: hoisted.legacyGetBehaviorsListForScene,
}));

vi.mock("@stem/editor-oss/asset-management/AssetResolutionContext", () => ({
    setAssetRevision: hoisted.setAssetRevision,
}));

import {migrateLegacyBehaviors} from "./LegacyBehaviorMigration";

afterEach(() => {
    hoisted.createSceneAssetWithData.mockReset();
    hoisted.legacyGetBehaviorsListForScene.mockReset();
    hoisted.setAssetRevision.mockReset();
    vi.restoreAllMocks();
});

describe("LegacyBehaviorMigration", () => {
    it("updates behavior ids in deep scenes without recursive scene traversal", async () => {
        const scene = new Scene();
        scene.userData.behaviorConfigs = [{id: "legacy.flight", name: "Legacy Flight"}];
        scene.userData.scripts = {"legacy.flight": "function update() {}"};

        let cursor: Object3D = scene;
        for (let i = 0; i < 12_000; i++) {
            const child = new Object3D();
            cursor.add(child);
            cursor = child;
        }

        const behavior = {
            id: "legacy.flight",
            uuid: "behavior-instance",
            enabled: true,
            priority: 0,
        };
        cursor.userData.behaviors = [behavior];

        hoisted.legacyGetBehaviorsListForScene.mockResolvedValue([]);
        hoisted.createSceneAssetWithData.mockResolvedValue({
            id: "507f1f77bcf86cd799439011",
            headRevisionId: "rev-1",
        });
        const traverseSpy = vi.spyOn(scene, "traverse");
        vi.spyOn(console, "info").mockImplementation(() => undefined);
        vi.spyOn(console, "debug").mockImplementation(() => undefined);

        const result = await migrateLegacyBehaviors({scene, sceneId: "scene-1"});

        expect(traverseSpy).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            migratedCount: 1,
            updatedObjectsCount: 1,
            idMapping: {"legacy.flight": "507f1f77bcf86cd799439011"},
        });
        expect(behavior.id).toBe("507f1f77bcf86cd799439011");
        expect(hoisted.setAssetRevision).toHaveBeenCalledWith(scene, "507f1f77bcf86cd799439011", "rev-1");
        expect(scene.userData.behaviorsMigrated.migratedBehaviors).toEqual(["legacy.flight"]);
    });
});
