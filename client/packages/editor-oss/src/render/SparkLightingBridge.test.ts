import {describe, expect, it, vi} from "vitest";
import {Object3D, PointLight, Scene} from "three";

import {SparkSceneLightingBridge} from "./SparkLightingBridge";

type TestableSparkSceneLightingBridge = {
    scanLights: () => void;
    discoveredLights: PointLight[];
    hasVisibleSplat: boolean;
};

function addDeepVisibleChain(root: Object3D, depth: number): Object3D {
    let current = root;
    for (let i = 0; i < depth; i++) {
        const child = new Object3D();
        child.name = `spark-scan-depth-${i}`;
        current.add(child);
        current = child;
    }
    return current;
}

describe("SparkSceneLightingBridge", () => {
    it("reuses an existing deep runtime lighting root without recursive name lookup", () => {
        const scene = new Scene();
        const leaf = addDeepVisibleChain(scene, 12000);
        const existingRoot = new Object3D();
        existingRoot.name = "__SparkDynamicLighting";
        leaf.add(existingRoot);
        const getObjectByName = vi.spyOn(scene, "getObjectByName").mockImplementation(() => {
            throw new Error("recursive name lookup should not be used");
        });

        const bridge = new SparkSceneLightingBridge(scene) as unknown as TestableSparkSceneLightingBridge & {
            root: Object3D;
        };

        expect(bridge.root).toBe(existingRoot);
        expect(existingRoot.parent).toBe(scene);
        expect(getObjectByName).not.toHaveBeenCalled();
    });

    it("scans deep visible scene hierarchies without Object3D.traverseVisible recursion", () => {
        const scene = new Scene();
        const bridge = new SparkSceneLightingBridge(scene) as unknown as TestableSparkSceneLightingBridge;
        const leaf = addDeepVisibleChain(scene, 12000);
        const light = new PointLight(0xffffff, 1);
        const splat = new Object3D();
        splat.userData.__isGaussianSplat = true;
        leaf.add(light, splat);
        const traverseVisible = vi.spyOn(scene, "traverseVisible");

        expect(() => bridge.scanLights()).not.toThrow();

        expect(bridge.discoveredLights).toEqual([light]);
        expect(bridge.hasVisibleSplat).toBe(true);
        expect(traverseVisible).not.toHaveBeenCalled();
    });

    it("prunes hidden subtrees while scanning for spark lights and splats", () => {
        const scene = new Scene();
        const bridge = new SparkSceneLightingBridge(scene) as unknown as TestableSparkSceneLightingBridge;
        const hidden = new Object3D();
        hidden.visible = false;
        const hiddenLight = new PointLight(0xffffff, 1);
        const hiddenSplat = new Object3D();
        hiddenSplat.userData.__isGaussianSplat = true;
        hidden.add(hiddenLight, hiddenSplat);
        scene.add(hidden);

        bridge.scanLights();

        expect(bridge.discoveredLights).toEqual([]);
        expect(bridge.hasVisibleSplat).toBe(false);
    });
});
