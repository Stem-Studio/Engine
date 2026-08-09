/**
 * Module: EmptySceneTemplate.ts
 * Purpose: Contains logic for empty scene template.
 */

import * as THREE from "three";

import BaseSceneTemplate from "./BaseSceneTemplate";
import {CASCADED_SHADOWS_MAP_BEHAVIOR_ID, GLOBAL_BEHAVIOR_HOST, MOBILE_TOUCH_CONTROLS_BEHAVIOR_ID} from "@stem/editor-oss/EngineRuntime";
import {BehaviorThrottlePriority} from "../../../behaviors/performance/interfaces/IThrottleStrategy";
import {AttachBehaviorCommand} from "@stem/editor-oss/command/Commands";
import {SetPositionCommand} from "@stem/editor-oss/command/SetPositionCommand";
import global from "@stem/editor-oss/global";
import {ExtendedDirectionalLight} from "@stem/editor-oss/light/ExtendedDirectionalLight";
import {getOrCreateDynamicRoot, getOrCreateSceneHelpersRoot} from "@stem/editor-oss/scene/dynamicRoots";
import {findObjectByNameDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";

class EmptySceneTemplate extends BaseSceneTemplate {
    create() {
        const app = global.app!;
        const editor = app.editor!;
        editor.scene.userData = {
            ...editor.scene.userData,
            cesium: {
                ...editor.scene.userData?.cesium,
                enabled: false,
            },
        };

        // [Dynamic] group for global rendering settings
        const dynamicGroup = getOrCreateDynamicRoot(editor.scene);
        getOrCreateSceneHelpersRoot(editor.scene);

        // Ambient Light
        let ambient = findObjectByNameDepthFirst(dynamicGroup, "AmbientLight") as THREE.AmbientLight | null;
        if (!ambient) {
            ambient = new THREE.AmbientLight(0xffffff, 1.0);
            ambient.name = "AmbientLight";
            ambient.userData.isRuntimeOnly = true;
            ambient.userData.isSelectable = false;
            dynamicGroup.add(ambient);
        }
        // Hemisphere Light
        let hemisphere = findObjectByNameDepthFirst(dynamicGroup, "HemisphereLight") as THREE.HemisphereLight | null;
        if (!hemisphere) {
            hemisphere = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
            hemisphere.name = "HemisphereLight";
            hemisphere.userData.isRuntimeOnly = true;
            hemisphere.userData.isSelectable = false;
            dynamicGroup.add(hemisphere);
        }
        // Fog (default: none)
        editor.scene.fog = null;

        // Sync with editor.rendering if available
        const rendering = editor.rendering || {};
        if (rendering.ambient) {
            ambient.color.set(rendering.ambient.color || 0xffffff);
            ambient.intensity = rendering.ambient.intensity ?? 1.0;
        }
        if (rendering.hemisphere) {
            hemisphere.color.set(rendering.hemisphere.skyColor || 0xffffff);
            hemisphere.groundColor.set(rendering.hemisphere.groundColor || 0x444444);
            hemisphere.intensity = rendering.hemisphere.intensity ?? 1.0;
        }
        if (rendering.fog && rendering.fog.type && rendering.fog.type !== "none") {
            if (rendering.fog.type === "linear") {
                editor.scene.fog = new THREE.Fog(
                    rendering.fog.color || 0xaaaaaa,
                    rendering.fog.near ?? 5,
                    rendering.fog.far ?? 150,
                );
            } else if (rendering.fog.type === "exp") {
                editor.scene.fog = new THREE.FogExp2(rendering.fog.color || 0xaaaaaa, rendering.fog.density ?? 0.011);
            }
        }
        // Background
        if (rendering.background && rendering.background.color) {
            editor.scene.background = new THREE.Color(rendering.background.color);
        }
        // ... (cubemap/equirect logic can be added here)
        // Tonemapping/exposure can be set on renderer elsewhere

        // Add default directional light as before (using addObject for this only)
        const dirlight = new ExtendedDirectionalLight(0xffffff, 5);
        dirlight.isUnityStyle = true;
        dirlight.name = "Directional Light";
        dirlight.castShadow = true;
        dirlight.userData.shadow = {
            castShadow: true,
            receiveShadow: false,
        };
        dirlight.position.set(5, 9, 7.5);
        dirlight.rotation.set(THREE.MathUtils.degToRad(85), THREE.MathUtils.degToRad(-25), THREE.MathUtils.degToRad(0));
        dirlight.shadow.radius = 3;
        dirlight.shadow.bias = 0;
        dirlight.shadow.normalBias = 0.1;
        dirlight.shadow.mapSize.x = 2048;
        dirlight.shadow.mapSize.y = 2048;
        dirlight.shadow.camera.left = -100;
        dirlight.shadow.camera.right = 100;
        dirlight.shadow.camera.top = 100;
        dirlight.shadow.camera.bottom = -100;
        // near/far are auto-computed from ortho size in Unity-style mode
        editor.addObject(dirlight);

        void new AttachBehaviorCommand(dirlight, "dayNightCycle", {
            enabled: false,
            throttleConfig: {
                throttlePriority: BehaviorThrottlePriority.CRITICAL,
                enableFrustumCulling: false,
                enableDistanceThrottling: false,
                requiresConsistentUpdates: true,
            },
        }).execute();
        new AttachBehaviorCommand(dirlight, CASCADED_SHADOWS_MAP_BEHAVIOR_ID, {
            attributesData: {},
            enabled: true,
        }).execute();

        editor.execute(new SetPositionCommand(dirlight, new THREE.Vector3(5, 50, 7.5)));

        // Global behaviors host — attach scene-wide behaviors here
        let globalHost = findObjectByNameDepthFirst(editor.scene, GLOBAL_BEHAVIOR_HOST);
        if (!globalHost) {
            globalHost = new THREE.Object3D();
            globalHost.name = GLOBAL_BEHAVIOR_HOST;
            editor.scene.add(globalHost);
        }
        new AttachBehaviorCommand(globalHost, MOBILE_TOUCH_CONTROLS_BEHAVIOR_ID, {
            attributesData: {onlyOnMobile: true},
            enabled: true,
        }).execute();

        if (global.app?.batchedRenderer) {
            editor.scene.add(global.app.batchedRenderer);
        }
    }
}

export default EmptySceneTemplate;
