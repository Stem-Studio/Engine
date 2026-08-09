import {describe, expect, it, vi} from "vitest";
import * as THREE from "three";

import {getAvatarBudgetMetadata, markRemotePlayerAvatar} from "./AvatarBudgetPolicy";
import {markObjectForPlotBudget} from "./PlotBudgetPolicy";
import {
    collectTextureResidencyStats,
    getTextureResidencyMetadata,
    getTextureResidencyOptionsFromQuality,
    TextureResidencyManager,
} from "./TextureResidencyPolicy";
import type {IQualitySettings} from "../quality/interfaces/IQualityManager";
import {traverseObjectDepthFirstWithConsumers} from "../../utils/SceneTraverser";

function createTexture(name: string, size = 256): THREE.Texture {
    const texture = new THREE.Texture({width: size, height: size});
    texture.name = name;
    return texture;
}

function createTexturedRoot(name: string): {
    root: THREE.Group;
    material: THREE.MeshStandardMaterial;
    baseMap: THREE.Texture;
    normalMap: THREE.Texture;
    roughnessMap: THREE.Texture;
} {
    const baseMap = createTexture(`${name}-base`);
    const normalMap = createTexture(`${name}-normal`);
    const roughnessMap = createTexture(`${name}-roughness`);
    const material = new THREE.MeshStandardMaterial({
        map: baseMap,
        normalMap,
        roughnessMap,
    });
    const root = new THREE.Group();
    root.name = name;
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
    return {root, material, baseMap, normalMap, roughnessMap};
}

function createDeepTexturedRoot(depth: number): {
    root: THREE.Group;
    texture: THREE.Texture;
} {
    const root = new THREE.Group();
    let cursor: THREE.Object3D = root;
    for (let i = 0; i < depth; i++) {
        const child = new THREE.Object3D();
        cursor.add(child);
        cursor = child;
    }
    const texture = createTexture("deep-progressive-texture");
    cursor.add(new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({map: texture}),
    ));
    return {root, texture};
}

