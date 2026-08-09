/**
 * ObjectHandlers Integration Tests
 *
 * Tests that script command execution through ObjectHandlers does NOT corrupt
 * Three.js object properties or userData. Verifies serialization integrity
 * after handler operations.
 */
import * as THREE from "three";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────
vi.mock("i18next", async (importOriginal) => ({
    ...await importOriginal<typeof import("i18next")>(),
    t: (key: string) => key,
}));

// Mock the entire Commands module to avoid transitive imports that fail
// in test environment. Each mock command performs the actual Three.js operation.

vi.mock("../../command/Commands", () => {
    return {
        AddObjectCommand: class {
            object: THREE.Object3D;
            parent?: THREE.Object3D;
            callback: ((object: THREE.Object3D) => void) | null;
            noSelect: boolean;
            noFocus: boolean;
            constructor(
                object: THREE.Object3D,
                parent?: THREE.Object3D,
                callback: ((object: THREE.Object3D) => void) | null = null,
                noSelect = false,
                noFocus = false,
            ) {
                this.object = object;
                this.parent = parent;
                this.callback = callback;
                this.noSelect = noSelect;
                this.noFocus = noFocus;
            }
            async execute() {
                // Simulate editor.addObject
                const {default: global} = await import("../../global");
                const editor = (global as any).app?.editor;
                editor?.addObject(this.object, this.parent);
                if (!this.noSelect) {
                    editor?.select(this.object, this.noFocus);
                }
                this.callback?.(this.object);
                return {status: "success", message: `Added ${this.object.name}`};
            }
        },
        RemoveObjectCommand: class {
            object: THREE.Object3D;
            constructor(object: THREE.Object3D) {
                this.object = object;
            }
            async execute() {
                const {default: global} = await import("../../global");
                (global as any).app?.editor?.removeObject(this.object);
                return {status: "success", message: `Removed ${this.object.name}`};
            }
        },
        MoveObjectCommand: class {
            object: THREE.Object3D;
            newParent: THREE.Object3D;
            constructor(object: THREE.Object3D, newParent: THREE.Object3D) {
                this.object = object;
                this.newParent = newParent;
            }
            execute() {
                if (this.object.parent) {
                    this.object.parent.remove(this.object);
                }
                this.newParent.add(this.object);
                return {status: "success", message: `Moved ${this.object.name}`};
            }
        },
        SetPositionCommand: class {
            object: THREE.Object3D;
            newPosition: THREE.Vector3;
            constructor(object: THREE.Object3D, newPosition: THREE.Vector3) {
                this.object = object;
                this.newPosition = newPosition;
            }
            execute() {
                this.object.position.copy(this.newPosition);
                this.object.updateMatrixWorld(true);
                return {status: "success"};
            }
        },
        SetRotationCommand: class {
            object: THREE.Object3D;
            newRotation: THREE.Euler;
            constructor(object: THREE.Object3D, newRotation: THREE.Euler) {
                this.object = object;
                this.newRotation = newRotation;
            }
            execute() {
                this.object.rotation.copy(this.newRotation);
                this.object.updateMatrixWorld(true);
                return {status: "success"};
            }
        },
        SetScaleCommand: class {
            object: THREE.Object3D;
            newScale: THREE.Vector3;
            constructor(object: THREE.Object3D, newScale: THREE.Vector3) {
                this.object = object;
                this.newScale = newScale;
            }
            execute() {
                this.object.scale.copy(this.newScale);
                this.object.updateMatrixWorld(true);
                return {status: "success"};
            }
        },
        SetMaterialColorCommand: class {
            object: any;
            attributeName: string;
            newValue: any;
            constructor(object: any, attributeName: string, newValue: any) {
                this.object = object;
                this.attributeName = attributeName;
                this.newValue = newValue;
            }
            execute() {
                if (this.object.material?.[this.attributeName]?.setHex) {
                    const color = new THREE.Color(this.newValue);
                    this.object.material[this.attributeName].setHex(color.getHex());
                }
                return {status: "success"};
            }
        },
        SetMaterialTextureCommand: class {
            constructor() {}
            execute() { return Promise.resolve({status: "success"}); }
        },
        Add3dObjectCommand: class {
            constructor() {}
            execute() { return Promise.resolve({status: "success"}); }
        },
    };
});

