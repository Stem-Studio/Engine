
/**
 * Module: ControlsManager.js
 * Purpose: Contains logic for controls manager.
 */


import {Object3D, Vector3} from "three";
import BaseControls from "./BaseControls";
import EditorControls from "./EditorControls";
import FirstPersonControls from "./FirstPersonControls";
import FreeControls from "./FreeControls";
import global from "@web-shared/global";

const Controls = {
    EditorControls,
    FreeControls,
    FirstPersonControls,
};

/**
 *
 * @author tengge1 / https://github.com/tengge1
 */
class ControlsManager extends BaseControls {
    constructor(camera, domElement) {
        super(camera, domElement);

        this.handleUpdate = this.handleUpdate.bind(this);
        this.handleEnd = this.handleEnd.bind(this);
        this.boundUpdate = this.update.bind(this);
        this.boundGPUPick = this.onGPUPick.bind(this);

        const mode = global.app.storage.controlMode;
        this.changeMode(mode);

        this.lastControl = this.current;

        this.lastCamera = new Object3D();

        global.app.on(`animate.${this.id}`, this.boundUpdate);
        global.app.on(`gpuPick.${this.id}`, this.boundGPUPick);
    }

    // CHECK: do we need to save the camera state in localStorage?
    // It seems like we can just rely on the app's camera state and not persist it across sessions.
    // Let's keep it for now, but we might want to remove this if it's not necessary.
    saveCamera() {
        const camera = global.app.editor.camera;
        const controls = this.current?.controls;
        const target = controls?.target || new Vector3(0, 0, 0);
        const sceneId = global.app.editor.sceneID;

        let allData;
        try {
            allData = JSON.parse(localStorage.getItem("savedCameras") || "{}");
        } catch {
            allData = {};
        }

        allData[sceneId] = {
            position: camera.position.toArray(),
            target: target.toArray(),
            savedAt: Date.now(),
        };

        if (this._writeSavedCameras(allData)) {
            console.log(`Camera saved for scene ${sceneId}:`, allData[sceneId]);
            return;
        }

        // localStorage is full (commonly from a large autoSaveData blob). Prune
        // savedCameras to the most recent entries and retry once. This must
        // NEVER rethrow: handlePlay() calls saveCamera(), so an uncaught
        // QuotaExceededError silently breaks the Play button.
        try {
            const recent = Object.entries(allData)
                .sort((a, b) => (b[1]?.savedAt || 0) - (a[1]?.savedAt || 0))
                .slice(0, 25);
            const pruned = Object.fromEntries(recent);
            pruned[sceneId] = allData[sceneId];
            if (this._writeSavedCameras(pruned)) return;
        } catch {
            /* fall through to warn */
        }
        console.warn("ControlsManager.saveCamera: localStorage full; skipping camera save");
    }

    _writeSavedCameras(data) {
        try {
            localStorage.setItem("savedCameras", JSON.stringify(data));
            return true;
        } catch {
            return false;
        }
    }

    initCameraPosition() {
        const camera = global.app.editor.camera;
        // Delete incorrect characterOptions from global camera if still present
        if (camera.userData?.characterOptions) {
            delete camera.userData.characterOptions;
        }
        if (camera.userData?.cameraData.characterOptions) {
            delete camera.userData?.cameraData.characterOptions;
        }
        const controls = this.current?.controls;

        // Reset camera orientation to default Y-up (XZ horizontal, Y vertical)
        camera.up.set(0, 1, 0);
        camera.rotation.set(0, 0, 0);
        camera.quaternion.identity();
        camera.position.set(0, 10, 25);

        if (controls) {
            controls.target.set(0, 0, 0);
            controls.update();
        }
    }

    loadCamera() {
        const camera = global.app.editor.camera;
        const controls = this.current?.controls;
        const sceneId = global.app.editor.sceneID;
        const allData = JSON.parse(localStorage.getItem("savedCameras") || "{}");
        const data = allData[sceneId];

        // Always enforce Y-up orientation when loading camera
        camera.up.set(0, 1, 0);

        if (data) {
            camera.position.fromArray(data.position);

            if (controls && data.target) {
                controls.target.fromArray(data.target);
                controls.update();
            }

            console.log(`Camera loaded for scene ${sceneId}:`, data);
        } else {
            console.log(`No saved camera for scene ${sceneId}`);
        }
    }

    
    changeMode(modeName) {
        if (!Controls[modeName]) {
            console.warn(`ControlsManager: ${modeName} is not defined.`);
            return;
        }
        if (this.current?.constructor?.name === modeName) {
            return;
        }
        this.changeControl(new Controls[modeName](this.camera, this.domElement));
    }

    changeControl(control) {
        if (!control || this.current === control) {
            return;
        }

        if (this.current) {
            let camera = global.app.editor.camera;
            const previous = this.current;
            const preservePrevious = control instanceof FirstPersonControls && !(previous instanceof FirstPersonControls);
            const staleLastControl = previous instanceof FirstPersonControls && this.lastControl !== control
                ? this.lastControl
                : null;

            if (preservePrevious) {
                this.lastControl = previous;
                this.lastCamera.position.copy(camera.position);
                this.lastCamera.rotation.copy(camera.rotation);
                this.lastCamera.scale.copy(camera.scale);
            }

            previous.disable();
            previous.on(`update.${this.id}`, null);
            previous.on(`end.${this.id}`, null);
            this.call("change", this, false, previous.constructor.name, previous); // enabled, controlName, control

            if (!preservePrevious) {
                previous.dispose();
            }
            if (staleLastControl) {
                staleLastControl.dispose();
            }
        }

        this.current = control;
        this.current.enable();
        this.current.on(`update.${this.id}`, this.handleUpdate);
        this.current.on(`end.${this.id}`, this.handleEnd);
        if (!(this.current instanceof FirstPersonControls)) {
            this.lastControl = this.current;
        }
        this.call("change", this, true, this.current.constructor.name, this.current);
    }

    enable() {
        this.enabled = true;
        if (this.current) this.current.enable();
    }

    disable() {
        this.enabled = false;
        if (this.current) this.current.disable();
    }

    focus(target) {
        if (this.current) this.current.focus(target);
    }

    update(clock, deltaTime) {
        if (!this.current) {
            return false;
        }

        const changed = this.current.update(clock, deltaTime) === true;
        if (changed) {
            this.handleUpdate();
        }

        return changed;
    }

    setPickPosition(position) {
        if (this.current) this.current.setPickPosition(position);
    }

    onGPUPick(obj) {
        if (obj.point) {
            this.setPickPosition(obj.point);
        }
    }

    handleUpdate() {
        global.app.call("cameraChanged", this, global.app.editor.camera);
    }

    
    handleEnd() {
        this.changeControl(this.lastControl);

        let camera = global.app.editor.camera;

        camera.position.copy(this.lastCamera.position);
        camera.rotation.copy(this.lastCamera.rotation);
        camera.scale.copy(this.lastCamera.scale);
    }

    dispose() {
        global.app.on(`animate.${this.id}`, null);
        global.app.on(`gpuPick.${this.id}`, null);
        const controls = new Set([this.current, this.lastControl]);
        controls.forEach(control => {
            control?.dispose();
        });
        this.current = null;
        this.lastControl = null;
    }
}

export default ControlsManager;
