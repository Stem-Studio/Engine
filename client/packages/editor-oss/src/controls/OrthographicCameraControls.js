
/**
 * Module: OrthographicCameraControls.js
 * Purpose: Contains logic for orthographic camera controls.
 */


import {Vector2} from "three";
/**
 *
 *
 *
 * @param {HTMLElement} domElement DOM
 */
class OrthographicCameraControls {
    constructor(camera, domElement) {
        this.camera = camera;
        this.domElement = domElement;

        this.enabled = false;
        this.isDown = false;
        this.offsetXY = new Vector2();

        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onMouseWheel = this.onMouseWheel.bind(this);
    }

    enable() {
        if (this.enabled) {
            return;
        }

        this.enabled = true;

        this.domElement.addEventListener("mousedown", this.onMouseDown);
        this.domElement.addEventListener("mousemove", this.onMouseMove);
        this.domElement.addEventListener("mouseup", this.onMouseUp);
        this.domElement.addEventListener("mousewheel", this.onMouseWheel);
    }

    disable() {
        if (!this.enabled) {
            return;
        }

        this.enabled = false;

        this.domElement.removeEventListener("mousedown", this.onMouseDown);
        this.domElement.removeEventListener("mousemove", this.onMouseMove);
        this.domElement.removeEventListener("mouseup", this.onMouseUp);
        this.domElement.removeEventListener("mousewheel", this.onMouseWheel);
    }

    onMouseDown(event) {
        this.isDown = true;

        this.offsetXY.set(event.offsetX, event.offsetY);
    }

    onMouseMove(event) {
        if (!this.isDown) {
            return;
        }

        // let camera = this.camera;

        let width = this.domElement.clientWidth;
        let height = this.domElement.clientHeight;

        let dx = (event.offsetX - this.offsetXY.x) * (this.camera.right - this.camera.left) / width;
        let dy = (event.offsetY - this.offsetXY.y) * (this.camera.top - this.camera.bottom) / height;

        this.camera.left -= dx;
        this.camera.right -= dx;
        this.camera.top += dy;
        this.camera.bottom += dy;

        this.camera.updateProjectionMatrix();

        this.offsetXY.set(event.offsetX, event.offsetY);
    }

    onMouseUp() {
        this.isDown = false;
    }

    onMouseWheel(event) {
        const delta = -event.wheelDelta / 1000;

        let camera = this.camera;

        let width = this.domElement.clientWidth;
        let height = this.domElement.clientHeight;

        let pointerX = camera.left + (camera.right - camera.left) * event.offsetX / width;
        let pointerY = camera.top - (camera.top - camera.bottom) * event.offsetY / height;

        camera.left = camera.left - Math.abs(pointerX - camera.left) * delta;
        camera.right = camera.right + Math.abs(camera.right - pointerX) * delta;
        camera.top = camera.top + Math.abs(camera.top - pointerY) * delta;
        camera.bottom = camera.bottom - Math.abs(pointerY - camera.bottom) * delta;

        camera.updateProjectionMatrix();
    }
}

export default OrthographicCameraControls;