// Mock other dependencies
vi.mock("@stem/network/api/asset", async (importOriginal) => ({
    ...await importOriginal<typeof import("@stem/network/api/asset")>(),
    getAsset: vi.fn(),
    getAssets: vi.fn(),
    getSceneAssets: vi.fn(),
}));

vi.mock("@stem/network/api/scene/v2", () => ({
    createSceneAssetWithData: vi.fn(),
}));

vi.mock("../../asset-management/AssetResolutionContext", () => ({
    getAssetResolutionContext: vi.fn(() => null),
    resolveAssetRevisionId: vi.fn(),
    setAssetRevision: vi.fn(),
}));

vi.mock("../../editor/assets/v2/materials/materialUtils", () => ({
    applyMaterialValueOverridesToObject: vi.fn(),
    applyTextureOverridesToObject: vi.fn(),
}));

vi.mock("../../utils/ModelGeneratorProvider", () => ({
    GENERATOR_TYPES: {MESHY: "meshy"},
}));

vi.mock("../../controls/AiWorldController/AiWorldController", () => ({
    default: class MockAIWorldController {},
}));

vi.mock("../../controls/AiWorldController/AiWorldController.utils", () => ({
    urlToFile: vi.fn(),
}));

vi.mock("../../utils/TagUtil", () => ({
    default: {
        addTag: (object: THREE.Object3D, tags: string[]) => {
            if (!object.userData.tags) object.userData.tags = [];
            object.userData.tags.push(...tags);
        },
    },
}));

vi.mock("../../editor/assets/v2/RightPanel/sections/MaterialRenderingSection/types", () => ({}));

import global from "../../global";
import {applyMaterialValueOverridesToObject} from "../../editor/assets/v2/materials/materialUtils";
import {ObjectHandlers} from "./ObjectHandlers";

// ─── Helpers ──────────────────────────────────────────────────────────

function createMockEditor(scene: THREE.Scene) {
    return {
        scene,
        sceneID: "test-scene-id",
        selected: null as THREE.Object3D | null,
        history: {
            undos: [] as any[],
            execute: vi.fn((cmd: any) => cmd.execute()),
        },
        addObject: vi.fn((object: THREE.Object3D, parent?: THREE.Object3D) => {
            (parent || scene).add(object);
        }),
        removeObject: vi.fn((object: THREE.Object3D) => {
            object.parent?.remove(object);
        }),
        select: vi.fn(),
        deselect: vi.fn(),
        cloneObjectByUuid: vi.fn(),
        serializeObject: vi.fn((obj: THREE.Object3D) => obj.toJSON()),
    };
}

function createMockApp(scene: THREE.Scene, editor: ReturnType<typeof createMockEditor>) {
    return {
        scene,
        editor,
        call: vi.fn(),
    };
}

function createDeepGroupWithLeafMesh(name: string, depth = 12_000) {
    const group = new THREE.Group();
    group.name = name;
    let cursor: THREE.Object3D = group;
    for (let i = 0; i < depth; i++) {
        const child = new THREE.Group();
        cursor.add(child);
        cursor = child;
    }

    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({color: 0x224466}),
    );
    cursor.add(mesh);

    return {group, mesh};
}

/** Snapshot essential properties for corruption detection */
function snapshotObject(obj: THREE.Object3D) {
    return {
        uuid: obj.uuid,
        name: obj.name,
        type: obj.type,
        position: obj.position.toArray(),
        rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z, obj.rotation.order],
        scale: obj.scale.toArray(),
        visible: obj.visible,
        userData: JSON.parse(JSON.stringify(obj.userData)),
    };
}

