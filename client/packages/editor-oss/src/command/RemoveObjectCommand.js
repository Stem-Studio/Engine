import {t} from "i18next";
import * as THREE from "three";
import {CSS3DObject} from "three/addons/renderers/CSS3DRenderer.js";

import Command from "./Command";
import global from "../global";
import {cloneJsonCompatible} from "../utils/cloneJsonCompatible";
import {traverseObjectDepthFirst} from "../utils/SceneTraverser";

const PLAN_CAD_SCENE_USER_DATA_KEY = "planCad";

function clonePlanCadData(data) {
    return data ? cloneJsonCompatible(data) : null;
}

function removePlanCadDataFromScene(scene) {
    if (!scene?.userData?.[PLAN_CAD_SCENE_USER_DATA_KEY]) return null;
    const oldData = clonePlanCadData(scene.userData[PLAN_CAD_SCENE_USER_DATA_KEY]);
    const nextUserData = {...scene.userData};
    delete nextUserData[PLAN_CAD_SCENE_USER_DATA_KEY];
    scene.userData = nextUserData;
    return oldData;
}

function restorePlanCadDataToScene(scene, data) {
    if (!scene || !data) return;
    scene.userData = {
        ...(scene.userData || {}),
        [PLAN_CAD_SCENE_USER_DATA_KEY]: clonePlanCadData(data),
    };
}
/**
 * RemoveObjectCommand - Removes an object from the scene
 * @author dforrer / https://github.com/dforrer
 * Developed as part of a project at University of Applied Sciences and Arts Northwestern Switzerland (www.fhnw.ch)
 * @param {THREE.Object3D} object - The object to be removed
 * @param {THREE.Object3D} selectedObject - Currently selected object (optional)
 * @constructor
 */
class RemoveObjectCommand extends Command {
    constructor(object, selectedObject) {
        super();
        this.type = "RemoveObjectCommand";
        this.name = t("Remove Object");
        this.editor = global.app.editor;
        this.object = object;
        this.selectedObject = selectedObject;

        this.parent = object !== undefined ? object.parent : undefined;

        if (this.parent) {
            this.index = this.parent.children.indexOf(this.object);
        }

        this.planCadSceneData =
            object?.userData?.isPlanCadRoot && this.editor?.scene?.userData?.[PLAN_CAD_SCENE_USER_DATA_KEY]
                ? clonePlanCadData(this.editor.scene.userData[PLAN_CAD_SCENE_USER_DATA_KEY])
                : null;
    }

    execute() {
        // var scope = this.editor;
        if (this.object === this.editor.selected || this.object === this.selectedObject) {
            this.editor.select(null);
        }

        traverseObjectDepthFirst(this.object, child => {
            if (child instanceof CSS3DObject) {
                this.object.remove(child);
            }
        });

        if (this.object?.userData?.isPlanCadRoot) {
            const removedPlanCadData = removePlanCadDataFromScene(this.editor.scene);
            this.planCadSceneData = this.planCadSceneData || removedPlanCadData;
        }

        this.editor.removeObject(this.object);

        return {
            message: `RemoveObjectCommand: Object removed (${this.object.name})`,
            status: "success",
        };
    }

    undo() {
        // var scope = this.editor;

        restorePlanCadDataToScene(this.editor.scene, this.planCadSceneData);
        this.editor.addObject(this.object, this.parent);

        return {
            message: `RemoveObjectCommand: Object restored (${this.object.name})`,
            status: "success",
        };
    }

    toJSON() {
        var output = Command.prototype.toJSON.call(this);
        output.object = this.object.toJSON();
        output.index = this.index;
        output.parentUuid = this.parent.uuid;
        output.planCadSceneData = this.planCadSceneData;

        return output;
    }

    fromJSON(json) {
        Command.prototype.fromJSON.call(this, json);

        this.parent = this.editor.objectByUuid(json.parentUuid);
        if (this.parent === undefined) {
            this.parent = this.editor.scene;
        }

        this.index = json.index;
        this.planCadSceneData = json.planCadSceneData || null;

        this.object = this.editor.objectByUuid(json.object.object.uuid);
        if (this.object === undefined) {
            var loader = new THREE.ObjectLoader();
            this.object = loader.parse(json.object);
        }
    }
}

export {RemoveObjectCommand};
