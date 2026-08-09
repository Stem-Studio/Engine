
/**
 * Module: FreeControls.js
 * Purpose: Contains logic for free controls.
 */


import BaseControls from "./BaseControls";
import {OrbitControls} from "./OrbitControls";

// import { TWEEN } from '@web-shared/third_party';

/**
 *
 * @author tengge1 / https://github.com/tengge1
 */
class FreeControls extends BaseControls {
    constructor(camera, domElement) {
        super(camera, domElement);

        this.controls = new OrbitControls(camera, domElement);

        this.controls.enableZoom = true;
        this.controls.maxPolarAngle = 180 * Math.PI / 180; // 180°

        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;

        this.controls.panSpeed = 1.6;
    }

    enable() {
        this.enabled = true;
        this.controls.enabled = true;
    }

    disable() {
        this.enabled = false;
        this.controls.enabled = false;
    }

    focus() {
         
    }

    update() {
        if (this.controls.maxDistance !== this.camera.far) {
            this.controls.maxDistance = this.camera.far;
        }

        return this.controls.update() === true;
    }

    dispose() {
        // Safe disposal with guard to prevent runtime errors
        if (this.controls) {
            try {
                if (typeof this.controls.dispose === "function") {
                    this.controls.dispose();
                }
            } catch (e) {
                console.warn("FreeControls: Error disposing controls", e);
            }
            // Clear controls reference to prevent dangling references
            this.controls = null;
        }

        this.camera = null;
        this.domElement = null;
    }
}

export default FreeControls;