/** Verify an object can be serialized to JSON without errors */
function assertSerializable(obj: THREE.Object3D) {
    let json: any;
    expect(() => { json = obj.toJSON(); }).not.toThrow();
    expect(json).toBeDefined();
    expect(json.object).toBeDefined();
    expect(json.object.uuid).toBe(obj.uuid);
    return json;
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("ObjectHandlers: object property integrity", () => {
    let scene: THREE.Scene;
    let editor: ReturnType<typeof createMockEditor>;
    let app: ReturnType<typeof createMockApp>;
    let handlers: ObjectHandlers;

    beforeEach(() => {
        scene = new THREE.Scene();
        scene.name = "Default Scene";
        editor = createMockEditor(scene);
        app = createMockApp(scene, editor);
        (global as any).app = app;
        handlers = new ObjectHandlers(app as any, {} as any);
    });

    afterEach(() => {
        (global as any).app = null;
    });

    // ─── handleCreatePrimitive ────────────────────────────────────

    describe("handleCreatePrimitive", () => {
        it("creates a mesh with correct position, scale, rotation", async () => {
            const result = await handlers.handleCreatePrimitive({
                type: "box",
                name: "TestBox",
                position: {x: 1, y: 2, z: 3},
                scale: {x: 2, y: 2, z: 2},
                rotation: {x: 0, y: Math.PI / 2, z: 0},
            });

            expect(result.status).toBe("success");
            const obj = scene.getObjectByName("TestBox");
            expect(obj).toBeDefined();
            expect(obj!.position.x).toBe(1);
            expect(obj!.position.y).toBe(2);
            expect(obj!.position.z).toBe(3);
            expect(obj!.scale.x).toBe(2);
            expect(obj!.rotation.y).toBeCloseTo(Math.PI / 2);
        });

        it("created object is serializable to JSON", async () => {
            await handlers.handleCreatePrimitive({
                type: "sphere", name: "SerializeSphere", position: {x: 0, y: 5, z: 0},
            });
            const obj = scene.getObjectByName("SerializeSphere");
            expect(obj).toBeDefined();
            assertSerializable(obj!);
        });

        it("created object has valid geometry and material", async () => {
            await handlers.handleCreatePrimitive({type: "box", name: "GeoMatBox", color: "#ff0000"});
            const mesh = scene.getObjectByName("GeoMatBox") as THREE.Mesh;
            expect(mesh).toBeInstanceOf(THREE.Mesh);
            expect(mesh.geometry).toBeInstanceOf(THREE.BufferGeometry);
            expect(mesh.geometry.attributes.position).toBeDefined();
            expect(mesh.material).toBeDefined();
            const mat = mesh.material as THREE.MeshStandardMaterial;
            expect(mat.color.getHexString()).toBe("ff0000");
        });

        it("selects copilot-created primitives without focusing the camera", async () => {
            await handlers.handleCreatePrimitive({type: "box", name: "NoFocusBox"});

            const mesh = scene.getObjectByName("NoFocusBox") as THREE.Mesh;
            expect(editor.select).toHaveBeenNthCalledWith(1, mesh, true);
        });

        it("does not corrupt userData when objectSettings are applied", async () => {
            await handlers.handleCreatePrimitive({
                type: "box", name: "UserDataBox",
                objectSettings: {
                    isBatchable: false, isStatic: true, isSelectable: false,
                    enableAtStart: false, visibleByAI: true, gameVisibility: false,
                },
            });

            const obj = scene.getObjectByName("UserDataBox")!;
            expect(obj.userData.isBatchable).toBe(false);
            expect(obj.userData.isStatic).toBe(true);
            expect(obj.userData.isSelectable).toBe(false);
            expect(obj.userData.enableAtStart).toBe(false);
            expect(obj.userData.visibleByAI).toBe(true);
            expect(obj.userData.gameVisibility).toBe(false);
            assertSerializable(obj);
        });

        it("objectSettings does not overwrite unrelated userData fields", async () => {
            await handlers.handleCreatePrimitive({type: "box", name: "PartialSettings"});
            const obj = scene.getObjectByName("PartialSettings")!;
            obj.userData.customField = "keep-me";
            obj.userData.isBatchable = true;

            handlers.handleModifyObject({
                target: "PartialSettings",
                objectSettings: {isStatic: true},
            });

            expect(obj.userData.customField).toBe("keep-me");
            expect(obj.userData.isBatchable).toBe(true);
            expect(obj.userData.isStatic).toBe(true);
        });

        it("all primitive types create valid geometry", async () => {
            const types = [
                "box", "sphere", "cylinder", "cone", "plane",
                "torus", "torusknot", "capsule", "icosahedron",
                "octahedron", "dodecahedron", "ring",
            ];
            for (const type of types) {
                const name = `Prim_${type}`;
                const result = await handlers.handleCreatePrimitive({type, name});
                expect(result.status).toBe("success");
                const mesh = scene.getObjectByName(name) as THREE.Mesh;
                expect(mesh).toBeDefined();
                expect(mesh.geometry).toBeDefined();
                expect(mesh.geometry.attributes.position).toBeDefined();
                assertSerializable(mesh);
            }
        });

        it("applies primitive segment parameters to supported geometries", async () => {
            await handlers.handleCreatePrimitive({
                type: "plane",
                name: "SegmentedPlane",
                size: {x: 4000, y: 1, z: 3000},
                widthSegments: 4,
                heightSegments: 3,
            });
            await handlers.handleCreatePrimitive({
                type: "box",
                name: "SegmentedBox",
                widthSegments: 5,
                heightSegments: 2,
                depthSegments: 7,
            });

            const plane = scene.getObjectByName("SegmentedPlane") as THREE.Mesh;
            const box = scene.getObjectByName("SegmentedBox") as THREE.Mesh;

            expect((plane.geometry as THREE.PlaneGeometry).parameters.widthSegments).toBe(4);
            expect((plane.geometry as THREE.PlaneGeometry).parameters.heightSegments).toBe(3);
            expect((box.geometry as THREE.BoxGeometry).parameters.widthSegments).toBe(5);
            expect((box.geometry as THREE.BoxGeometry).parameters.heightSegments).toBe(2);
            expect((box.geometry as THREE.BoxGeometry).parameters.depthSegments).toBe(7);
        });

        it("idempotent: second call with same name modifies instead of duplicating", async () => {
            await handlers.handleCreatePrimitive({
                type: "box", name: "IdempotentBox", position: {x: 0, y: 0, z: 0},
            });
            const firstUuid = scene.getObjectByName("IdempotentBox")!.uuid;

            await handlers.handleCreatePrimitive({
                type: "box", name: "IdempotentBox", position: {x: 10, y: 0, z: 0},
            });

            const obj = scene.getObjectByName("IdempotentBox")!;
            expect(obj.uuid).toBe(firstUuid);
            expect(obj.position.x).toBe(10);
        });
    });

    // ─── handleCreateGroup ────────────────────────────────────────

    describe("handleCreateGroup", () => {
        it("creates a group with correct properties", async () => {
            const result = await handlers.handleCreateGroup({name: "TestGroup", position: {x: 5, y: 0, z: 0}});
            expect(result.status).toBe("success");
            const group = scene.getObjectByName("TestGroup");
            expect(group).toBeInstanceOf(THREE.Group);
            expect(group!.position.x).toBe(5);
            assertSerializable(group!);
        });

        it("group userData is not corrupted by objectSettings", async () => {
            await handlers.handleCreateGroup({
                name: "SettingsGroup",
                objectSettings: {isStatic: true, isBatchable: false},
            });
            const group = scene.getObjectByName("SettingsGroup")!;
            expect(group.userData.isStatic).toBe(true);
            expect(group.userData.isBatchable).toBe(false);
            assertSerializable(group);
        });

        it("selects copilot-created groups without focusing the camera", async () => {
            await handlers.handleCreateGroup({name: "NoFocusGroup"});

            const group = scene.getObjectByName("NoFocusGroup") as THREE.Group;
            expect(editor.select).toHaveBeenCalledWith(group, true);
        });
    });

    describe("getter settings", () => {
        it("returns compact object settings for a primitive", async () => {
            await handlers.handleCreatePrimitive({
                type: "box",
                name: "GetterBox",
                position: {x: 1, y: 2, z: 3},
                size: {x: 4, y: 5, z: 6},
                color: "#336699",
                objectSettings: {isStatic: true},
            });

            const result = handlers.handleGetObjectSettings({target: "GetterBox", kind: "box"});

            expect(result.status).toBe("success");
            expect(result.data.kind).toBe("box");
            expect(result.data.transform.position).toEqual({x: 1, y: 2, z: 3});
            expect(result.data.geometry.parameters.width).toBe(4);
            expect(result.data.geometry.parameters.height).toBe(5);
            expect(result.data.geometry.parameters.depth).toBe(6);
            expect(result.data.material.color).toBe("#336699");
            expect(result.data.objectSettings.isStatic).toBe(true);
        });

        it("fails type-specific object getter on kind mismatch", async () => {
            await handlers.handleCreatePrimitive({type: "sphere", name: "GetterSphere"});

            const result = handlers.handleGetObjectSettings({target: "GetterSphere", kind: "box"});

            expect(result.status).toBe("failed");
            expect(result.message).toContain("not box");
        });

        it("returns material override settings", () => {
            const mesh = new THREE.Mesh(
                new THREE.BoxGeometry(1, 1, 1),
                new THREE.MeshStandardMaterial({color: 0xffffff, metalness: 0.25, roughness: 0.75}),
            );
            mesh.name = "MaterialGetter";
            mesh.userData.materialSettings = {
                tileAmountX: 2,
                tileAmountY: 3,
                panningSpeedX: 0.1,
                panningSpeedY: 0.2,
                textures: {base: "asset-id"},
                texturesSettings: {color: "#112233", opacity: 0.5, metallic: 0.8, roughness: 0.4},
            };
            scene.add(mesh);

            const result = handlers.handleGetMaterialSettings({target: "MaterialGetter"});

            expect(result.status).toBe("success");
            expect(result.data.color).toBe("#112233");
            expect(result.data.opacity).toBe(0.5);
            expect(result.data.metalness).toBe(0.8);
            expect(result.data.roughness).toBe(0.4);
            expect(result.data.tileAmountX).toBe(2);
            expect(result.data.textures.base).toBe("asset-id");
        });

        it("reads material settings from deep groups without recursive traversal", () => {
            const {group} = createDeepGroupWithLeafMesh("DeepMaterialGetter");
            scene.add(group);
            const traverseSpy = vi.spyOn(group, "traverse");

            const result = handlers.handleGetMaterialSettings({target: "DeepMaterialGetter"});

            expect(result.status).toBe("success");
            expect(traverseSpy).not.toHaveBeenCalled();
            expect(result.data.material.color).toBe("#224466");
        });
    });

    // ─── handleModifyObject ───────────────────────────────────────

    describe("handleModifyObject", () => {
        let testObj: THREE.Mesh;

        beforeEach(async () => {
            await handlers.handleCreatePrimitive({
                type: "box", name: "ModifyTarget", position: {x: 0, y: 0, z: 0}, color: "#ffffff",
            });
            testObj = scene.getObjectByName("ModifyTarget") as THREE.Mesh;
        });

        it("modifies position without corrupting other properties", () => {
            const before = snapshotObject(testObj);
            handlers.handleModifyObject({target: "ModifyTarget", position: {x: 10, y: 20, z: 30}});

            expect(testObj.position.x).toBe(10);
            expect(testObj.position.y).toBe(20);
            expect(testObj.position.z).toBe(30);
            expect(testObj.scale.toArray()).toEqual(before.scale);
            expect(testObj.uuid).toBe(before.uuid);
            expect(testObj.visible).toBe(before.visible);
        });

        it("modifies scale without corrupting position or rotation", () => {
            testObj.position.set(5, 5, 5);
            testObj.rotation.set(1, 1, 1);
            handlers.handleModifyObject({target: "ModifyTarget", scale: {x: 3, y: 3, z: 3}});
            expect(testObj.scale.x).toBe(3);
            expect(testObj.position.x).toBe(5);
            expect(testObj.rotation.x).toBeCloseTo(1);
        });

        it("modifies rotation without corrupting position or scale", () => {
            testObj.position.set(1, 2, 3);
            testObj.scale.set(4, 4, 4);
            handlers.handleModifyObject({target: "ModifyTarget", rotation: {x: Math.PI, y: 0, z: 0}});
            expect(testObj.rotation.x).toBeCloseTo(Math.PI);
            expect(testObj.position.toArray()).toEqual([1, 2, 3]);
            expect(testObj.scale.toArray()).toEqual([4, 4, 4]);
        });

        it("modifies color without corrupting geometry or transform", () => {
            const geoBefore = testObj.geometry;
            const posBefore = testObj.position.clone();
            handlers.handleModifyObject({target: "ModifyTarget", color: "#00ff00"});
            expect(testObj.geometry).toBe(geoBefore);
            expect(testObj.position.equals(posBefore)).toBe(true);
        });

        it("direct name mutation does not create a new object", () => {
            const uuidBefore = testObj.uuid;
            const childCount = scene.children.length;
            handlers.handleModifyObject({target: "ModifyTarget", name: "RenamedObject"});
            expect(testObj.uuid).toBe(uuidBefore);
            expect(testObj.name).toBe("RenamedObject");
            expect(scene.children.length).toBe(childCount);
        });

        it("tag mutation preserves existing userData", () => {
            testObj.userData.customProp = "preserve-me";
            handlers.handleModifyObject({target: "ModifyTarget", tag: "Player"});
            expect(testObj.userData.customProp).toBe("preserve-me");
            expect(testObj.userData.tags).toBeDefined();
        });

        it("objectSettings mutation preserves existing userData", () => {
            testObj.userData.myBehavior = {id: "test"};
            testObj.userData.isBatchable = true;
            handlers.handleModifyObject({target: "ModifyTarget", objectSettings: {isStatic: true}});
            expect(testObj.userData.myBehavior).toEqual({id: "test"});
            expect(testObj.userData.isBatchable).toBe(true);
            expect(testObj.userData.isStatic).toBe(true);
        });

        it("object remains serializable after all modifications", () => {
            handlers.handleModifyObject({
                target: "ModifyTarget",
                position: {x: 1, y: 2, z: 3},
                scale: {x: 2, y: 2, z: 2},
                rotation: {x: 0.5, y: 0.5, z: 0.5},
                color: "#ff00ff",
                name: "FullyModified",
                tag: "Player",
                objectSettings: {isStatic: true, enableAtStart: false},
            });
            assertSerializable(testObj);
            expect(testObj.name).toBe("FullyModified");
        });

        it("returns failed for non-existent target", () => {
            const result = handlers.handleModifyObject({target: "NonExistent", position: {x: 1, y: 1, z: 1}});
            expect(result.status).toBe("failed");
        });
    });

    // ─── handleDeleteObject ───────────────────────────────────────

    describe("handleDeleteObject", () => {
        it("removes object from scene without corrupting siblings", async () => {
            await handlers.handleCreatePrimitive({type: "box", name: "Keep1"});
            await handlers.handleCreatePrimitive({type: "box", name: "DeleteMe"});
            await handlers.handleCreatePrimitive({type: "box", name: "Keep2"});

            const keep1Before = snapshotObject(scene.getObjectByName("Keep1")!);
            const keep2Before = snapshotObject(scene.getObjectByName("Keep2")!);

            const result = await handlers.handleDeleteObject({target: "DeleteMe"});
            expect(result.status).toBe("success");
            expect(scene.getObjectByName("DeleteMe")).toBeUndefined();

            const keep1After = snapshotObject(scene.getObjectByName("Keep1")!);
            const keep2After = snapshotObject(scene.getObjectByName("Keep2")!);
            expect(keep1After.uuid).toBe(keep1Before.uuid);
            expect(keep2After.uuid).toBe(keep2Before.uuid);
            expect(keep1After.position).toEqual(keep1Before.position);
            expect(keep2After.position).toEqual(keep2Before.position);
        });

        it("returns failed for non-existent target", async () => {
            const result = await handlers.handleDeleteObject({target: "Ghost"});
            expect(result.status).toBe("failed");
        });
    });

    // ─── handleMoveObject ─────────────────────────────────────────

    describe("handleMoveObject", () => {
        it("moves object to new parent without corrupting properties", async () => {
            await handlers.handleCreateGroup({name: "ParentGroup"});
            await handlers.handleCreatePrimitive({type: "box", name: "ChildBox", position: {x: 5, y: 0, z: 0}});

            const child = scene.getObjectByName("ChildBox")!;
            const before = snapshotObject(child);

            await handlers.handleMoveObject({target: "ChildBox", parent: "ParentGroup"});

            const parent = scene.getObjectByName("ParentGroup")!;
            expect(child.parent).toBe(parent);
            expect(child.uuid).toBe(before.uuid);
            expect(child.name).toBe(before.name);
            expect(JSON.stringify(child.userData)).toBe(JSON.stringify(before.userData));
            assertSerializable(child);
        });
    });

    // ─── handleSetMaterial ────────────────────────────────────────

    describe("handleSetMaterial", () => {
        it("does not corrupt object transform when setting material", () => {
            const mesh = new THREE.Mesh(
                new THREE.BoxGeometry(1, 1, 1),
                new THREE.MeshStandardMaterial({color: 0xffffff}),
            );
            mesh.name = "MatTarget";
            mesh.position.set(5, 10, 15);
            mesh.scale.set(2, 2, 2);
            scene.add(mesh);

            const posBefore = mesh.position.clone();
            const scaleBefore = mesh.scale.clone();
            const uuidBefore = mesh.uuid;

            handlers.handleSetMaterial({target: "MatTarget", color: "#ff0000", metalness: 0.5, roughness: 0.3});

            expect(mesh.position.equals(posBefore)).toBe(true);
            expect(mesh.scale.equals(scaleBefore)).toBe(true);
            expect(mesh.uuid).toBe(uuidBefore);
            assertSerializable(mesh);
        });

        it("accepts deep group material targets without recursive traversal", () => {
            const {group} = createDeepGroupWithLeafMesh("DeepMatTarget");
            scene.add(group);
            const traverseSpy = vi.spyOn(group, "traverse");

            const result = handlers.handleSetMaterial({target: "DeepMatTarget", color: "#00ff00"});

            expect(result.status).toBe("success");
            expect(traverseSpy).not.toHaveBeenCalled();
            expect(applyMaterialValueOverridesToObject).toHaveBeenCalledWith(
                group,
                expect.objectContaining({color: "#00ff00"}),
                null,
            );
        });
    });

    // ─── Script-like execution sequences ──────────────────────────

    describe("script-like execution sequence", () => {
        it("solar system setup: objects are serializable after full sequence", async () => {
            await handlers.handleCreateGroup({name: "CameraTarget", position: {x: 0, y: 0, z: 0}});
            handlers.handleModifyObject({target: "CameraTarget", tag: "Player"});

            await handlers.handleCreatePrimitive({
                type: "sphere", name: "Sun", position: {x: 0, y: 0, z: 0}, scale: {x: 5, y: 5, z: 5},
            });
            await handlers.handleCreatePrimitive({
                type: "sphere", name: "Earth", position: {x: 7, y: 0, z: 0}, scale: {x: 1, y: 1, z: 1}, color: "#4488ff",
            });
            await handlers.handleCreatePrimitive({
                type: "sphere", name: "Moon", position: {x: 8.2, y: 0, z: 0}, scale: {x: 0.3, y: 0.3, z: 0.3},
            });

            for (const name of ["CameraTarget", "Sun", "Earth", "Moon"]) {
                const obj = scene.getObjectByName(name);
                expect(obj).toBeDefined();
                assertSerializable(obj!);
            }
            assertSerializable(scene);
        });

        it("create + modify + delete sequence preserves remaining objects", async () => {
            await handlers.handleCreatePrimitive({type: "box", name: "A", position: {x: 0, y: 0, z: 0}});
            await handlers.handleCreatePrimitive({type: "sphere", name: "B", position: {x: 5, y: 0, z: 0}});
            await handlers.handleCreatePrimitive({type: "cylinder", name: "C", position: {x: 10, y: 0, z: 0}});

            handlers.handleModifyObject({
                target: "B", position: {x: 5, y: 10, z: 0}, scale: {x: 2, y: 2, z: 2},
                objectSettings: {isStatic: true},
            });

            await handlers.handleDeleteObject({target: "A"});

            const b = scene.getObjectByName("B")!;
            const c = scene.getObjectByName("C")!;
            expect(b).toBeDefined();
            expect(b.position.y).toBe(10);
            expect(b.scale.x).toBe(2);
            expect(b.userData.isStatic).toBe(true);
            expect(c).toBeDefined();
            expect(c.position.x).toBe(10);

            assertSerializable(b);
            assertSerializable(c);
            assertSerializable(scene);
        });
    });

    // ─── History bypass detection ─────────────────────────────────

    describe("History bypass detection (documenting the bug)", () => {
        it("handleCreatePrimitive does NOT call history.execute", async () => {
            await handlers.handleCreatePrimitive({type: "box", name: "NoHistoryBox"});
            expect(editor.history.execute).not.toHaveBeenCalled();
        });

        it("handleCreateGroup does NOT call history.execute", async () => {
            await handlers.handleCreateGroup({name: "NoHistoryGroup"});
            expect(editor.history.execute).not.toHaveBeenCalled();
        });

        it("handleDeleteObject does NOT call history.execute", async () => {
            await handlers.handleCreatePrimitive({type: "box", name: "ToDelete"});
            await handlers.handleDeleteObject({target: "ToDelete"});
            expect(editor.history.execute).not.toHaveBeenCalled();
        });

        it("handleMoveObject does NOT call history.execute", async () => {
            await handlers.handleCreateGroup({name: "MoveParent"});
            await handlers.handleCreatePrimitive({type: "box", name: "MoveChild"});
            await handlers.handleMoveObject({target: "MoveChild", parent: "MoveParent"});
            expect(editor.history.execute).not.toHaveBeenCalled();
        });

        it("handleModifyObject does NOT call history.execute", async () => {
            await handlers.handleCreatePrimitive({type: "box", name: "ModTarget"});
            handlers.handleModifyObject({target: "ModTarget", position: {x: 1, y: 2, z: 3}});
            expect(editor.history.execute).not.toHaveBeenCalled();
        });
    });
});
