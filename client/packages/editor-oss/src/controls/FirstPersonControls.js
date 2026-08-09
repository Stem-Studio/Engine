
/**
 * Module: FirstPersonControls.js
 * Purpose: Contains logic for first person controls.
 */


import {Quaternion, Vector3} from "three";
import BaseControls from "./BaseControls";

const STATE = {
    Forward: 1,
    Backward: 2,
    Left: 3,
    Right: 4,
};

const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, -1);
const RIGHT = new Vector3(1, 0, 0);

/**
 *
 * @author tengge1 / https://github.com/tengge1
 */
class FirstPersonControls extends BaseControls {
    constructor(camera, domElement) {
        super(camera, domElement);

        this.height = camera.position.y;
        camera.lookAt(new Vector3(0, this.height, 0));

        this.panSpeed = 0.1;
        this.rotationSpeed = 0.1 * Math.PI / 180;

        this.state = null;

        this.forward = new Vector3();
        this.right = new Vector3();

        this.onKeyDown = this.onKeyDown.bind(this);
        this.onKeyUp = this.onKeyUp.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onPointerlockChange = this.onPointerlockChange.bind(this);

        this.isLocked = true;
        this.domElement.requestPointerLock();

        document.addEventListener("keydown", this.onKeyDown, false);
        document.addEventListener("keyup", this.onKeyUp, false);
        document.addEventListener("mousemove", this.onMouseMove, false);
        document.addEventListener("pointerlockchange", this.onPointerlockChange, false);
    }

    onKeyDown(event) {
        switch (event.keyCode) {
            case 38: // up
            case 87: // w
                this.state = STATE.Forward;
                break;
            case 40: // down
            case 83: // s
                this.state = STATE.Backward;
                break;
            case 37: // left
            case 65: // a
                this.state = STATE.Left;
                break;
            case 39: // right
            case 68: // d
                this.state = STATE.Right;
                break;
        }
    }

    onKeyUp() {
        this.state = null;
    }

    onMouseMove(event) {
        if (!this.isLocked) {
            return;
        }

        if (!this.quaternion1) {
            this.quaternion1 = new Quaternion();
        }

        if (!this.quaternion2) {
            this.quaternion2 = new Quaternion();
        }

        let camera = this.camera;

        this.forward.copy(FORWARD).applyQuaternion(camera.quaternion).normalize();
        this.right.copy(RIGHT).applyQuaternion(camera.quaternion).normalize();

        const dx = -event.movementX * this.rotationSpeed;
        const dy = -event.movementY * this.rotationSpeed;

        this.quaternion1.setFromAxisAngle(UP, dx);
        this.quaternion2.setFromAxisAngle(this.right, dy);

        this.forward.applyQuaternion(this.quaternion1).applyQuaternion(this.quaternion2).add(camera.position);

        camera.lookAt(this.forward);
        this.call("update", this);
    }

    onPointerlockChange() {
        if (document.pointerLockElement === this.domElement) {
            this.isLocked = true;
        } else {
            this.isLocked = false;

            this.call("end", this);
        }
    }

    update() {
        if (!this.state) {
            return false;
        }

        let camera = this.camera;

        this.forward.copy(FORWARD).applyQuaternion(camera.quaternion).projectOnPlane(UP).normalize();
        this.right.copy(RIGHT).applyQuaternion(camera.quaternion).projectOnPlane(UP).normalize();

        this.forward.multiplyScalar(this.panSpeed);
        this.right.multiplyScalar(this.panSpeed);

        if (this.state === STATE.Forward) {
            camera.position.add(this.forward);
        } else if (this.state === STATE.Backward) {
            camera.position.sub(this.forward);
        } else if (this.state === STATE.Left) {
            camera.position.sub(this.right);
        } else if (this.state === STATE.Right) {
            camera.position.add(this.right);
        }

        return true;
    }

    dispose() {
        this.isLocked = false;
        document.exitPointerLock();

        document.removeEventListener("keydown", this.onKeyDown);
        document.removeEventListener("keyup", this.onKeyUp);
        document.removeEventListener("mousemove", this.onMouseMove);
        document.removeEventListener("pointerlockchange", this.onPointerlockChange);
        this.camera = null;
        this.domElement = null;
    }
}

export default FirstPersonControls;
