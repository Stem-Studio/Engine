import {Object3D, Scene} from "three";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {CollaborationClient} from "./CollaborationClient";
import type {LambdaConfig} from "@stem/editor-oss/lambdas/Lambda";

const hoisted = vi.hoisted(() => ({
    globalMock: {app: null as any},
    saveSceneMock: vi.fn(),
    refreshAssetMock: vi.fn().mockResolvedValue(undefined),
    refreshEditorAssetsMock: vi.fn().mockResolvedValue(undefined),
    refreshDependentScriptsForScriptMock: vi.fn().mockResolvedValue(undefined),
    isPrefabMock: vi.fn(() => false),
    isPrefabUnlockedMock: vi.fn(() => false),
}));

vi.mock("../../global", () => ({
    default: hoisted.globalMock,
}));

vi.mock("@stem/network/api/scene", () => ({
    saveScene: hoisted.saveSceneMock,
}));

vi.mock("../../editor/asset-management/hooks/assets", () => ({
    refreshAsset: hoisted.refreshAssetMock,
    refreshEditorAssets: hoisted.refreshEditorAssetsMock,
}));

vi.mock("../../editor/scripts/util", () => ({
    refreshDependentScriptsForScript: hoisted.refreshDependentScriptsForScriptMock,
}));

vi.mock("../../prefab/util", () => ({
    isPrefab: hoisted.isPrefabMock,
    isPrefabUnlocked: hoisted.isPrefabUnlockedMock,
}));

vi.mock("../../queryClient", () => ({
    queryClient: {},
}));

vi.mock("../../serialization/Converter", () => ({
    NoDeserializeSerializers: [],
}));

vi.mock("../../object/terrain/PerlinTerrain", () => ({
    default: class PerlinTerrain {},
}));

vi.mock("../../utils/ModelUtils", () => ({
    ModelUtils: class {},
    optimizeGlbFile: vi.fn(),
    getModelStats: vi.fn(),
}));

vi.mock("three/addons/math/ImprovedNoise", () => ({
    ImprovedNoise: class {
        noise() {
            return 0;
        }
    },
}));

vi.mock("three/addons/renderers/CSS3DRenderer", () => ({
    CSS3DObject: class {},
    CSS3DSprite: class {},
    CSS3DRenderer: class {},
}));

vi.mock("three/addons/renderers/CSS3DRenderer.js", () => ({
    CSS3DObject: class {},
    CSS3DSprite: class {},
    CSS3DRenderer: class {},
}));

vi.mock("three/addons/exporters/GLTFExporter", () => ({
    GLTFExporter: class {},
}));

vi.mock("three/addons/exporters/GLTFExporter.js", () => ({
    GLTFExporter: class {},
}));

vi.mock("../../EngineRuntime", () => ({
    default: class Application {},
}));

vi.mock("../../command/behaviors/AttachBehaviorCommand", () => ({
    AttachBehaviorCommand: class {
        async execute(): Promise<void> {}
    },
}));

vi.mock("../../command/behaviors/DetachBehaviorCommand", () => ({
    DetachBehaviorCommand: class {
        execute(): void {}
    },
}));

vi.mock("../GameRoomState", () => ({
    Behavior: class {
        constructor(
            public id: string,
            public config: unknown,
            public userId: string,
        ) {}
    },
    Script: class {
        constructor(
            public name: string,
            public script: string,
            public userId: string,
        ) {}
    },
}));

import {SNAPSHOT_EVENTS} from "@stem/editor-oss/physics/common/events";

const setUuid = <T extends Object3D>(object: T, uuid: string): T => {
    (object as any).uuid = uuid;
    return object;
};

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

const flush = async () => {
    // Allow pending microtasks to run, then advance the outbound drain timer
    // without incurring real delays, and finally flush any follow-up work.
    // Use runOnlyPendingTimersAsync rather than runAllTimersAsync so the
    // CollaborationClient's periodic sync-check setInterval doesn't loop forever.
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(60);
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
};

