import {PerspectiveCamera, Quaternion, Vector3} from "three";
import type GameManager from "../behaviors/game/GameManager";
import type {OrbitControls} from "../controls/OrbitControls";

type OrbitControlsClass = new (camera: PerspectiveCamera, domElement: HTMLElement) => OrbitControls;

let orbitControlsClassPromise: Promise<OrbitControlsClass> | null = null;

function loadOrbitControlsClass(): Promise<OrbitControlsClass> {
    if (!orbitControlsClassPromise) {
        orbitControlsClassPromise = import("../controls/OrbitControls").then(
            module => module.OrbitControls as OrbitControlsClass,
        );
    }
    return orbitControlsClassPromise;
}

type CameraSnapshot = {
    position: Vector3;
    quaternion: Quaternion;
};

export class PlaymodeDebugCamera {
    private camera: PerspectiveCamera;
    private domElement: HTMLElement;
    private controls: OrbitControls | null = null;
    private cameraPoseBeforeAttach: CameraSnapshot | null = null;
    private game: GameManager | null = null;
    private cameraControlWasPaused = false;
    private _active = false;
    private attachToken = 0;

    constructor(camera: PerspectiveCamera, domElement: HTMLElement) {
        this.camera = camera;
        this.domElement = domElement;
    }

    get active(): boolean {
        return this._active;
    }

    attach(game: GameManager | null): void {
        if (this._active) return;
        this.game = game;
        this.cameraPoseBeforeAttach = {
            position: this.camera.position.clone(),
            quaternion: this.camera.quaternion.clone(),
        };

        const cameraControl = this.game?.cameraControl as
            | {pause: () => void; resume: () => void; isPaused?: boolean}
            | undefined;
        if (cameraControl) {
            this.cameraControlWasPaused = cameraControl.isPaused === true;
            cameraControl.pause();
        }

        this._active = true;
        const attachToken = ++this.attachToken;

        void loadOrbitControlsClass().then(OrbitControlsClass => {
            if (!this._active || attachToken !== this.attachToken || !this.cameraPoseBeforeAttach) {
                return;
            }

            const controls = new OrbitControlsClass(this.camera, this.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.08;
            controls.enableZoom = true;
            controls.panSpeed = 1.6;
            // Place orbit target ~5 units in front of the saved camera pose.
            const forward = new Vector3(0, 0, -1).applyQuaternion(this.cameraPoseBeforeAttach.quaternion);
            controls.target.copy(this.cameraPoseBeforeAttach.position).addScaledVector(forward, 5);
            controls.update();

            if (!this._active || attachToken !== this.attachToken) {
                controls.dispose();
                return;
            }
            this.controls = controls;
        });
    }

    update(): void {
        if (!this._active || !this.controls) return;
        this.controls.update();
    }

    detach(): void {
        if (!this._active) return;
        this.attachToken++;
        this.controls?.dispose();
        this.controls = null;

        // Keep the user's chosen viewpoint: push the new camera pose into the
        // game camera controller so it follows the player from this offset
        // instead of snapping back to where Free Cam started. If we can't adopt
        // the pose (no character / unsupported control type) fall back to
        // restoring the original pose so the camera doesn't end up stuck inside
        // geometry the user flew into.
        const cameraControl = this.game?.cameraControl as
            | {
                  pause: () => void;
                  resume: () => void;
                  isPaused?: boolean;
                  adoptCameraPose?: () => boolean;
              }
            | undefined;

        const adopted = cameraControl?.adoptCameraPose?.() ?? false;
        if (!adopted && this.cameraPoseBeforeAttach) {
            this.camera.position.copy(this.cameraPoseBeforeAttach.position);
            this.camera.quaternion.copy(this.cameraPoseBeforeAttach.quaternion);
            this.camera.updateMatrixWorld();
        }
        this.cameraPoseBeforeAttach = null;

        if (cameraControl && !this.cameraControlWasPaused) {
            cameraControl.resume();
        }
        this.game = null;
        this._active = false;
    }

    dispose(): void {
        this.detach();
    }
}
