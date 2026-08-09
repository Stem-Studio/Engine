import {MOUSE, Vector3} from "three";
import BaseHelper from './BaseHelper';
import {isInputActive} from "../editor/assets/v2/utils/isInputActive";
import global from '../global';

class CameraControlsHelper extends BaseHelper {
    constructor() {
        super();

        this.boundHandleKeyDown = this.handleKeyDown.bind(this);
        this.boundHandleKeyUp = this.handleKeyUp.bind(this);
        this.boundHandleMouseDown = this.handleMouseDown.bind(this);
        this.boundHandleMouseUp = this.handleMouseUp.bind(this);
        this.boundUpdate = this.update.bind(this);
        this.isUpdateSubscribed = false;

        this.speed = 0.2;
        this.speedMultiplier = 3;
    
        this.moveVector = new Vector3();
        this.forwardScratch = new Vector3();
        this.rightScratch = new Vector3();
        this.offsetScratch = new Vector3();
        this.targetOffsetScratch = new Vector3();
        this.targetPositionScratch = new Vector3();
        this.prevTargetDistance = 0;
        this.isLookingAround = false;
        this.currentSpeed = this.speed;
        this.moveState = {
            forward: 0,
            backward: 0,
            left: 0,
            right: 0,
            up: 0,
            down: 0,
        };
    }

    getEditorCamera() {
        return global.app.editor?.camera;
    }

    getEditorOrbitControls() {
        // TODO: use dependency injection
        return global.app.editor?.controls?.current?.controls;
    }

    updateMoveVector() {
        this.moveVector.x = -this.moveState.left + this.moveState.right;
        this.moveVector.y = -this.moveState.down + this.moveState.up;
        this.moveVector.z = -this.moveState.backward + this.moveState.forward;
        this.moveVector.multiplyScalar(this.currentSpeed);
    }

    handleKeyDown(event) {
        if (isInputActive()) return;
        if (event.ctrlKey || event.metaKey) return;

        switch (event.code) {
            case "ShiftLeft":
            case "ShiftRight":
                this.currentSpeed = this.speed * this.speedMultiplier;
                break;
            case "KeyW":
                this.moveState.forward = 1;
                this.startMovementUpdates();
                break;
            case "KeyS":
                this.moveState.backward = 1;
                this.startMovementUpdates();
                break;
            case "KeyA":
                this.moveState.left = 1;
                this.startMovementUpdates();
                break;
            case "KeyD":
                this.moveState.right = 1;
                this.startMovementUpdates();
                break;
            case "KeyQ":
                this.moveState.down = 1;
                this.startMovementUpdates();
                break;
            case "KeyE":
                this.moveState.up = 1;
                this.startMovementUpdates();
                break;
        }
    }
    handleKeyUp(event) {
        switch (event.code) {
            case "KeyW":
                this.moveState.forward = 0;
                break;
            case "KeyS":
                this.moveState.backward = 0;
                break;
            case "KeyA":
                this.moveState.left = 0;
                break;
            case "KeyD":
                this.moveState.right = 0;
                break;
            case "KeyQ":
                this.moveState.down = 0;
                break;
            case "KeyE":
                this.moveState.up = 0;
                break;
            case "ShiftLeft":
			case 'ShiftRight':
                this.currentSpeed = this.speed;
                break;
        }
        if (!this.hasMoveInput()) {
            this.stopMovementUpdates();
        }
    }
    handleMouseDown(event) {
        const orbitControls = this.getEditorOrbitControls();
        if (event.button === MOUSE.LEFT && !event.ctrlKey && orbitControls?.state === MOUSE.ROTATE) {
            this.isLookingAround = true;

            const camera = this.getEditorCamera();

            if (orbitControls && camera) {
                const forward = this.forwardScratch;
                camera.getWorldDirection(forward).normalize();
                const newTargetPosition = this.targetPositionScratch.copy(camera.position).add(forward);

                this.prevTargetDistance = orbitControls.target.distanceTo(camera.position);
                orbitControls.target.copy(newTargetPosition);
            }
        }
    }

