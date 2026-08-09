
/**
 * Module: GPUPickEvent.js
 * Purpose: Contains logic for gpupick event.
 */

import {Line3, Plane, Raycaster, Vector2, Vector3} from "three";

import BaseEvent from "./BaseEvent";
import {QualityManager} from "../core/quality/QualityManager";
import global from "../global";
import {resolveSelectionTargetFromPickHit} from "./picking/pickTargetUtils";
import {DetectDevice} from "../utils/DetectDevice";
import MeshUtils from "../utils/MeshUtils";
import {getNonSelectableReason} from "../utils/SelectionUtils";

let gpuPickerClassPromise = null;

function loadGPUPickerClass() {
    if (!gpuPickerClassPromise) {
        gpuPickerClassPromise = import("../assets/js/gpupicker/gpupicker").then(({GPUPicker}) => GPUPicker);
    }
    return gpuPickerClassPromise;
}

class GPUPickEvent extends BaseEvent {
    constructor() {
        super();
        this.isIn = false;
        this.offsetX = 0;
        this.offsetY = 0;
        this.waitTime = 10;
        this.oldTime = 0;

        this.selectMode = "whole";
        this.mouse = new Vector2();
        this.raycaster = new Raycaster();
        this.world = new Vector3();
        this.nearPosition = new Vector3();
        this.farPosition = new Vector3();
        this.line = new Line3(this.nearPosition, this.farPosition);
        this.plane = new Plane().setFromNormalAndCoplanarPoint(new Vector3(0, 1, 0), new Vector3());
        this.intersections = [];
        this.gpuPicker = null;
        this.pickingInProgress = false;
        this.needsPick = true;
    }

    start() {
        global.app.on(`mousemove.${this.id}`, this.onMouseMove);
        global.app.on(`afterRender.${this.id}`, this.onAfterRender);
        global.app.on(`resize.${this.id}`, this.onResize);
        global.app.on(`storageChanged.${this.id}`, this.onStorageChanged);
        global.app.on(`cameraChanged.${this.id}`, this.markPickDirty);
        global.app.on(`viewChanged.${this.id}`, this.markPickDirty);
        global.app.on(`objectChanged.${this.id}`, this.markPickDirty);
        global.app.on(`objectUpdated.${this.id}`, this.markPickDirty);
        global.app.on(`sceneGraphChanged.${this.id}`, this.markPickDirty);

        this.selectMode = global.app.storage.selectMode;
    }

    stop() {
        global.app.on(`mousemove.${this.id}`, null);
        global.app.on(`afterRender.${this.id}`, null);
        global.app.on(`resize.${this.id}`, null);
        global.app.on(`storageChanged.${this.id}`, null);
        global.app.on(`cameraChanged.${this.id}`, null);
        global.app.on(`viewChanged.${this.id}`, null);
        global.app.on(`objectChanged.${this.id}`, null);
        global.app.on(`objectUpdated.${this.id}`, null);
        global.app.on(`sceneGraphChanged.${this.id}`, null);

        this.selectMode = "whole";
        this.needsPick = true;
        this.disposePicker();
    }

    reset() {}

