import * as THREE from "three";

import global from "../global";
import { showToast, createClickableItems } from "@stem/editor-oss/showToast";
import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";

type ShadowFogSettings = {
    userData?: {
        shadow?: {
            castShadow?: boolean;
            receiveShadow?: boolean;
        };
        fog?: {
            receiveFog?: boolean;
        };
    };
};

type FogMaterial = THREE.Material & { fog?: boolean };

/**
 * Collects all lights in the given scene that cast shadows, optionally including an additional light.
 * If more than 4 shadow-casting lights are found, shows a warning toast to the user.
 *
 * @param {THREE.Scene} scene - The scene to search for shadow-casting lights.
 * @param {THREE.Light} [additionalLight] - An optional light to include if it casts shadows and is not already in the scene.
 * @returns {THREE.Light[]} An array of lights that cast shadows.
 * @sideeffect Shows a warning toast if more than 4 shadow-casting lights are found.
 */
export const checkShadowCastingLights = (scene: THREE.Scene, additionalLight?: THREE.Light): THREE.Light[] => {
    const shadowLights: THREE.Light[] = [];

    traverseObjectDepthFirst(scene, (object) => {
        if (object instanceof THREE.Light && object.castShadow) {
            shadowLights.push(object);
        }
    });

    if (additionalLight && additionalLight.castShadow) {
        if (!shadowLights.some(l => l.uuid === additionalLight.uuid)) {
            shadowLights.push(additionalLight);
        }
    }

    if (shadowLights.length > 4) {
        const disabledLights = shadowLights.splice(4);
        disabledLights.forEach((light) => applyCastShadow(light, false, false));

        showToast({
            type: "info",
            title: "Shadow Casters Limit",
            body: `Performance and stability limit of 4 shadow lights reached. ${disabledLights.length} lights were automatically disabled.`,
        });
    }

    if (shadowLights.length > 4) {
        const clickableItems = createClickableItems(
            shadowLights,
            (light) => light.name || "Unnamed Light",
            (light) => {
                const editor = global.app?.editor;
                if (editor) {
                    editor.selectByUuid(light.uuid);
                }
            },
            () => "💡",
            (light) => `Click to select "${light.name || "Unnamed Light"}"`,
        );

        showToast({
            type: "warning",
            title: "Performance Warning: Too Many Shadow Casters",
            body: `You have ${shadowLights.length} lights casting shadows. Having more than 4 shadow-casting lights can significantly impact performance and stability!`,
            clickableItems: clickableItems,
        });
    }

    return shadowLights;
};

/**
 * Logs a report to the console about the number and details of shadow-casting lights.
 *
 * If the number of shadow-casting lights is within the recommended limit (4 or fewer),
 * an informational message is logged. If there are more than 4, a warning group is
 * logged with details about each light.
 *
 * @param {THREE.Light[]} shadowLights - Array of THREE.Light objects that are casting shadows.
 * @returns {void}
 */
export const logShadowCastersReport = (shadowLights: THREE.Light[]) => {
    if (shadowLights.length <= 4) {
        console.info("[ShadowUtils] Shadow casting lights count is within limits. Scene is optimized!");
        return;
    }

    console.group("[ShadowUtils] Shadow Casters Report");
    console.warn(`Found ${shadowLights.length} lights casting shadows. Recommended limit is 4.`);
    shadowLights.forEach(light => {
        console.warn(`- ${light.name || "Unnamed Light"} (UUID: ${light.uuid}) type: ${light.type}`);
    });
    console.groupEnd();
};

export const updateMaterial = (material: THREE.Material | THREE.Material[]) => {
    if (Array.isArray(material)) {
        material.forEach(n => {
            n.needsUpdate = true;
        });
    } else {
        material.needsUpdate = true;
    }
};

export const applyReceiveShadow = (obj: THREE.Object3D, value: boolean, saveState: boolean) => {
    const _applyReceiveShadow = (target: THREE.Object3D) => {
        if (target instanceof THREE.Mesh || target instanceof THREE.Group) {
            target.receiveShadow = value;
            if (target instanceof THREE.Mesh) {
                updateMaterial(target.material); // Assuming this is necessary for your setup
            }
        }
        if (saveState && (target.userData.Server || target instanceof THREE.Scene)) {
            target.userData.shadow = target.userData.shadow ? target.userData.shadow : {};
            target.userData.shadow.receiveShadow = value;
        }
    };

    if (obj instanceof THREE.Group || obj instanceof THREE.Scene) {
        traverseObjectDepthFirst(obj, _applyReceiveShadow);
    } else {
        _applyReceiveShadow(obj);
    }
};

