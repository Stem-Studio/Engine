import {afterEach, describe, expect, it} from "vitest";
import * as THREE from "three";

import global from "../../global";
import {createQuickBuildObject} from "../../editor/assets/v2/QuickBuild/quickBuildObjects";
import {getNonSelectableReason} from "../../utils/SelectionUtils";
import {resolveSelectionTargetFromPickHit} from "./pickTargetUtils";

describe("pickTargetUtils", () => {
    const previousApp = global.app;

    afterEach(() => {
        global.app = previousApp;
    });

    it("resolves runtime-only GLB descendants back to the visible model root", () => {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera();

        const root = new THREE.Group();
        root.name = "ImportedModel";
        root.userData = {isStemObject: true};

        const armature = new THREE.Group();
        armature.name = "Armature";
        armature.userData = {isRuntimeOnly: true};

        const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        mesh.name = "Body";
        mesh.userData = {isRuntimeOnly: true};

        scene.add(root);
        root.add(armature);
        armature.add(mesh);

        global.app = {editor: {scene}} as unknown as typeof global.app;

        const target = resolveSelectionTargetFromPickHit(mesh);

        expect(target).toBe(root);
        expect(getNonSelectableReason(target, {mode: "edit", game: null, editor: {scene, camera, sceneLockedItems: []}})).toBeNull();
    });

    it("keeps hidden dynamic-root content blocked when no visible ancestor exists", () => {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera();

        const dynamicRoot = new THREE.Group();
        dynamicRoot.name = "[Dynamic]";
        dynamicRoot.userData = {isRuntimeOnly: true};

        const hiddenMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        hiddenMesh.name = "RuntimeOnlyMesh";
        hiddenMesh.userData = {isRuntimeOnly: true};

        scene.add(dynamicRoot);
        dynamicRoot.add(hiddenMesh);

        global.app = {editor: {scene}} as unknown as typeof global.app;

        const target = resolveSelectionTargetFromPickHit(hiddenMesh);

        expect(target).toBe(hiddenMesh);
        expect(getNonSelectableReason(target, {mode: "edit", game: null, editor: {scene, camera, sceneLockedItems: []}})).toBe("hidden-hierarchy");
    });

    it("uses helper-linked selection targets instead of blocking helper hits", () => {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera();

        const targetObject = new THREE.Group();
        targetObject.name = "Light";
        targetObject.userData = {isStemObject: true};

        const helperHandle = new THREE.Object3D();
        helperHandle.name = "LightHelperHandle";
        helperHandle.userData = {
            isRuntimeOnly: true,
            object: targetObject,
        };

        scene.add(targetObject);

        const target = resolveSelectionTargetFromPickHit(helperHandle);

        expect(target).toBe(targetObject);
        expect(getNonSelectableReason(target, {mode: "edit", game: null, editor: {scene, camera, sceneLockedItems: []}})).toBeNull();
    });

    it("resolves Quick Build child mesh hits to the editable stamp root", () => {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera();
        const stamp = createQuickBuildObject("house");
        const childMesh = stamp.children[0];
        scene.add(stamp);

        global.app = {editor: {scene}} as unknown as typeof global.app;

        const target = resolveSelectionTargetFromPickHit(childMesh);

        expect(target).toBe(stamp);
        expect(getNonSelectableReason(target, {mode: "edit", game: null, editor: {scene, camera, sceneLockedItems: []}})).toBeNull();
    });

    it("does not treat scene-level BIM data as a selection target for ordinary objects", () => {
        const scene = new THREE.Scene();
        scene.userData.planCad = {
            schema: "stem.planCad.v1",
            rootNodeIds: [],
            nodes: {},
        };
        const looseMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        scene.add(looseMesh);
        global.app = {editor: {scene}} as unknown as typeof global.app;

        const target = resolveSelectionTargetFromPickHit(looseMesh);

        expect(target).toBe(looseMesh);
    });

    it("promotes imported BIM model child hits to the BIM group transform target", () => {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera();

        const bimItem = new THREE.Group();
        bimItem.name = "BIM Item";
        bimItem.userData = {
            isStemObject: true,
            isRuntimeOnly: true,
            isPlanCadManaged: true,
            planNodeId: "item-1",
            managedBy: "BIM Plan",
        };

        const importedRoot = new THREE.Group();
        importedRoot.name = "Imported Chair";
        importedRoot.userData = {
            isStemObject: true,
            isRuntimeOnly: true,
        };

        const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        mesh.name = "ChairSeat";
        mesh.userData = {
            isRuntimeOnly: true,
            isPlanCadExternalModelChild: true,
        };

        scene.add(bimItem);
        bimItem.add(importedRoot);
        importedRoot.add(mesh);
        global.app = {editor: {scene}} as unknown as typeof global.app;

        const target = resolveSelectionTargetFromPickHit(mesh);

        expect(target).toBe(bimItem);
        expect(getNonSelectableReason(target, {mode: "edit", game: null, editor: {scene, camera, sceneLockedItems: []}})).toBeNull();
    });

    it("does not block selected BIM wrapper groups whose children carry BIM metadata", () => {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera();
        const wrapper = new THREE.Group();
        wrapper.userData = {
            isRuntimeOnly: true,
            isSelectable: true,
        };
        const bimChild = new THREE.Group();
        bimChild.userData = {
            isPlanCadManaged: true,
            planNodeId: "wall-1",
        };

        scene.add(wrapper);
        wrapper.add(bimChild);

        expect(getNonSelectableReason(wrapper, {mode: "edit", game: null, editor: {scene, camera, sceneLockedItems: []}})).toBeNull();
    });
});
