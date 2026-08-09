import * as THREE from "three";
import {describe, expect, it, vi} from "vitest";

import {markLocalPlayerAvatar, markRemotePlayerAvatar, getAvatarBudgetMetadata} from "./AvatarBudgetPolicy";
import {collectBudgetInspection, logBudgetInspection} from "./BudgetInspector";
import {markObjectForPlotBudget} from "./PlotBudgetPolicy";
import {markObjectForTextureResidency} from "./TextureResidencyPolicy";

const MB = 1024 * 1024;

function createObject(name: string): THREE.Object3D {
    const object = new THREE.Object3D();
    object.name = name;
    return object;
}

function createTexturedMesh(name: string, width: number, height: number): THREE.Mesh {
    const texture = new THREE.Texture();
    texture.name = `${name}-texture`;
    texture.image = {width, height};
    const material = new THREE.MeshBasicMaterial({map: texture});
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    mesh.name = name;
    return mesh;
}

function addDeepObjectChain(root: THREE.Object3D, depth = 12_000): THREE.Object3D {
    let current = root;

    for (let i = 0; i < depth; i++) {
        const child = new THREE.Object3D();
        child.name = `node-${i}`;
        current.add(child);
        current = child;
    }

    return current;
}

describe("BudgetInspector", () => {
    it("collects avatar, plot, and texture residency summaries", () => {
        const scene = new THREE.Scene();
        scene.name = "scene";
        const local = createObject("local");
        const remote = createObject("remote");
        const plot = createObject("plot");
        scene.add(local, remote, plot);

        markLocalPlayerAvatar(local, {
            stats: {
                triangles: 10,
                drawCalls: 2,
                bones: 4,
                bounds: new THREE.Vector3(1, 1, 1),
                textureBytes: 4 * 1024 * 1024,
                textureCount: 1,
            },
        });
        getAvatarBudgetMetadata(local)!.lastState = "full";

        markRemotePlayerAvatar(remote, {
            stats: {
                triangles: 40,
                drawCalls: 5,
                bones: 20,
                bounds: new THREE.Vector3(2, 2, 2),
                textureBytes: 16 * 1024 * 1024,
                textureCount: 3,
            },
        });
        getAvatarBudgetMetadata(remote)!.lastState = "ghost";

        markObjectForPlotBudget(plot, {
            state: "far",
            stats: {
                triangles: 100,
                drawCalls: 12,
                bounds: new THREE.Vector3(8, 2, 8),
                textureBytes: 32 * 1024 * 1024,
                textureCount: 4,
            },
        });
        markObjectForTextureResidency(plot, {
            state: "reduced",
            stats: {
                textureBytes: 20 * 1024 * 1024,
                textureCount: 2,
                materialCount: 1,
                sharedMaterialCount: 0,
            },
        });

        const snapshot = collectBudgetInspection(scene, {}, {now: 1000});

        expect(snapshot.generatedAt).toBe(1000);
        expect(snapshot.avatar.total).toBe(2);
        expect(snapshot.avatar.states.full).toBe(1);
        expect(snapshot.avatar.states.ghost).toBe(1);
        expect(snapshot.avatar.local).toBe(1);
        expect(snapshot.avatar.remote).toBe(1);
        expect(snapshot.plot.total).toBe(1);
        expect(snapshot.plot.states.far).toBe(1);
        expect(snapshot.texture.total).toBe(1);
        expect(snapshot.texture.states.reduced).toBe(1);
        expect(snapshot.rows[0]!.name).toBe("plot");
        expect(snapshot.rows[0]!.textureBytes).toBe(32 * 1024 * 1024);
    });

    it("collects advisor data from deep scenes without recursive Object3D traversal", () => {
        const scene = new THREE.Scene();
        const leaf = addDeepObjectChain(scene);
        const avatar = createObject("deep-avatar");
        avatar.add(createTexturedMesh("deep-avatar-mesh", 2048, 1024));
        leaf.add(avatar);
        markRemotePlayerAvatar(avatar, {
            stats: {
                triangles: 15000,
                drawCalls: 8,
                bones: 120,
                bounds: new THREE.Vector3(2, 2, 2),
                textureBytes: 40 * MB,
                textureCount: 1,
            },
        });
        const sceneTraverseSpy = vi.spyOn(scene, "traverse");
        const avatarTraverseSpy = vi.spyOn(avatar, "traverse");

        const snapshot = collectBudgetInspection(scene, {}, {
            enableAdvisor: true,
            allowAdvisor: true,
            maxAdvisorWarnings: 20,
        });

        expect(snapshot.avatar.total).toBe(1);
        expect(snapshot.rows[0]!.name).toBe("deep-avatar");
        expect(snapshot.rows[0]!.maxTextureDimension).toBe(2048);
        expect(snapshot.advisor?.warnings.some(warning => warning.metric === "textureDimension")).toBe(true);
        expect(sceneTraverseSpy).not.toHaveBeenCalled();
        expect(avatarTraverseSpy).not.toHaveBeenCalled();
    });

    it("includes manager stats and limits top rows", () => {
        const scene = new THREE.Scene();
        const a = createObject("a");
        const b = createObject("b");
        scene.add(a, b);
        markObjectForTextureResidency(a, {
            state: "resident",
            stats: {textureBytes: 1, textureCount: 1, materialCount: 1, sharedMaterialCount: 0},
        });
        markObjectForTextureResidency(b, {
            state: "resident",
            stats: {textureBytes: 2, textureCount: 1, materialCount: 1, sharedMaterialCount: 0},
        });

        const snapshot = collectBudgetInspection(
            scene,
            {
                plotBudgetManager: {getRegisteredCount: () => 5},
                textureResidencyManager: {
                    getRegisteredCount: () => 6,
                    getStats: () => ({
                        textureBytes: 10,
                        textureCount: 2,
                        residentTextureBytes: 8,
                        residentTextureCount: 1,
                        materialCount: 2,
                        sharedMaterialCount: 0,
                    }),
                },
                runtimeBudgetCoordinator: {
                    getSnapshot: () => ({
                        enabled: true,
                        pressure: "warning",
                        managedTextureBytes: 8,
                        totalManagedTextureBytes: 10,
                        targetTextureBytes: 9,
                        usageRatio: 8 / 9,
                        reason: "managed-texture-warning",
                        updatedAt: 1000,
                        framesInPressure: 2,
                        isMobile: true,
                    }),
                },
            },
            {maxRows: 1},
        );

        expect(snapshot.managers.plotRegisteredCount).toBe(5);
        expect(snapshot.managers.textureRegisteredCount).toBe(6);
        expect(snapshot.managers.textureManagerStats?.textureBytes).toBe(10);
        expect(snapshot.runtimeBudget?.pressure).toBe("warning");
        expect(snapshot.rows).toHaveLength(1);
        expect(snapshot.rows[0]!.name).toBe("b");
    });

    it("logs a debug snapshot", () => {
        const scene = new THREE.Scene();
        const object = createObject("logged");
        scene.add(object);
        markObjectForTextureResidency(object, {
            state: "evicted",
            stats: {textureBytes: 1024 * 1024, textureCount: 1, materialCount: 1, sharedMaterialCount: 0},
        });
        const snapshot = collectBudgetInspection(scene, {}, {now: 1000});
        const logger = {
            groupCollapsed: vi.fn(),
            info: vi.fn(),
            table: vi.fn(),
            groupEnd: vi.fn(),
        };

        logBudgetInspection(snapshot, logger);

        expect(logger.groupCollapsed).toHaveBeenCalledWith("[BudgetInspector] avatars=0 plots=0 textures=1");
        expect(logger.info).toHaveBeenCalled();
        expect(logger.table).toHaveBeenCalledWith([
            expect.objectContaining({name: "logged", texture: "evicted", textureMB: 1}),
        ]);
        expect(logger.groupEnd).toHaveBeenCalled();
    });

    it("does not run advisor checks by default", () => {
        const scene = new THREE.Scene();
        const avatar = createObject("avatar");
        avatar.add(createTexturedMesh("avatar-mesh", 4096, 4096));
        scene.add(avatar);

        markRemotePlayerAvatar(avatar, {
            stats: {
                triangles: 40000,
                drawCalls: 16,
                bones: 160,
                bounds: new THREE.Vector3(2, 2, 2),
                textureBytes: 80 * MB,
                textureCount: 1,
            },
        });

        const snapshot = collectBudgetInspection(scene);

        expect(snapshot.advisor).toBeUndefined();
        expect(snapshot.rows[0]!.advisorWarnings).toBeUndefined();
        expect(snapshot.rows[0]!.maxTextureDimension).toBeUndefined();
    });

    it("blocks advisor checks when the inspector context disallows them", () => {
        const scene = new THREE.Scene();
        const avatar = createObject("published-avatar");
        avatar.add(createTexturedMesh("published-avatar-mesh", 4096, 4096));
        scene.add(avatar);

        markRemotePlayerAvatar(avatar, {
            stats: {
                triangles: 40000,
                drawCalls: 16,
                bones: 160,
                bounds: new THREE.Vector3(2, 2, 2),
                textureBytes: 80 * MB,
                textureCount: 1,
            },
        });

        const snapshot = collectBudgetInspection(scene, {}, {
            enableAdvisor: true,
            allowAdvisor: false,
            advisorBlockedReason: "Published game",
        });

        expect(snapshot.advisor).toMatchObject({
            enabled: true,
            allowed: false,
            blockedReason: "Published game",
            warningCount: 0,
            criticalCount: 0,
            warnings: [],
        });
        expect(snapshot.rows[0]!.advisorWarnings).toBeUndefined();
        expect(snapshot.rows[0]!.maxTextureDimension).toBeUndefined();
    });

    it("reports mobile budget advisor warnings for oversized avatars and plots", () => {
        const scene = new THREE.Scene();
        const avatar = createObject("heavy-avatar");
        const plot = createObject("heavy-plot");
        avatar.add(createTexturedMesh("avatar-mesh", 1536, 1536));
        plot.add(createTexturedMesh("plot-mesh", 4096, 4096));
        scene.add(avatar, plot);

        markRemotePlayerAvatar(avatar, {
            stats: {
                triangles: 20000,
                drawCalls: 8,
                bones: 120,
                bounds: new THREE.Vector3(2, 2, 2),
                textureBytes: 40 * MB,
                textureCount: 1,
            },
        });
        markObjectForPlotBudget(plot, {
            state: "near",
            stats: {
                triangles: 150000,
                drawCalls: 90,
                bounds: new THREE.Vector3(12, 4, 12),
                textureBytes: 120 * MB,
                textureCount: 1,
            },
        });

        const snapshot = collectBudgetInspection(scene, {}, {
            enableAdvisor: true,
            allowAdvisor: true,
            maxAdvisorWarnings: 20,
        });

        expect(snapshot.advisor?.allowed).toBe(true);
        expect(snapshot.advisor?.warningCount).toBeGreaterThan(0);
        expect(snapshot.advisor?.criticalCount).toBeGreaterThan(0);
        expect(snapshot.advisor?.warnings.some(warning => warning.metric === "textureDimension")).toBe(true);
        expect(snapshot.advisor?.warnings.some(warning => warning.scope === "plot" && warning.severity === "critical")).toBe(true);

        const avatarRow = snapshot.rows.find(row => row.name === "heavy-avatar");
        const plotRow = snapshot.rows.find(row => row.name === "heavy-plot");
        expect(avatarRow?.advisorSeverity).toBe("warning");
        expect(avatarRow?.maxTextureDimension).toBe(1536);
        expect(plotRow?.advisorSeverity).toBe("critical");
        expect(plotRow?.maxTextureDimension).toBe(4096);
    });

    it("logs advisor counts when advisor data is present", () => {
        const scene = new THREE.Scene();
        const avatar = createObject("logged-advisor");
        avatar.add(createTexturedMesh("logged-advisor-mesh", 1536, 1536));
        scene.add(avatar);
        markRemotePlayerAvatar(avatar, {
            stats: {
                triangles: 20000,
                drawCalls: 8,
                bones: 120,
                bounds: new THREE.Vector3(2, 2, 2),
                textureBytes: 40 * MB,
                textureCount: 1,
            },
        });
        const snapshot = collectBudgetInspection(scene, {}, {enableAdvisor: true, allowAdvisor: true});
        const logger = {
            groupCollapsed: vi.fn(),
            info: vi.fn(),
            table: vi.fn(),
            groupEnd: vi.fn(),
        };

        logBudgetInspection(snapshot, logger);

        expect(logger.groupCollapsed).toHaveBeenCalledWith(expect.stringContaining("advisor=0c/5w"));
        expect(logger.info).toHaveBeenCalledWith(
            "Summary",
            expect.objectContaining({
                advisor: expect.objectContaining({allowed: true, warningCount: 5, criticalCount: 0}),
            }),
        );
        expect(logger.table).toHaveBeenCalledWith([
            expect.objectContaining({name: "logged-advisor", advisor: "warning:5"}),
        ]);
    });
});