export const applyCastShadow = (obj: THREE.Object3D, value: boolean, saveState: boolean) => {
    const _applyCastShadow = (target: THREE.Object3D) => {
        if (!(target instanceof THREE.AmbientLight) && !(target instanceof THREE.HemisphereLight && !(target instanceof THREE.RectAreaLight))) {
            target.castShadow = value;
            if (target instanceof THREE.Mesh) {
                updateMaterial(target.material); // Assuming this is necessary for your setup
            }
            //store setting in the model
            if (saveState && (target.userData.Server || target instanceof THREE.Scene)) {
                target.userData.shadow = target.userData.shadow ? target.userData.shadow : {};
                target.userData.shadow.castShadow = value;
            }
        }
    };

    if (obj instanceof THREE.Group || obj instanceof THREE.Scene) {
        traverseObjectDepthFirst(obj, _applyCastShadow);
    } else {
        _applyCastShadow(obj);
    }
};

export const applyReceiveFog = (obj: THREE.Object3D, value: boolean, saveState: boolean) => {
    const _applyReceiveFog = (target: THREE.Object3D) => {
        if (target instanceof THREE.Mesh) {
            const materials = Array.isArray(target.material) ? target.material : [target.material];
            materials.forEach((material: THREE.Material) => {
                const fogMaterial = material as FogMaterial;
                fogMaterial.fog = value;
                fogMaterial.needsUpdate = true;
            });
        }

        if (saveState && (target.userData.Server || target instanceof THREE.Scene)) {
            const userData = target.userData as { fog?: { receiveFog?: boolean } };
            userData.fog = userData.fog ? userData.fog : {};
            userData.fog.receiveFog = value;
        }
    };

    if (obj instanceof THREE.Group || obj instanceof THREE.Scene) {
        traverseObjectDepthFirst(obj, _applyReceiveFog);
    } else {
        _applyReceiveFog(obj);
    }
};

export const applyFogSettings = (obj: THREE.Object3D, json: ShadowFogSettings) => {
    if (json.userData?.fog?.receiveFog !== undefined) {
        applyReceiveFog(obj, json.userData.fog.receiveFog, false);
    }
};

export const applyShadowSettings = (obj: THREE.Object3D, json: ShadowFogSettings) => {
    if (json.userData?.shadow) {
        if (json.userData.shadow.castShadow !== undefined) {
            applyCastShadow(obj, json.userData.shadow.castShadow, false);
        }
        if (json.userData.shadow.receiveShadow !== undefined) {
            applyReceiveShadow(obj, json.userData.shadow.receiveShadow, false);
        }
    }
};

export const isReceiveShadowEnabled = (obj: THREE.Object3D): boolean => {
    return obj.receiveShadow;
};

export const isCastShadowEnabled = (obj: THREE.Object3D): boolean => {
    return obj.castShadow;
};

export const isReceiveFogEnabled = (obj: THREE.Object3D): boolean => {
    if (obj instanceof THREE.Mesh) {
        const material = (Array.isArray(obj.material) ? obj.material[0] : obj.material) as FogMaterial;
        return material.fog ?? true;
    }

    let fogEnabled = true;
    let foundMesh = false;
    traverseObjectDepthFirst(obj, target => {
        if (!foundMesh && target instanceof THREE.Mesh) {
            const material = (Array.isArray(target.material) ? target.material[0] : target.material) as FogMaterial;
            fogEnabled = material.fog ?? true;
            foundMesh = true;
        }
    });

    return fogEnabled;
};

const ShadowUtils = {
    checkShadowCastingLights,
    applyShadowSettings,
    updateMaterial,
    applyReceiveShadow,
    applyCastShadow,
    applyReceiveFog,
    applyFogSettings,
    isReceiveShadowEnabled,
    isCastShadowEnabled,
    isReceiveFogEnabled,
    logShadowCastersReport,
};

export default ShadowUtils;
