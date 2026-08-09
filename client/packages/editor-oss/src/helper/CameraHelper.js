
/**
 * Module: CameraHelper.js
 * Purpose: Contains logic for camera helper.
 */


import {CameraHelper as ThreeCameraHelper} from "three";
import BaseHelper from "./BaseHelper";
import global from "../global";

class CameraHelper extends BaseHelper {
    constructor() {
        super();
    }

    start() {
        global.app.on(`storageChanged.${this.id}`, this.onStorageChanged.bind(this));
        this.update();
    }

    stop() {
        global.app.on(`storageChanged.${this.id}`, null);

        if (this.helper) {
            var scene = global.app.editor.sceneHelpers;
            scene.remove(this.helper);
            this.helper.dispose();
            delete this.helper;
        }
    }

    update() {
        var showCamera = global.app.storage.showCamera;

        if (!this.helper) {
            this.helper = new ThreeCameraHelper(global.app.editor.camera ?? global.app.camera);
        }

        var scene = global.app.editor.sceneHelpers;

        if (showCamera && this.helper.parent !== scene) {
            scene.add(this.helper);
        } else if (!showCamera && this.helper.parent === scene) {
            scene.remove(this.helper);
        }
    }

    onStorageChanged(key) {
        if (key === "showCamera") {
            this.update();
        }
    }
}

export default CameraHelper;