    handleMouseUp(event) {
        if (event.button === MOUSE.LEFT) {
            this.isLookingAround = false;

            const orbitControls = this.getEditorOrbitControls();
            
            const camera = this.getEditorCamera();

            if (orbitControls && camera && this.prevTargetDistance > 0) {
                const forward = this.forwardScratch;
                camera.getWorldDirection(forward).normalize();
                const targetPosition = this.targetPositionScratch.copy(camera.position)
                    .addScaledVector(forward, this.prevTargetDistance);
                
                orbitControls.target.copy(targetPosition);
            }
            this.prevTargetDistance = 0;
        }
    }
    start() {
        document.addEventListener("keydown", this.boundHandleKeyDown);
        document.addEventListener("keyup", this.boundHandleKeyUp);
        document.addEventListener("mousedown", this.boundHandleMouseDown);
        document.addEventListener("mouseup", this.boundHandleMouseUp);
        this.update();
    }

    stop() {
        this.stopMovementUpdates();
        document.removeEventListener("keydown", this.boundHandleKeyDown);
        document.removeEventListener("keyup", this.boundHandleKeyUp);
        document.removeEventListener("mousedown", this.boundHandleMouseDown);
        document.removeEventListener("mouseup", this.boundHandleMouseUp);
    }

    hasMoveInput() {
        return (
            this.moveState.forward ||
            this.moveState.backward ||
            this.moveState.left ||
            this.moveState.right ||
            this.moveState.up ||
            this.moveState.down
        ) !== 0;
    }

    startMovementUpdates() {
        if (this.isUpdateSubscribed) {
            return;
        }
        this.isUpdateSubscribed = true;
        global.app.on(`animate.${this.id}`, this.boundUpdate);
    }

    stopMovementUpdates() {
        if (!this.isUpdateSubscribed) {
            return;
        }
        this.isUpdateSubscribed = false;
        global.app.on(`animate.${this.id}`, null);
    }

    update() {
        const camera = this.getEditorCamera();
        if (!camera) {
            return;
        }
        
        this.updateMoveVector();

        if (this.moveVector.lengthSq() === 0) {
            return;
        }

        const orbitControls = this.getEditorOrbitControls();

        if (!orbitControls) {
            return;
        }

        const forward = this.forwardScratch;
        camera.getWorldDirection(forward).normalize();
        const right = this.rightScratch;
        right.crossVectors(forward, camera.up).normalize();
        const up = camera.up;

        const offset = this.offsetScratch.set(0, 0, 0);
        offset.addScaledVector(forward, this.moveVector.z);
        offset.addScaledVector(right, this.moveVector.x);
        offset.addScaledVector(up, this.moveVector.y);

        camera.position.add(offset);

        if (this.isLookingAround) {
            // offset the target distance when moving forward or backward
            const forwardMoveDistance = this.moveVector.z;
            this.prevTargetDistance -= forwardMoveDistance;

            const newTargetPosition = this.targetPositionScratch.copy(camera.position).add(forward);
            orbitControls.target.copy(newTargetPosition);
            return;
        }

        // add only right and up direction to target
        const targetOffset = this.targetOffsetScratch.set(0, 0, 0);
        targetOffset.addScaledVector(right, this.moveVector.x);
        targetOffset.addScaledVector(up, this.moveVector.y);

        orbitControls.target.add(targetOffset);

        // if targetOffset is behind the camera, move the target to the camera position and add the offset
        const targetDistance = orbitControls.target.distanceTo(camera.position);
        const minDistance = this.currentSpeed;
        if (targetDistance < minDistance) {
            orbitControls.target.addScaledVector(forward, this.moveVector.z);
        }

        orbitControls.update();
    }

}

export default CameraControlsHelper;
