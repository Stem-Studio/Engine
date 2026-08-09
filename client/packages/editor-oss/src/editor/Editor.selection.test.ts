import {describe, expect, it, vi} from "vitest";
import * as THREE from "three";

import Editor from "./Editor";

describe("Editor drill-down selection", () => {
    it("keeps current selection when child nodes are hidden from the scene hierarchy", () => {
        const editor = Object.create(Editor.prototype) as Editor;

        const root = new THREE.Object3D();
        root.name = "ImportedModel";
        root.userData = {isStemObject: true};

        const armature = new THREE.Object3D();
        armature.name = "Armature";
        armature.userData = {isRuntimeOnly: true};

        const mesh = new THREE.Object3D();
        mesh.name = "Body";
        mesh.userData = {isRuntimeOnly: true};
        (mesh as THREE.Object3D & {geometry?: object}).geometry = {};

        root.add(armature);
        armature.add(mesh);

        expect(editor.drillDownSelection(root, root)).toBe(root);
    });

    it("still drills down to child objects that are visible in the scene hierarchy", () => {
        const editor = Object.create(Editor.prototype) as Editor;

        const root = new THREE.Object3D();
        root.name = "ImportedModel";
        root.userData = {isStemObject: true};

        const childGroup = new THREE.Object3D();
        childGroup.name = "VisibleChild";
        childGroup.userData = {isStemObject: true};

        root.add(childGroup);

        expect(editor.drillDownSelection(root, root)).toBe(childGroup);
    });

    it("selects BIM Plan root and managed nodes directly from outliner UUID selection", () => {
        const editor = Object.create(Editor.prototype) as Editor;
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera();
        const engine = {userId: "user-1", call: vi.fn()};

        const planRoot = new THREE.Group();
        planRoot.name = "BIM Plan";
        planRoot.userData = {
            isStemObject: true,
            isRuntimeOnly: true,
            isPlanCadManaged: true,
            isPlanCadRoot: true,
        };

        const zone = new THREE.Mesh();
        zone.name = "BIM Zone";
        zone.userData = {
            isStemObject: true,
            isRuntimeOnly: true,
            isPlanCadManaged: true,
            planNodeId: "zone-1",
            planNodeType: "zone",
        };
        const generatedFace = new THREE.Mesh();
        generatedFace.name = "BIM Zone Face";

        zone.add(generatedFace);
        planRoot.add(zone);
        scene.add(planRoot);

        Object.defineProperties(editor, {
            camera: {
                configurable: true,
                get: () => camera,
            },
            scene: {
                configurable: true,
                get: () => scene,
            },
        });
        const mutableEditor = editor as unknown as {
            component: {setState: ReturnType<typeof vi.fn>};
            engine: typeof engine;
            sceneConfig: {
                isCollaborative: boolean;
                isMultiplayer: boolean;
                isSandbox: boolean;
            };
            selected: THREE.Object3D | THREE.Object3D[] | null;
        };
        mutableEditor.component = {setState: vi.fn()};
        mutableEditor.engine = engine;
        mutableEditor.sceneConfig = {
            isCollaborative: false,
            isMultiplayer: false,
            isSandbox: false,
        };
        mutableEditor.selected = null;

        editor.selectByUuid(planRoot.uuid);

        expect(editor.selected).toBe(planRoot);
        expect(engine.call).toHaveBeenCalledWith("objectSelected", editor, planRoot, undefined);

        engine.call.mockClear();
        mutableEditor.selected = null;

        editor.selectByUuid(zone.uuid);

        expect(editor.selected).toBe(zone);
        expect(engine.call).toHaveBeenCalledWith("objectSelected", editor, zone, undefined);

        mutableEditor.selected = null;
        editor.selectByUuid(generatedFace.uuid);

        expect(editor.selected).toBe(zone);
    });
});
