import {BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D, Scene} from "three";
import {afterEach, describe, expect, it, vi} from "vitest";

import global from "@stem/editor-oss/global";
import {DYNAMIC_ROOT_NAME} from "@stem/editor-oss/scene/dynamicRoots";
import ObjectAttributeConverter from "./ObjectAttributeConverter";
import ObjectBehaviorsAttributeConverter from "./ObjectBehaviorsAttributeConverter";
import type {BehaviorAttributeData} from "../BehaviorAttributes";
import type {BehaviorContext} from "../BehaviorContextProvider";

function namedObject(name: string): Object3D {
    const object = new Object3D();
    object.name = name;
    return object;
}

function createBehaviorContext(object: Object3D | null = null): BehaviorContext {
    return {
        scene: {
            sceneId: null,
            assetSource: null,
            objects: [],
            assetResolutionContext: null,
        },
        object: object
            ? {
                uuid: object.uuid,
                name: object.name,
                animations: [],
                assetResolutionContext: null,
            }
            : null,
        resources: {sounds: [], models: [], videos: [], images: [], npcs: []},
        random: {uuid: () => "test-uuid"},
    };
}

function installEditorScene(scene: Scene): void {
    global.app = {
        editor: {scene},
    } as any;
}

function addDeepMesh(root: Object3D, depth = 12_000): Mesh {
    let cursor = root;
    for (let i = 0; i < depth; i++) {
        const child = namedObject(`deep-${i}`);
        cursor.add(child);
        cursor = child;
    }

    const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    mesh.name = "deep-mesh";
    cursor.add(mesh);
    return mesh;
}

describe("object behavior attribute converters", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        global.app = null;
    });

    it("builds mesh-filtered object options without recursive Three traversal", () => {
        const scene = new Scene();
        const sceneTraverse = vi.spyOn(scene, "traverse");
        const rootModel = namedObject("Root Model");
        rootModel.userData.isStemObject = true;
        addDeepMesh(rootModel);

        const excluded = namedObject("Excluded");
        excluded.userData.isStemObject = true;
        excluded.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));

        const internalRoot = new Group();
        internalRoot.name = DYNAMIC_ROOT_NAME;
        internalRoot.userData.isRuntimeOnly = true;

        scene.add(rootModel, excluded, internalRoot);
        installEditorScene(scene);

        const attribute = new ObjectAttributeConverter().convertAttribute(
            {
                name: "target",
                type: "object",
                filter: "mesh",
                excludeNames: ["Excluded"],
                array: false,
                invisible: false,
                default: "",
                order: 0,
            } as BehaviorAttributeData,
            createBehaviorContext(),
        );

        expect(sceneTraverse).not.toHaveBeenCalled();
        expect(attribute.options).toEqual([
            {name: "none", uuid: ""},
            {name: "Root Model", uuid: rootModel.uuid},
        ]);
    });

    it("builds object-behavior target options iteratively and preserves defaults", () => {
        const scene = new Scene();
        const sceneTraverse = vi.spyOn(scene, "traverse");
        const group = new Group();
        group.name = "Target Group";
        const child = namedObject("Child Stem Object");
        child.userData.isStemObject = true;
        group.add(child);

        const runtimeOnly = namedObject("Runtime Only");
        runtimeOnly.userData.isRuntimeOnly = true;

        scene.add(group, runtimeOnly);
        installEditorScene(scene);

        const attribute = new ObjectBehaviorsAttributeConverter().convertAttribute(
            {
                name: "targets",
                type: "objectBehaviors",
                includeNone: false,
                defaultToSelf: true,
                array: false,
                invisible: false,
                default: {object: "", behaviors: []},
                order: 3,
            } as BehaviorAttributeData,
            createBehaviorContext(child),
        );

        expect(sceneTraverse).not.toHaveBeenCalled();
        expect(attribute.object).toEqual([
            {name: "Target Group", uuid: group.uuid},
            {name: "Child Stem Object", uuid: child.uuid},
        ]);
        expect(attribute.default).toEqual({object: child.uuid, behaviors: []});
        expect(attribute.order).toBe(3);
    });
});
