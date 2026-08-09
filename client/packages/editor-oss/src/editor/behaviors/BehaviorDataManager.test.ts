import {Object3D, Scene} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import BehaviorAttributeConverter from "./BehaviorAttributeConverter";
import BehaviorAttributeType from "./BehaviorAttributeType";
import BehaviorConfigRegistry from "./BehaviorConfigRegistry";
import BehaviorDataManager from "./BehaviorDataManager";
import {BehaviorThrottlePriority} from "../../behaviors/performance/interfaces/IThrottleStrategy";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("BehaviorDataManager", () => {
    it("clones behavior data without JSON.stringify and renews the uuid", () => {
        const stringifySpy = vi.spyOn(JSON, "stringify");
        const target = new Object3D();
        const manager = new BehaviorDataManager(new BehaviorConfigRegistry(), new BehaviorAttributeConverter());
        const source = {
            id: "test.behavior",
            uuid: "source-uuid",
            enabled: true,
            priority: 3,
            attributesData: {
                nested: {speed: 4},
                values: [1, undefined, Number.NaN],
                ignored: undefined,
            },
            throttleConfig: {
                throttlePriority: BehaviorThrottlePriority.HIGH,
                enableFrustumCulling: true,
                enableDistanceThrottling: false,
                requiresConsistentUpdates: true,
                ignored: undefined,
            },
            target,
        };

        const clone = manager.cloneBehaviorData(source as any);

        expect(stringifySpy).not.toHaveBeenCalled();
        expect(clone.uuid).not.toBe(source.uuid);
        expect(clone.id).toBe(source.id);
        expect(clone.enabled).toBe(true);
        expect(clone.priority).toBe(3);
        expect(clone.target).toBe(target);
        expect(clone.attributesData).toEqual({
            nested: {speed: 4},
            values: [1, null, null],
        });
        expect(clone.attributesData).not.toBe(source.attributesData);
        expect(clone.attributesData?.nested).not.toBe(source.attributesData.nested);
        expect(clone.throttleConfig).toEqual({
            throttlePriority: BehaviorThrottlePriority.HIGH,
            enableFrustumCulling: true,
            enableDistanceThrottling: false,
            requiresConsistentUpdates: true,
        });
        expect(clone.throttleConfig).not.toBe(source.throttleConfig);
    });

    it("updates exclusive attributes with iterative scene scans", () => {
        const scene = new Scene();
        const first = new Object3D();
        first.name = "First";
        const second = new Object3D();
        second.name = "Second";
        first.userData.behaviors = [
            {
                id: "exclusive.behavior",
                uuid: "first-behavior",
                enabled: true,
                attributesData: {isDefault: true},
            },
        ];
        second.userData.behaviors = [
            {
                id: "exclusive.behavior",
                uuid: "second-behavior",
                enabled: true,
                attributesData: {isDefault: true},
            },
        ];
        scene.add(first, second);

        const registry = new BehaviorConfigRegistry();
        registry.registerConfig("exclusive.behavior", {
            id: "exclusive.behavior",
            name: "Exclusive Behavior",
            author: "test",
            isScript: false,
            main: "",
            version: "1.0.0",
            attributes: {
                isDefault: {
                    type: BehaviorAttributeType.Boolean,
                    name: "Default",
                    isExclusive: true,
                },
            },
        } as any, true);
        const manager = new BehaviorDataManager(registry, new BehaviorAttributeConverter());
        const traverseSpy = vi.spyOn(Object3D.prototype, "traverse").mockImplementation(() => {
            throw new Error("recursive traverse should not be used for behavior data scans");
        });

        manager.handleExclusiveAttributeUpdate(scene, "second-behavior", "isDefault", true);

        expect(first.userData.behaviors[0].attributesData.isDefault).toBe(false);
        expect(second.userData.behaviors[0].attributesData.isDefault).toBe(true);
        expect(traverseSpy).not.toHaveBeenCalled();
    });
});
