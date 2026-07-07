import {afterEach, describe, expect, it} from "vitest";
import * as THREE from "three";

import global from "../../global";
import {createQuickBuildObject} from "../../editor/assets/v2/QuickBuild/quickBuildObjects";
import {getPickBlockReason, resolveSelectionTargetFromPickHit} from "./pickTargetUtils";

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

        global.app = {editor: {scene}} as any;

        const target = resolveSelectionTargetFromPickHit(mesh);

        expect(target).toBe(root);
        expect(getPickBlockReason(target, {app: {mode: "edit", game: null}, editor: {scene, camera, sceneLockedItems: []}})).toBeNull();
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

        global.app = {editor: {scene}} as any;

        const target = resolveSelectionTargetFromPickHit(hiddenMesh);

        expect(target).toBe(hiddenMesh);
        expect(getPickBlockReason(target, {app: {mode: "edit", game: null}, editor: {scene, camera, sceneLockedItems: []}})).toBe("hidden-hierarchy");
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
        expect(getPickBlockReason(target, {app: {mode: "edit", game: null}, editor: {scene, camera, sceneLockedItems: []}})).toBeNull();
    });

    it("resolves Quick Build child mesh hits to the editable stamp root", () => {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera();
        const stamp = createQuickBuildObject("house");
        const childMesh = stamp.children[0];
        scene.add(stamp);

        global.app = {editor: {scene}} as any;

        const target = resolveSelectionTargetFromPickHit(childMesh);

        expect(target).toBe(stamp);
        expect(getPickBlockReason(target, {app: {mode: "edit", game: null}, editor: {scene, camera, sceneLockedItems: []}})).toBeNull();
    });
});