const createApp = () => {
    const scene = setUuid(new Scene(), "scene-root");
    scene.userData = {};

    const lambdaManager = {
        getInstance: vi.fn(),
        hasLambdaClass: vi.fn(),
        createInstance: vi.fn(),
        registerObject: vi.fn(),
        deregisterObjectFromAll: vi.fn(),
        destroyInstancesByType: vi.fn(),
        unregisterLambdaClass: vi.fn(),
        updateConfig: vi.fn(),
    };

    const app = {
        userId: "local-user",
        scene,
        isPlaying: false,
        editor: {
            sceneID: "scene-1",
            deserializeObject: vi.fn(),
            processParticleSystems: vi.fn(),
            pauseObjectBehaviors: vi.fn(),
            resumeObjectBehaviors: vi.fn(),
            retargetObjectBehaviors: vi.fn(),
            addAllPendingBehaviors: vi.fn(),
            addBehaviorPlugin: vi.fn(),
            removeBehaviorPlugin: vi.fn(),
            loadBackendLambdaConfigs: vi.fn().mockResolvedValue(undefined),
            loadBackendImportSources: vi.fn().mockResolvedValue(undefined),
            behaviorConfigRegistry: {
                getAllConfigs: vi.fn(() => []),
                unregisterConfig: vi.fn(),
                registerConfig: vi.fn(),
            },
            behaviorScriptRegistry: {
                getScripts: vi.fn(() => ({})),
                unregisterScript: vi.fn(),
                registerScript: vi.fn(),
                updateScript: vi.fn(),
            },
            lambdaConfigRegistry: {
                getAllConfigs: vi.fn(() => []),
                getConfig: vi.fn(() => null),
                registerConfig: vi.fn(),
                updateConfig: vi.fn(),
                unregisterConfig: vi.fn(),
                setAssetMeta: vi.fn(),
                getAssetMeta: vi.fn(() => null),
            },
            syncSceneBehaviorConfigs: vi.fn(),
        },
        physics: {
            removeObject: vi.fn(),
            addObject: vi.fn().mockResolvedValue(undefined),
        },
        game: {
            removeObject: vi.fn(),
            disposeObject: vi.fn(),
            ensureLambdaClassLoaded: vi.fn().mockResolvedValue(undefined),
            lambdaManager,
        },
        multiplayerClient: {
            isHost: vi.fn(() => false),
            addOnPlayerAddedListener: vi.fn(() => "added-token"),
            addOnPlayerRemovedListener: vi.fn(() => "removed-token"),
            removeOnPlayerAddedListener: vi.fn(),
            removeOnPlayerRemovedListener: vi.fn(),
        },
        on: vi.fn(),
        call: vi.fn(),
    };

    hoisted.globalMock.app = app;
    return {app, scene, lambdaManager};
};

