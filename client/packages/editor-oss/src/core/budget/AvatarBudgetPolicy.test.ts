import {describe, expect, it, vi} from "vitest";
import * as THREE from "three";

import {
    AvatarBudgetPolicy,
    collectAvatarBudgetStats,
    getAvatarBudgetMetadata,
    getAvatarBudgetOptionsFromQuality,
    markLocalPlayerAvatar,
    markObjectForAvatarBudget,
    markRemotePlayerAvatar,
} from "./AvatarBudgetPolicy";
import type {AvatarBudgetStats} from "./AvatarBudgetPolicy";
import type {IQualitySettings} from "../quality/interfaces/IQualityManager";

function createCamera(): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    return camera;
}

function createAvatarObject(z: number): THREE.Object3D {
    const object = new THREE.Object3D();
    object.position.set(0, 0, z);
    object.updateMatrixWorld(true);
    markObjectForAvatarBudget(object, {enabled: true});
    return object;
}

function createDeepAvatarObject(depth: number): THREE.Object3D {
    const root = new THREE.Group();
    let current = root;

    for (let i = 0; i < depth; i++) {
        const child = new THREE.Group();
        child.name = `avatar-depth-${i}`;
        current.add(child);
        current = child;
    }

    current.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
    return root;
}

describe("AvatarBudgetPolicy", () => {
    it("keeps local avatars in full update mode regardless of distance", () => {
        const camera = createCamera();
        const object = createAvatarObject(-200);
        markObjectForAvatarBudget(object, {enabled: true, isLocal: true});

        const policy = new AvatarBudgetPolicy({isMobile: true, fullDistance: 10, cullDistance: 30});
        const decision = policy.decide(object, camera);

        expect(decision.state).toBe("full");
        expect(decision.shouldUpdateAnimation).toBe(true);
        expect(decision.animationIntervalSec).toBe(0);
        expect(decision.reason).toBe("local-avatar");
    });

    it("moves remote mobile avatars from full to ghost to culled by distance", () => {
        const camera = createCamera();
        const object = createAvatarObject(-5);
        const policy = new AvatarBudgetPolicy({
            isMobile: true,
            fullDistance: 10,
            cullDistance: 30,
            offscreenGhostDistance: 10,
            offscreenCullDistance: 20,
        });

        expect(policy.decide(object, camera).state).toBe("full");

        object.position.set(0, 0, -15);
        object.updateMatrixWorld(true);
        const ghostDecision = policy.decide(object, camera);
        expect(ghostDecision.state).toBe("ghost");
        expect(policy.shouldRunAnimationUpdate(object, ghostDecision, 1)).toBe(false);

        object.position.set(0, 0, -35);
        object.updateMatrixWorld(true);
        const cullDecision = policy.decide(object, camera);
        expect(cullDecision.state).toBe("culled");

        policy.applyVisibilityState(object, cullDecision);
        expect(object.visible).toBe(false);

        object.position.set(0, 0, -5);
        object.updateMatrixWorld(true);
        const fullDecision = policy.decide(object, camera);
        policy.applyVisibilityState(object, fullDecision);
        expect(fullDecision.state).toBe("full");
        expect(object.visible).toBe(true);
    });

    it("prepares camera state once for multiple avatar decisions in a frame", () => {
        const camera = createCamera();
        const updateMatrixWorld = vi.spyOn(camera, "updateMatrixWorld");
        const first = createAvatarObject(-5);
        const second = createAvatarObject(-8);
        const policy = new AvatarBudgetPolicy({isMobile: true});

        policy.beginFrame(camera);
        policy.decide(first, camera);
        policy.decide(second, camera);
        policy.endFrame();

        expect(updateMatrixWorld).toHaveBeenCalledTimes(1);
    });

    it("reads avatar world position once per distance and visibility decision", () => {
        const camera = createCamera();
        const object = createAvatarObject(-8);
        const getWorldPosition = vi.spyOn(object, "getWorldPosition");
        const policy = new AvatarBudgetPolicy({isMobile: true});

        policy.decide(object, camera);

        expect(getWorldPosition).toHaveBeenCalledTimes(1);
    });

    it("tightens full distance for heavy avatars", () => {
        const camera = createCamera();
        const object = createAvatarObject(-18);
        const heavyStats: AvatarBudgetStats = {
            triangles: 50000,
            drawCalls: 20,
            bones: 180,
            bounds: new THREE.Vector3(1, 2, 1),
            textureBytes: 128 * 1024 * 1024,
            textureCount: 8,
        };
        markObjectForAvatarBudget(object, {enabled: true, stats: heavyStats});

        const policy = new AvatarBudgetPolicy({
            isMobile: true,
            fullDistance: 20,
            cullDistance: 50,
            heavyTriangleLimit: 10000,
        });

        expect(policy.decide(object, camera).state).toBe("ghost");
    });

    it("collects deduped avatar geometry, draw, bone, bounds, and texture stats", () => {
        const root = new THREE.Group();
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const texture = new THREE.Texture({width: 64, height: 32});
        const material = new THREE.MeshBasicMaterial({map: texture});
        const meshA = new THREE.Mesh(geometry, material);
        const meshB = new THREE.Mesh(geometry, material);
        meshB.position.x = 2;
        root.add(meshA, meshB);
        root.updateMatrixWorld(true);

        const stats = collectAvatarBudgetStats(root);

        expect(stats.triangles).toBe(12);
        expect(stats.drawCalls).toBe(2);
        expect(stats.textureCount).toBe(1);
        expect(stats.textureBytes).toBe(Math.ceil(64 * 32 * 4 * 4 / 3));
        expect(stats.bounds.x).toBeGreaterThan(2);
    });

    it("collects deep avatar stats without Object3D.traverse recursion", () => {
        const root = createDeepAvatarObject(12000);
        const traverse = vi.spyOn(root, "traverse");

        const stats = collectAvatarBudgetStats(root);

        expect(stats.triangles).toBeGreaterThan(0);
        expect(stats.bounds.x).toBeGreaterThan(0);
        expect(traverse).not.toHaveBeenCalled();
    });

    it("collects multi-material avatar draw calls without duplicating textures", () => {
        const root = new THREE.Group();
        const sharedTexture = new THREE.Texture({width: 32, height: 32});
        const materials = [
            new THREE.MeshBasicMaterial({map: sharedTexture}),
            new THREE.MeshBasicMaterial({map: sharedTexture}),
        ];
        root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), materials));
        root.updateMatrixWorld(true);

        const stats = collectAvatarBudgetStats(root);

        expect(stats.drawCalls).toBe(2);
        expect(stats.textureCount).toBe(1);
    });

    it("marks explicit local and remote player avatar ownership", () => {
        const local = new THREE.Object3D();
        const remote = new THREE.Object3D();

        markLocalPlayerAvatar(local, {
            playerId: "local-player",
            sourceObjectUuid: "local-template",
            usesProfileAvatar: true,
            avatarSource: "profile-avatar",
        });
        markRemotePlayerAvatar(remote, {
            playerId: "remote-player",
            sessionId: "remote-session",
            playerName: "Remote",
            sourceObjectUuid: "remote-template",
            avatarSource: "multiplayer-template",
        });

        expect(getAvatarBudgetMetadata(local)).toMatchObject({
            enabled: true,
            isLocal: true,
            role: "local",
            playerId: "local-player",
            usesProfileAvatar: true,
            avatarSource: "profile-avatar",
        });
        expect(getAvatarBudgetMetadata(remote)).toMatchObject({
            enabled: true,
            isLocal: false,
            role: "remote",
            playerId: "remote-player",
            sessionId: "remote-session",
            sourceObjectUuid: "remote-template",
        });
    });

    it("derives tighter mobile avatar budgets from low quality settings", () => {
        const lowQuality = getAvatarBudgetOptionsFromQuality(
            {
                rendering: {
                    textureQuality: "low",
                    lodBias: 2,
                    pixelRatio: 0.6,
                    postProcessing: false,
                    maxLights: 2,
                },
                behavior: {
                    updateRate: 20,
                },
            } as IQualitySettings,
            {isMobile: true},
        );
        const highQuality = getAvatarBudgetOptionsFromQuality(
            {
                rendering: {
                    textureQuality: "high",
                    lodBias: 0,
                    pixelRatio: 1,
                    postProcessing: true,
                    maxLights: 8,
                },
                behavior: {
                    updateRate: 60,
                },
            } as IQualitySettings,
            {isMobile: true},
        );

        expect(lowQuality.fullDistance).toBeLessThan(highQuality.fullDistance!);
        expect(lowQuality.cullDistance).toBeLessThan(highQuality.cullDistance!);
        expect(lowQuality.nearAnimationHz).toBe(20);
        expect(lowQuality.edgeAnimationHz).toBeLessThanOrEqual(8);
        expect(lowQuality.heavyTextureBytesLimit).toBeLessThan(highQuality.heavyTextureBytesLimit!);
    });

    it("tightens remote avatar distance under runtime budget pressure", () => {
        const camera = createCamera();
        const object = createAvatarObject(-18);
        const policy = new AvatarBudgetPolicy({
            isMobile: true,
            fullDistance: 20,
            cullDistance: 50,
            offscreenGhostDistance: 30,
            offscreenCullDistance: 45,
            runtimeDistanceScale: 0.6,
        });

        expect(policy.decide(object, camera).state).toBe("ghost");
    });
});