describe("TextureResidencyPolicy", () => {
    it("short-circuits nested residency candidates and refreshes ownership after a node walk", () => {
        const root = createTexturedRoot("root");
        const nested = createTexturedRoot("nested");
        root.root.add(nested.root);
        markObjectForPlotBudget(root.root, {state: "far"});
        markObjectForPlotBudget(nested.root, {state: "far"});
        const manager = new TextureResidencyManager(undefined, {
            isMobile: true,
            ownershipRefreshInterval: 1,
        });

        traverseObjectDepthFirstWithConsumers(root.root, [node => manager.registerObjectNode(node)]);

        expect(manager.getRegisteredCount()).toBe(1);
        manager.update();
        expect(manager.getStats().textureCount).toBe(6);

        manager.unregisterObjectTree(root.root);
        expect(manager.getRegisteredCount()).toBe(0);
    });

    it("reduces ghost avatar optional maps and restores them when full", () => {
        const scene = new THREE.Scene();
        const avatar = createTexturedRoot("avatar");
        scene.add(avatar.root);
        markRemotePlayerAvatar(avatar.root);
        getAvatarBudgetMetadata(avatar.root)!.lastState = "ghost";
        const disposeNormal = vi.spyOn(avatar.normalMap, "dispose");
        const disposeRoughness = vi.spyOn(avatar.roughnessMap, "dispose");

        const manager = new TextureResidencyManager(scene, {
            isMobile: true,
            batchSize: 1,
            ownershipRefreshInterval: 1,
            disposeReducedTextures: true,
        });

        manager.update();
        expect(avatar.material.map).toBe(avatar.baseMap);
        expect(avatar.material.normalMap).toBeNull();
        expect(avatar.material.roughnessMap).toBeNull();
        expect(disposeNormal).toHaveBeenCalledTimes(1);
        expect(disposeRoughness).toHaveBeenCalledTimes(1);
        expect(avatar.root.userData.textureResidencyState).toBe("reduced");

        getAvatarBudgetMetadata(avatar.root)!.lastState = "full";
        manager.update();
        expect(avatar.material.map).toBe(avatar.baseMap);
        expect(avatar.material.normalMap).toBe(avatar.normalMap);
        expect(avatar.material.roughnessMap).toBe(avatar.roughnessMap);
        expect(avatar.root.userData.textureResidencyState).toBe("resident");
    });

    it("evicts culled avatar maps and restores stored references", () => {
        const scene = new THREE.Scene();
        const avatar = createTexturedRoot("culled-avatar");
        scene.add(avatar.root);
        markRemotePlayerAvatar(avatar.root);
        getAvatarBudgetMetadata(avatar.root)!.lastState = "culled";
        const disposeBase = vi.spyOn(avatar.baseMap, "dispose");
        const disposeNormal = vi.spyOn(avatar.normalMap, "dispose");

        const manager = new TextureResidencyManager(scene, {
            isMobile: true,
            batchSize: 1,
            ownershipRefreshInterval: 1,
        });

        manager.update();
        expect(avatar.material.map).toBeNull();
        expect(avatar.material.normalMap).toBeNull();
        expect(avatar.material.roughnessMap).toBeNull();
        expect(disposeBase).toHaveBeenCalledTimes(1);
        expect(disposeNormal).toHaveBeenCalledTimes(1);
        expect(avatar.root.userData.textureResidencyState).toBe("evicted");

        getAvatarBudgetMetadata(avatar.root)!.lastState = "full";
        manager.update();
        expect(avatar.material.map).toBe(avatar.baseMap);
        expect(avatar.material.normalMap).toBe(avatar.normalMap);
        expect(avatar.material.roughnessMap).toBe(avatar.roughnessMap);
    });

    it("evicts ghost avatars under critical runtime texture pressure", () => {
        const scene = new THREE.Scene();
        const avatar = createTexturedRoot("pressure-avatar");
        scene.add(avatar.root);
        markRemotePlayerAvatar(avatar.root);
        getAvatarBudgetMetadata(avatar.root)!.lastState = "ghost";

        const manager = new TextureResidencyManager(scene, {
            isMobile: true,
            batchSize: 1,
            ownershipRefreshInterval: 1,
            maxResidentTextureBytes: 1,
            runtimePressure: "critical",
            evictGhostAvatarsUnderPressure: true,
        });

        manager.update();

        expect(avatar.material.map).toBeNull();
        expect(avatar.material.normalMap).toBeNull();
        expect(avatar.root.userData.textureResidencyState).toBe("evicted");
        expect(getTextureResidencyMetadata(avatar.root)?.lastDecision?.reason).toBe("avatar-ghost-critical-texture-pressure");
    });

    it("tracks resident texture bytes separately from total managed texture bytes", () => {
        const scene = new THREE.Scene();
        const plot = createTexturedRoot("resident-stats");
        scene.add(plot.root);
        markObjectForPlotBudget(plot.root, {state: "far"});

        const manager = new TextureResidencyManager(scene, {
            isMobile: true,
            batchSize: 1,
            ownershipRefreshInterval: 1,
            disposeReducedTextures: false,
        });
        const before = manager.getStats();

        manager.update();
        manager.update();
        const after = manager.getStats();

        expect(before.residentTextureBytes).toBe(before.textureBytes);
        expect(after.textureBytes).toBe(before.textureBytes);
        expect(after.residentTextureBytes).toBeLessThan(after.textureBytes);
    });

    it("collects texture residency stats without using recursive Object3D traversal", () => {
        const plot = createTexturedRoot("single-pass-stats");
        const sharedTexture = createTexture("single-pass-extra");
        const multiMaterial = [
            new THREE.MeshStandardMaterial({map: sharedTexture}),
            new THREE.MeshStandardMaterial({normalMap: sharedTexture}),
        ];
        plot.root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), multiMaterial));
        const traverse = vi.spyOn(plot.root, "traverse");

        const stats = collectTextureResidencyStats(plot.root);

        expect(traverse).not.toHaveBeenCalled();
        expect(stats.textureCount).toBe(4);
        expect(stats.residentTextureCount).toBe(4);
        expect(stats.materialCount).toBe(3);
    });

    it("collects texture stats through deeply nested hierarchies without recursive stack growth", () => {
        const root = new THREE.Group();
        let cursor: THREE.Object3D = root;
        for (let i = 0; i < 12000; i++) {
            const child = new THREE.Object3D();
            cursor.add(child);
            cursor = child;
        }
        const texture = createTexture("deep-texture");
        cursor.add(new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshStandardMaterial({map: texture}),
        ));

        expect(() => collectTextureResidencyStats(root)).not.toThrow();
        expect(collectTextureResidencyStats(root).textureCount).toBe(1);
    });

    it("protects materials shared across managed roots", () => {
        const scene = new THREE.Scene();
        const first = createTexturedRoot("shared-a");
        const second = createTexturedRoot("shared-b");
        second.material = first.material;
        (second.root.children[0] as THREE.Mesh).material = first.material;
        scene.add(first.root, second.root);
        markObjectForPlotBudget(first.root, {state: "far"});
        markObjectForPlotBudget(second.root, {state: "far"});
        const disposeNormal = vi.spyOn(first.normalMap, "dispose");

        const manager = new TextureResidencyManager(scene, {
            isMobile: true,
            batchSize: 2,
            ownershipRefreshInterval: 1,
        });

        manager.update();
        expect(first.material.map).toBe(first.baseMap);
        expect(first.material.normalMap).toBe(first.normalMap);
        expect(disposeNormal).not.toHaveBeenCalled();
    });

    it("updates texture roots in batches", () => {
        const scene = new THREE.Scene();
        const first = createTexturedRoot("first");
        const second = createTexturedRoot("second");
        scene.add(first.root, second.root);
        markObjectForPlotBudget(first.root, {state: "far"});
        markObjectForPlotBudget(second.root, {state: "far"});

        const manager = new TextureResidencyManager(scene, {
            isMobile: true,
            batchSize: 1,
            ownershipRefreshInterval: 1,
            disposeReducedTextures: false,
        });

        manager.update();
        expect(first.material.normalMap).toBeNull();
        expect(second.material.normalMap).toBe(second.normalMap);

        manager.update();
        expect(second.material.normalMap).toBeNull();
    });

    it("keeps immediate stats for public object-tree registration", () => {
        const plot = createTexturedRoot("public-register");
        markObjectForPlotBudget(plot.root, {state: "far"});
        const manager = new TextureResidencyManager(undefined, {isMobile: true});

        manager.registerObjectTree(plot.root);

        expect(manager.getRegisteredCount()).toBe(1);
        expect(getTextureResidencyMetadata(plot.root)?.stats?.textureCount).toBe(3);
    });

    it("progressively rebuilds large scenes and refreshes ownership stats", async () => {
        const scene = new THREE.Scene();
        for (let i = 0; i < 30; i++) {
            const plot = createTexturedRoot(`progressive-${i}`);
            scene.add(plot.root);
            markObjectForPlotBudget(plot.root, {state: "far"});
        }
        const yieldToFrame = vi.fn(async () => {});
        const manager = new TextureResidencyManager(undefined, {
            isMobile: true,
            disposeReducedTextures: false,
        });

        await manager.rebuildProgressive(scene, {
            batchSize: 5,
            frameBudgetMs: 1_000_000,
            yieldToFrame,
        });

        const stats = manager.getStats();
        expect(manager.getRegisteredCount()).toBe(30);
        expect(stats.textureCount).toBe(90);
        expect(stats.residentTextureCount).toBe(90);
        expect(stats.materialCount).toBe(30);
        expect(yieldToFrame).toHaveBeenCalled();
    });

    it("yields while progressively registering one deep texture root", async () => {
        const scene = new THREE.Scene();
        const {root} = createDeepTexturedRoot(70);
        scene.add(root);
        markObjectForPlotBudget(root, {
            state: "far",
            stats: {
                triangles: 0,
                drawCalls: 0,
                bounds: new THREE.Vector3(),
                textureBytes: 0,
                textureCount: 0,
            },
        });
        const yieldToFrame = vi.fn(async () => {});
        const manager = new TextureResidencyManager(undefined, {
            isMobile: true,
            disposeReducedTextures: false,
        });

        await manager.rebuildProgressive(scene, {
            batchSize: 10,
            frameBudgetMs: 1_000_000,
            yieldToFrame,
        });

        expect(manager.getRegisteredCount()).toBe(1);
        expect(getTextureResidencyMetadata(root)?.stats?.textureCount).toBe(1);
        expect(manager.getStats().textureCount).toBe(1);
        expect(yieldToFrame).toHaveBeenCalled();
        expect(yieldToFrame.mock.calls.length).toBeLessThan(12);
    });

    it("skips material traversal when texture residency state is unchanged", () => {
        const scene = new THREE.Scene();
        const plot = createTexturedRoot("stable-far");
        scene.add(plot.root);
        markObjectForPlotBudget(plot.root, {state: "far"});

        const manager = new TextureResidencyManager(scene, {
            isMobile: true,
            batchSize: 1,
            discoveryBatchSize: 0,
            ownershipRefreshInterval: 1000,
            disposeReducedTextures: false,
        });

        manager.update();
        expect(plot.material.normalMap).toBeNull();

        const traverse = vi.spyOn(plot.root, "traverse");
        manager.update();

        expect(traverse).not.toHaveBeenCalled();
        expect(plot.material.normalMap).toBeNull();
        expect(getTextureResidencyMetadata(plot.root)?.state).toBe("reduced");
    });

    it("unregisters swapped texture roots and restores reduced textures", () => {
        const scene = new THREE.Scene();
        const first = createTexturedRoot("first");
        const second = createTexturedRoot("second");
        const third = createTexturedRoot("third");
        scene.add(first.root, second.root, third.root);
        markObjectForPlotBudget(first.root, {state: "far"});
        markObjectForPlotBudget(second.root, {state: "far"});
        markObjectForPlotBudget(third.root, {state: "far"});

        const manager = new TextureResidencyManager(scene, {
            isMobile: true,
            batchSize: 3,
            ownershipRefreshInterval: 1,
            disposeReducedTextures: false,
        });

        manager.update();
        expect(manager.getRegisteredCount()).toBe(3);
        expect(first.material.normalMap).toBeNull();
        expect(second.material.normalMap).toBeNull();
        expect(third.material.normalMap).toBeNull();

        manager.unregisterObjectTree(second.root);
        expect(manager.getRegisteredCount()).toBe(2);
        expect(second.material.normalMap).toBe(second.normalMap);
        expect(second.material.roughnessMap).toBe(second.roughnessMap);

        manager.unregisterObjectTree(third.root);
        expect(manager.getRegisteredCount()).toBe(1);
        expect(third.material.normalMap).toBe(third.normalMap);
        expect(third.material.roughnessMap).toBe(third.roughnessMap);
    });

    it("skips explicitly disabled texture residency subtrees during registration", () => {
        const scene = new THREE.Scene();
        const disabledRoot = new THREE.Group();
        disabledRoot.userData.textureResidency = {enabled: false};
        const plot = createTexturedRoot("disabled-child");
        disabledRoot.add(plot.root);
        scene.add(disabledRoot);
        markObjectForPlotBudget(plot.root, {state: "far"});

        const manager = new TextureResidencyManager(scene, {
            isMobile: true,
            batchSize: 1,
            discoveryBatchSize: 1,
        });

        expect(manager.getRegisteredCount()).toBe(0);
        manager.update();
        expect(manager.getRegisteredCount()).toBe(0);
        expect(plot.material.normalMap).toBe(plot.normalMap);
    });

    it("derives tighter mobile residency options from low quality settings", () => {
        const lowQuality = getTextureResidencyOptionsFromQuality(
            {
                rendering: {
                    textureQuality: "low",
                    lodBias: 2,
                },
                scene: {
                    cullingAggressiveness: 1,
                },
            } as IQualitySettings,
            {isMobile: true},
        );
        const highQuality = getTextureResidencyOptionsFromQuality(
            {
                rendering: {
                    textureQuality: "high",
                    lodBias: 0,
                },
                scene: {
                    cullingAggressiveness: 0,
                },
            } as IQualitySettings,
            {isMobile: true},
        );

        expect(lowQuality.maxResidentTextureBytes).toBeLessThan(highQuality.maxResidentTextureBytes!);
        expect(lowQuality.disposeReducedTextures).toBe(true);
        expect(lowQuality.batchSize).toBeLessThanOrEqual(highQuality.batchSize!);
    });
});