describe("CollaborationClient", () => {
    let clients: CollaborationClient[] = [];

    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
        clients = [];
    });

    afterEach(() => {
        clients.forEach(client => client.terminate());
        vi.restoreAllMocks();
    });

    it("registers lambda instances for remote objects added through collaboration", async () => {
        const workerHandler = {postMessage: vi.fn()} as any;
        const {app, scene, lambdaManager} = createApp();
        const client = new CollaborationClient(workerHandler);
        clients.push(client);

        const remoteObject = setUuid(new Object3D(), "remote-object");
        remoteObject.userData = {
            lambdaComponents: [
                {
                    enabled: true,
                    instanceId: "lambda-instance-1",
                    lambdaId: "follow-player",
                    componentData: {speed: 3},
                },
            ],
        };

        app.editor.deserializeObject.mockResolvedValue(remoteObject);
        lambdaManager.getInstance.mockReturnValue(null);
        lambdaManager.hasLambdaClass.mockReturnValue(true);
        lambdaManager.createInstance.mockResolvedValue({
            uuid: "lambda-instance-1",
            attributes: {},
            getComponentData: vi.fn(() => null),
        });

        client.onSnapshotObjectAdd({
            uuid: "remote-object",
            parentUuid: scene.uuid,
            userId: "remote-user",
        });
        await flush();

        expect(scene.children).toContain(remoteObject);
        expect(app.editor.deserializeObject).toHaveBeenCalled();
        expect(lambdaManager.hasLambdaClass).toHaveBeenCalledWith("follow-player");
        expect(lambdaManager.getInstance).toHaveBeenCalledWith("lambda-instance-1");
        expect(lambdaManager.createInstance).toHaveBeenCalledWith("follow-player", {
            uuid: "lambda-instance-1",
            attributes: {},
        });
        expect(lambdaManager.registerObject).toHaveBeenCalledWith("lambda-instance-1", remoteObject, {speed: 3});
        expect(app.editor.processParticleSystems).toHaveBeenCalledWith(remoteObject);
        expect(app.call).toHaveBeenCalledWith("objectUpdated", client, remoteObject);
    });

    it("refreshes import sources when scene assets are added or removed", () => {
        const workerHandler = {postMessage: vi.fn()} as any;
        const {app} = createApp();
        const client = new CollaborationClient(workerHandler);
        clients.push(client);

        client.onAssetAdd();
        client.onAssetRemove("asset-1");

        expect(app.editor.loadBackendImportSources).toHaveBeenCalledTimes(2);
    });

    it("reloads dependent scripts when an asset update may affect imports", () => {
        const workerHandler = {postMessage: vi.fn()} as any;
        const {app} = createApp();
        const client = new CollaborationClient(workerHandler);
        clients.push(client);

        client.onAssetUpdate("import-asset");

        expect(app.editor.loadBackendImportSources).toHaveBeenCalledTimes(1);
        expect(hoisted.refreshDependentScriptsForScriptMock).toHaveBeenCalledWith("import-asset");
    });

    it("preserves child stems and rebinds lambda runtime when a remote object is updated", async () => {
        const workerHandler = {postMessage: vi.fn()} as any;
        const {app, scene, lambdaManager} = createApp();
        const client = new CollaborationClient(workerHandler);
        clients.push(client);

        const oldObject = setUuid(new Object3D(), "shared-object");
        oldObject.userData = {
            behaviors: [],
            lambdaComponents: [
                {
                    enabled: true,
                    instanceId: "lambda-instance-1",
                    lambdaId: "follow-player",
                    componentData: {speed: 1},
                },
            ],
        };
        scene.add(oldObject);

        const childStem = setUuid(new Object3D(), "child-stem");
        childStem.userData = {stemId: "stem-1"};
        oldObject.add(childStem);

        const replacement = setUuid(new Object3D(), "shared-object");
        replacement.userData = {
            behaviors: [],
            lambdaComponents: [
                {
                    enabled: true,
                    instanceId: "lambda-instance-1",
                    lambdaId: "follow-player",
                    componentData: {speed: 5},
                },
            ],
        };

        app.editor.deserializeObject.mockResolvedValue(replacement);
        lambdaManager.getInstance.mockReturnValue({
            uuid: "lambda-instance-1",
            attributes: {},
            getComponentData: vi.fn(() => null),
        });

        client.onSnapshotObjectUpdate({
            uuid: "shared-object",
            parent: scene.uuid,
            userId: "remote-user",
            userData: replacement.userData,
        });
        await flush();

        expect(replacement.children).toContain(childStem);
        expect(childStem.parent).toBe(replacement);
        expect(scene.children[0]).toBe(replacement);
        expect(lambdaManager.deregisterObjectFromAll).toHaveBeenCalledWith(oldObject);
        expect(lambdaManager.registerObject).toHaveBeenCalledWith("lambda-instance-1", replacement, {speed: 5});
        expect(app.physics.removeObject).toHaveBeenCalledWith(oldObject);
        expect(app.physics.addObject).toHaveBeenCalledWith(replacement);
        expect(app.editor.retargetObjectBehaviors).toHaveBeenCalledWith("shared-object", replacement);
        expect(app.editor.processParticleSystems).toHaveBeenCalledWith(replacement);
    });

    it("removes the full non-runtime subtree when a local object is deleted in collaboration mode", () => {
        const workerHandler = {postMessage: vi.fn()} as any;
        const {scene} = createApp();
        const client = new CollaborationClient(workerHandler);
        clients.push(client);

        const root = setUuid(new Object3D(), "root-stem");
        const child = setUuid(new Object3D(), "child-stem");
        const grandchild = setUuid(new Object3D(), "grandchild-stem");
        const runtimeOnly = setUuid(new Object3D(), "runtime-only");
        runtimeOnly.userData = {isRuntimeOnly: true};
        const serverOnly = setUuid(new Object3D(), "server-only");
        serverOnly.userData = {Server: true};

        root.add(child);
        child.add(grandchild);
        root.add(runtimeOnly);
        root.add(serverOnly);
        scene.add(root);
        root.removeFromParent();
        const traverse = vi.spyOn(root, "traverse").mockImplementation(() => {
            throw new Error("recursive traversal should not be used");
        });

        (client as any).removeObject(root);

        const removals = workerHandler.postMessage.mock.calls
            .map(([payload]: [any]) => payload)
            .filter((payload: any) => payload.event === SNAPSHOT_EVENTS.REMOVE.OBJECT)
            .map((payload: any) => payload.uuid);

        expect(removals).toEqual(["root-stem", "child-stem", "grandchild-stem"]);
        expect(traverse).not.toHaveBeenCalled();
    });

    it("serializes deep scene children without recursive stack growth", () => {
        const workerHandler = {postMessage: vi.fn()} as any;
        const {scene} = createApp();
        const client = new CollaborationClient(workerHandler);
        clients.push(client);

        let cursor: Object3D = scene;
        for (let i = 0; i < 12_000; i++) {
            const child = setUuid(new Object3D(), `deep-child-${i}`);
            cursor.add(child);
            cursor = child;
        }

        const children = (client as any).updateSceneChildren(scene) as Array<{uuid: string; children: any[]}>;
        let node = children[0]!;
        for (let i = 1; i < 12_000; i++) {
            node = node.children[0]!;
        }

        expect(node.uuid).toBe(cursor.uuid);
        expect(workerHandler.postMessage).toHaveBeenCalledWith({
            event: SNAPSHOT_EVENTS.UPDATE.SCENE_CHILDREN,
            uuid: scene.uuid,
            children,
        });
    });

    it("emits collabObjectRemoved when a remote object is deleted", async () => {
        const workerHandler = {postMessage: vi.fn()} as any;
        const {app, scene} = createApp();
        const client = new CollaborationClient(workerHandler);
        clients.push(client);

        const remoteObject = setUuid(new Object3D(), "remote-light");
        remoteObject.userData = {behaviors: []};
        scene.add(remoteObject);

        client.onSnapshotObjectRemove({
            uuid: "remote-light",
            userId: "remote-user",
        });
        await flush();

        expect(app.game.removeObject).toHaveBeenCalledWith(remoteObject);
        expect(app.call).toHaveBeenCalledWith("collabObjectRemoved", client, remoteObject);
    });

    it("applies remote lambda config register, update, and unregister messages", async () => {
        const workerHandler = {postMessage: vi.fn()} as any;
        const {app} = createApp();
        const client = new CollaborationClient(workerHandler);
        clients.push(client);

        const lambdaConfig = {
            id: "follow-player",
            name: "Follow Player",
            description: "Tracks a player target",
            componentSchema: {},
            attributes: {},
        } as LambdaConfig;

        app.editor.lambdaConfigRegistry.getConfig.mockReturnValueOnce(null);
        client.onLambdaRegistered({
            id: "follow-player",
            config: JSON.stringify(lambdaConfig),
            userId: "remote-user",
        });
        await flush();

        client.onLambdaUpdated({
            id: "follow-player",
            config: lambdaConfig,
            userId: "remote-user",
        });
        await flush();

        client.onLambdaUnregistered({
            id: "follow-player",
            userId: "remote-user",
        });

        expect(app.editor.lambdaConfigRegistry.registerConfig).toHaveBeenCalledWith(
            "follow-player",
            lambdaConfig,
            true,
        );
        expect(app.editor.lambdaConfigRegistry.updateConfig).toHaveBeenCalledWith("follow-player", lambdaConfig, true);
        expect(app.editor.lambdaConfigRegistry.unregisterConfig).toHaveBeenCalledWith("follow-player", true);
        expect(app.game.lambdaManager.updateConfig).toHaveBeenCalledTimes(2);
    });

    // --- Integration tests for queue behavior ---

    it("remote add followed by immediate remove does not add the object", async () => {
        const workerHandler = {postMessage: vi.fn()} as any;
        const {app, scene} = createApp();
        const client = new CollaborationClient(workerHandler);
        clients.push(client);

        const remoteObject = setUuid(new Object3D(), "ephemeral-obj");
        remoteObject.userData = {};
        app.editor.deserializeObject.mockResolvedValue(remoteObject);

        client.onSnapshotObjectAdd({
            uuid: "ephemeral-obj",
            parentUuid: scene.uuid,
            userId: "remote-user",
        });
        client.onSnapshotObjectRemove({
            uuid: "ephemeral-obj",
            userId: "remote-user",
        });
        await flush();

        expect(app.editor.deserializeObject).not.toHaveBeenCalled();
        expect(scene.getObjectByProperty("uuid", "ephemeral-obj")).toBeUndefined();
    });

    it("rapid-fire remote updates only process the last one (deduplication)", async () => {
        const workerHandler = {postMessage: vi.fn()} as any;
        const {app, scene} = createApp();
        const client = new CollaborationClient(workerHandler);
        clients.push(client);

        const existing = setUuid(new Object3D(), "rapid-obj");
        existing.userData = {behaviors: []};
        scene.add(existing);

        let deserializeCount = 0;
        app.editor.deserializeObject.mockImplementation((obj: Record<string, unknown>) => {
            deserializeCount++;
            const replacement = setUuid(new Object3D(), obj.uuid as string);
            replacement.userData = {behaviors: [], name: obj.name as string};
            return Promise.resolve(replacement);
        });

        client.onSnapshotObjectUpdate({
            uuid: "rapid-obj",
            parent: scene.uuid,
            userId: "remote-user",
            name: "v1",
            userData: {},
        });
        client.onSnapshotObjectUpdate({
            uuid: "rapid-obj",
            parent: scene.uuid,
            userId: "remote-user",
            name: "v2",
            userData: {},
        });
        client.onSnapshotObjectUpdate({
            uuid: "rapid-obj",
            parent: scene.uuid,
            userId: "remote-user",
            name: "v3",
            userData: {},
        });
        await flush();

        expect(deserializeCount).toBe(1);
        expect(app.editor.deserializeObject).toHaveBeenCalledWith(expect.objectContaining({name: "v3"}));
    });

    it("outbound updateObject is suppressed while inbound is processing the same UUID", async () => {
        const workerHandler = {postMessage: vi.fn()} as any;
        const {app, scene} = createApp();
        const client = new CollaborationClient(workerHandler);
        clients.push(client);

        const obj = setUuid(new Object3D(), "contested-obj");
        obj.userData = {behaviors: []};
        scene.add(obj);

        let resolveDeserialize!: (value: Object3D) => void;
        app.editor.deserializeObject.mockImplementation(
            () =>
                new Promise<Object3D>(r => {
                    resolveDeserialize = r;
                }),
        );

        client.onSnapshotObjectUpdate({uuid: "contested-obj", parent: scene.uuid, userId: "remote-user", userData: {}});
        await vi.advanceTimersByTimeAsync(10);
        await Promise.resolve();

        (client as any).updateObject(obj);
        await flush();

        const updateMessages = workerHandler.postMessage.mock.calls.filter(
            ([p]: [any]) => p.event === SNAPSHOT_EVENTS.UPDATE.OBJECT && p.object?.uuid === "contested-obj",
        );
        expect(updateMessages).toHaveLength(0);

        const replacement = setUuid(new Object3D(), "contested-obj");
        replacement.userData = {behaviors: []};
        resolveDeserialize(replacement);
        await flush();
    });
});