    onMouseMove = event => {
        if (event.target !== global.app.editor?.renderer.domElement) {

            this.isIn = false;
            this.needsPick = true;
            global.app.call(`gpuPick`, this, {
                object: null,
                point: null,
                distance: 0,
            });
            return;
        }
        if (!this.isIn || event.offsetX !== this.offsetX || event.offsetY !== this.offsetY) {
            this.needsPick = true;
        }
        this.isIn = true;
        this.offsetX = event.offsetX;
        this.offsetY = event.offsetY;
    };

    
    onAfterRender = async () => {
        if (!this.isIn || global.app.editor.gpuPickNum === 0 || this.pickingInProgress) {
            return;
        }
        if (!this.needsPick) {
            return;
        }

        const now = performance.now();
        if (now - this.oldTime < this.waitTime) {
            return;
        }
        this.oldTime = now;
        this.needsPick = false;

        const {scene, renderer} = global.app.editor;
        const camera =
            global.app.editor.view === "perspective" ? global.app.editor.camera : global.app.editor.orthCamera;

        const width = renderer.domElement.clientWidth || renderer.domElement.width;
        const height = renderer.domElement.clientHeight || renderer.domElement.height;

        this.mouse.set(
            this.offsetX / width * 2 - 1,
            -this.offsetY / height * 2 + 1,
        );
        this.raycaster.setFromCamera(this.mouse, camera);

        await this.ensurePicker(renderer, scene, camera);

        const intersections = this.intersections;
        intersections.length = 0;
        if (this.gpuPicker) {
            const qualityManager = QualityManager.getInstance();
            const pixelRatio =
                Math.max(
                    1,
                    Math.min(
                        3,
                        (window.devicePixelRatio || 1) *
                            (qualityManager.getCurrentSettings().rendering.pixelRatio || 1),
                    ),
                ) * (DetectDevice.isMobile() ? 0.75 : 1);

            this.pickingInProgress = true;
            try {
                const objId = await this.gpuPicker._doPick(this.offsetX * pixelRatio, this.offsetY * pixelRatio, undefined);
                const pickedObject = objId ? global.app.editor.objectById(objId) : null;
                if (pickedObject) {
                    this.raycaster.intersectObject(pickedObject, true, intersections);
                }
            } catch {
                intersections.length = 0;
                this.raycaster.intersectObjects(scene.children, true, intersections);
            } finally {
                this.pickingInProgress = false;
            }
        } else {
            this.raycaster.intersectObjects(scene.children, true, intersections);
        }

        const hit = intersections.find(intersection => {
            const target = resolveSelectionTargetFromPickHit(intersection?.object);
            return !getNonSelectableReason(target, global.app);
        }) || null;

        let selected = resolveSelectionTargetFromPickHit(hit?.object) || null;
        let cameraDepth = 0;

        if (hit?.point) {
            this.world.copy(hit.point);
            cameraDepth = hit.distance;
        } else {
            this.nearPosition.copy(this.raycaster.ray.origin);
            this.farPosition.copy(this.raycaster.ray.direction).multiplyScalar(camera.far).add(this.nearPosition);
            this.line.set(this.nearPosition, this.farPosition);
            if (
                !this.raycaster.ray.intersectPlane(this.plane, this.world) &&
                !this.plane.intersectLine(this.line, this.world)
            ) {
                this.world.copy(this.farPosition);
            }
            cameraDepth = this.world.distanceTo(camera.position);
        }

        if (selected && this.selectMode === "whole") {

            selected = MeshUtils.partToMesh(selected);
        }

        global.app.call(`gpuPick`, this, {
            object: selected,
            point: this.world,
            distance: cameraDepth,
        });
    };

    markPickDirty = () => {
        this.needsPick = true;
    };

    onResize = () => {
        this.markPickDirty();
    };

    onStorageChanged = (name, value) => {
        if (name === "selectMode") {
            this.selectMode = value;
            this.markPickDirty();
        }
    };

    async ensurePicker(renderer, scene, camera) {
        if (this.gpuPicker) {
            const needsRecreate =
                this.gpuPicker.renderer !== renderer || this.gpuPicker.scene !== scene || this.gpuPicker.camera !== camera;
            if (!needsRecreate) return;
            this.disposePicker();
        }

        if (!renderer?.isWebGPURenderer) return;

        try {
            const GPUPicker = await loadGPUPickerClass();
            this.gpuPicker = new GPUPicker(renderer, scene, camera, 1);
        } catch {
            this.gpuPicker = null;
        }
    }

    disposePicker() {
        try {
            this.gpuPicker?.dispose();
        } catch {
            // ignore dispose errors
        }
        this.gpuPicker = null;
        this.pickingInProgress = false;
    }
}

export default GPUPickEvent;
