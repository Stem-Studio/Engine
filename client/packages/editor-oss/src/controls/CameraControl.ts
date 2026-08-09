import * as THREE from "three";
import {Box3, Camera, MathUtils, Object3D, PerspectiveCamera, SkinnedMesh} from "three";

import {applyCameraProjectionSettings, getCameraControlSettings} from "@stem/editor-oss/camera/cameraSettings";
import EngineRuntime from "@stem/editor-oss/EngineRuntime";
import global from "@stem/editor-oss/global";
import {PhysicsRuntimeUtil as PhysicsUtil} from "@stem/editor-oss/physics/PhysicsRuntimeUtil";
import {CAMERA_TYPES, CameraData, OCCLUSION_TYPES} from "@stem/editor-oss/types/editor";
import {isSprite} from "@stem/editor-oss/utils/SpriteUtils";
import {PointerEventManager, type PointerEventHandler} from "./input/PointerEventManager";

export interface ICameraControl {
    readonly camera: Camera;
    start(character: Object3D): void;
    resetCamera(): void;
    requestPointerLock(): Promise<void>;
    unlockPointerLock(): void;
    update(deltaTime: number): void;
    updateCameraOptions(): void;
    pause(): void;
    resume(): void;
    dispose(): void;
}

const CAMERA_TOUCH_PRIORITY = 999; // This ensures camera controls are processed after any existing controls
const isParticleEmitterObject = (object: Object3D | null | undefined): boolean => object?.type === "ParticleEmitter";

class CameraControl implements ICameraControl {
    public camera: PerspectiveCamera;
    //config params
    private controlType: CAMERA_TYPES = CAMERA_TYPES.THIRD_PERSON;
    private scene: THREE.Scene;
    private character: THREE.Object3D | null = null;
    private engine: EngineRuntime = global.app as EngineRuntime;
    private pointerManager: PointerEventManager;
    private nearLimit: number;
    private farLimit: number;
    private spherical: THREE.Spherical;
    private targetSpherical: THREE.Spherical;
    private angleLerpFactor: number = 0.25;
    private usePointerLock = false;
    private characterHeadHeight: number = 0;
    private defaultPhi: number = 67.5 * Math.PI / 180;

    // Camera follow behavior settings
    private enableCameraFollowBehavior: boolean = false;
    private backViewTolerance: number = 90 * Math.PI / 180; // radians
    private backViewReturnSpeed: number = 0.5; // seconds
    private frontViewFlipSpeed: number = 0.3; // seconds - time window for quick turn detection
    private frontViewFlipAngle: number = 120 * Math.PI / 180; // radians
    private frontViewFlipTransitionSpeed: number = 0.3; // seconds - time to transition between front/back view

    // Camera follow runtime state
    private lastCharacterRotation: number = 0;
    private characterRotationStartTime: number = 0;
    private characterRotationStartAngle: number = 0;
    private isInFrontView: boolean = false;
    private isReturningToCenter: boolean = false;

    //runtime values
    private isPointerLocked: boolean;
    public preventMeshPenetration: boolean = true;
    private targetPosition: THREE.Vector3 = new THREE.Vector3();
    private lastTouchX: number | null = null;
    private lastTouchY: number | null = null;
    private pointerDown: boolean = false;
    //occlusion avoidance
    private targetDistance: number = 0;
    private distanceLerpSpeed = 0.1;
    private raycaster: THREE.Raycaster;
    private cameraSphere: THREE.Sphere = new THREE.Sphere();
    private cameraCollisionIntersections: THREE.Intersection<THREE.Object3D>[] = [];
    private transparencyIntersections: THREE.Intersection<THREE.Object3D>[] = [];
    //zooming
    private targetZoomFactor: number; //(0, 1]
    private zoomFactor: number; //(0, 1]
    private zoomSensitivity: number = 500;
    private zoomDampLambda: number = 10;
    //pause/resume
    private isPaused = false;
    private isPopupHovered = false;

    // Transparency occlusion
    private occlusionType: OCCLUSION_TYPES = OCCLUSION_TYPES.DISTANCE;
    private occludedObjects: Set<THREE.Object3D> = new Set();
    private originalMaterials: Map<THREE.Object3D, THREE.Material | THREE.Material[]> = new Map();

    private raycastCandidates: THREE.Object3D[] = [];
    private raycastDirection: THREE.Vector3 = new THREE.Vector3();
    private occlusionRayOrigin: THREE.Vector3 = new THREE.Vector3();
    private occlusionRayTarget: THREE.Vector3 = new THREE.Vector3();
    private occlusionRayDirection: THREE.Vector3 = new THREE.Vector3();
    private characterForward: THREE.Vector3 = new THREE.Vector3();
    private currentOccludingObjects: Set<THREE.Object3D> = new Set();
    private boxTmp = new Box3();

    private mouseWheelHandler = (event: WheelEvent) => {
        this.onMouseWheel(event);
    };
    private keyDownHandler = (event: KeyboardEvent) => {
        this.onKeyDown(event);
    };
    private pointerLockChangeHandler = () => {
        this.onPointerLockChange();
    };

    public constructor(
        scene: THREE.Scene,
        camera: THREE.PerspectiveCamera,
        pointerEventManager: PointerEventManager,
        _cameraLockPosition: boolean = false,
        nearLimit: number = 7,
        farLimit: number = 16,
        fov: number = 70,
        zoomFactor = 1,
    ) {
        this.scene = scene;
        this.camera = camera;
        this.pointerManager = pointerEventManager;
        this.nearLimit = nearLimit;
        this.farLimit = farLimit;
        this.camera.fov = fov;
        this.zoomFactor = zoomFactor;
        this.targetZoomFactor = zoomFactor;
        this.spherical = new THREE.Spherical(this.nearLimit, Math.PI / 2, 0);
        this.targetSpherical = new THREE.Spherical(this.nearLimit, this.defaultPhi, -Math.PI / 2);
        this.usePointerLock = false;
        this.isPointerLocked = false;
        //occlusion avoidance
        this.raycaster = new THREE.Raycaster();
        this.boxTmp = new Box3();

        this.updateCameraOptions();

        const cameraData = CameraControl.getCameraOptions(this.camera);
        if (cameraData) {
            this.targetSpherical.phi = this.defaultPhi;

            if (cameraData.cameraDefaultDistance !== undefined && this.farLimit > this.nearLimit) {
                const ratio = (cameraData.cameraDefaultDistance - this.nearLimit) / (this.farLimit - this.nearLimit);
                this.zoomFactor = MathUtils.clamp(1.0 - ratio, 0, 1);
                this.targetZoomFactor = this.zoomFactor;
            }
        }

        this.camera.updateProjectionMatrix();

        global.app?.on("contextmenuHover.CameraControl", () => {
            this.isPopupHovered = true;
        });
        global.app?.on("contextmenuUnhover.CameraControl", () => {
            this.isPopupHovered = false;
        });
        this.addEventListeners();
    }

    public updateCameraOptions() {
        const cameraData = CameraControl.getCameraOptions(this.camera);
        if (cameraData) {
            applyCameraProjectionSettings(this.camera, cameraData);

            // NONE: apply projection settings but skip control config, auto-pause
            if (cameraData.cameraType === CAMERA_TYPES.NONE) {
                this.controlType = CAMERA_TYPES.NONE;
                this.pause();
                return;
            }

            const controlSettings = getCameraControlSettings(cameraData, {
                nearLimit: this.nearLimit,
                farLimit: this.farLimit,
            });

            this.controlType = controlSettings.controlType;
            this.nearLimit = controlSettings.nearLimit;
            this.farLimit = controlSettings.farLimit;
            this.usePointerLock = controlSettings.usePointerLock;
            this.defaultPhi = controlSettings.defaultPhi;
            //FIXME: get from CharacterBehavior
            this.scene.userData.cameraHeadHeight = controlSettings.cameraHeadHeight;

            // Initialize camera follow settings
            this.enableCameraFollowBehavior = controlSettings.enableCameraFollowBehavior;
            this.backViewTolerance = controlSettings.backViewTolerance;
            this.backViewReturnSpeed = controlSettings.backViewReturnSpeed;
            this.frontViewFlipSpeed = controlSettings.frontViewFlipSpeed;
            this.frontViewFlipAngle = controlSettings.frontViewFlipAngle;
            this.frontViewFlipTransitionSpeed = controlSettings.frontViewFlipTransitionSpeed;
            this.occlusionType = controlSettings.occlusionType;
        }
    }

    start(player: Object3D) {
        this.character = player;
        const playerBox = new Box3().setFromObject(player);
        this.characterHeadHeight = (playerBox.max.y - playerBox.min.y) * 0.9; //FIXME: get from character behavior
        this.alignWithCharacter();
    }
    public resetCamera() {
        this.alignWithCharacter();
    }

    pause() {
        this.isPaused = true;
        this.pointerDown = false;
        this.lastTouchX = null;
        this.lastTouchY = null;
    }

    resume() {
        this.isPaused = false;
    }

    /**
     * Re-seed spherical/zoom state from the camera's current world pose so the
     * follow cam picks up where another controller (e.g. the play-mode free
     * camera) left off, instead of snapping back to the prior offset.
     *
     * Returns true if the state was applied. No-ops (returns false) when there
     * is no character to anchor to or when the active control type doesn't use
     * a spherical offset (e.g. FIRST_PERSON locks the camera onto the target).
     */
    public adoptCameraPose(): boolean {
        if (!this.character) return false;
        if (this.controlType === CAMERA_TYPES.FIRST_PERSON) return false;

        this.calculateTargetPosition();
        const offset = new THREE.Vector3().subVectors(this.camera.position, this.targetPosition);
        const radius = offset.length();
        if (radius < 1e-4) return false;

        const next = new THREE.Spherical().setFromVector3(offset);
        next.phi = MathUtils.clamp(next.phi, 0.01, Math.PI * 0.99);

        // theta in THREE.Spherical comes from atan2(x, z); CameraControl's
        // updateCameraPosition uses x = sin(phi)cos(theta), z = sin(phi)sin(theta),
        // which matches atan2(z, x). Convert.
        next.theta = Math.atan2(offset.z, offset.x);

        this.targetSpherical.theta = next.theta;
        this.targetSpherical.phi = next.phi;
        this.targetSpherical.radius = radius;
        this.spherical.theta = next.theta;
        this.spherical.phi = next.phi;
        this.spherical.radius = radius;

        // Map the new radius back into a zoomFactor in (0, 1] so the next
        // frame's getControlRadius() reproduces the same distance. Solve
        // desiredDistance = lerp(nearLimit, farLimit, 1 - zoomFactor).
        const span = this.nearLimit - this.farLimit;
        if (Math.abs(span) > 1e-4) {
            const clampedDistance = MathUtils.clamp(
                radius,
                Math.min(this.nearLimit, this.farLimit),
                Math.max(this.nearLimit, this.farLimit),
            );
            const z = (clampedDistance - this.farLimit) / span;
            this.zoomFactor = MathUtils.clamp(z, 0.001, 1);
            this.targetZoomFactor = this.zoomFactor;
        }

        // targetDistance is consumed by occlusion/zoom logic on the next tick.
        this.targetDistance = radius;

        return true;
    }

    private initPointerLockEvents() {
        if (this.usePointerLock) {
            document.addEventListener("pointerlockchange", this.pointerLockChangeHandler);
        }
    }

    private onPointerLockChange() {
        this.isPointerLocked = !!document.pointerLockElement;
        if (!this.isPointerLocked) {
            global.app?.call("unlockEvent");
        }
    }

    private initMouseEvents() {
        // Register camera control handler with lower priority than touch controls
        const cameraHandler: PointerEventHandler = {
            onPointerDown: (event: PointerEvent) => {
                if (this.isPaused) {
                    return false;
                }

                this.onPointerDown(event);
                return true; // Don't capture initially, let higher priority handlers decide first
            },
            onPointerMove: (event: PointerEvent) => {
                if (this.isPaused) {
                    return false;
                }
                // Handle camera movement if we should be tracking
                // Additional check: for mouse events, ensure button is pressed
                if (this.shouldHandleCameraMovement() && (event.pointerType === "touch" || event.buttons > 0)) {
                    this.onPointerMove(event);
                    return true; // Signal that we processed this movement
                }
                return false;
            },
            onPointerUp: (event: PointerEvent) => {
                if (this.isPaused) {
                    return false;
                }
                this.onPointerUp(event);
                return false; // Don't exclusively handle pointer end
            },
        };

        this.pointerManager.registerHandler(
            "camera-control",
            cameraHandler,
            null, // Global handler
            CAMERA_TOUCH_PRIORITY,
        );

        // Still need direct listeners for wheel and keyboard events
        document.addEventListener("wheel", this.mouseWheelHandler, {passive: false});
        document.addEventListener("keydown", this.keyDownHandler);
    }

    private shouldHandleCameraMovement(): boolean {
        // For pointer lock mode, handle if locked
        if (this.usePointerLock) {
            return this.isPointerLocked;
        }

        // For non-pointer-lock mode, handle only if pointer is down and camera isn't locked
        // This ensures mouse movement only works when mouse button is pressed
        return this.pointerDown && !this.engine.isCameraLocked;
    }

    private addEventListeners(): void {
        this.initMouseEvents();
        this.initPointerLockEvents();
    }

    private removeEventListeners() {
        this.pointerManager.unregisterHandler("camera-control");
        document.removeEventListener("wheel", this.mouseWheelHandler, {passive: false} as AddEventListenerOptions);
        document.removeEventListener("keydown", this.keyDownHandler);
        document.removeEventListener("pointerlockchange", this.pointerLockChangeHandler);
    }

    private onKeyDown(event: KeyboardEvent) {
        if (this.isPaused) return;
        if (event.key === "Escape") {
            event.preventDefault();
            this.unlockPointerLock();
        }
    }

    public requestPointerLock(): Promise<void> {
        if (!this.usePointerLock) return Promise.resolve();
        if (document.body.requestPointerLock) {
            document.body.requestPointerLock().catch(error => {
                console.error("Failed to request pointer lock:", error);
            });
        } else {
            console.error("Pointer Lock is not supported");
        }

        return Promise.resolve();
    }

    public unlockPointerLock() {
        if (document.exitPointerLock) {
            document.exitPointerLock();
        } else {
            console.error("Pointer Lock is not supported");
        }
    }

    private onMouseWheel(event: WheelEvent) {
        if (this.isPaused) return;
        if (this.isPopupHovered) return;

        // Only prevent default if we're on the canvas
        if (this.engine.renderer && event.target === this.engine.renderer.domElement) {
            event.preventDefault();
            this.zoom(-event.deltaY / this.zoomSensitivity);
        }
    }

    private onPointerDown(event: PointerEvent) {
        if (event.buttons === 1 || event.pointerType === "touch") {
            this.pointerDown = true;

            // For touch devices, store initial touch position for fallback calculation
            if (event.pointerType === "touch") {
                this.lastTouchX = event.clientX;
                this.lastTouchY = event.clientY;
            }
        }
    }

    private onPointerUp(event: PointerEvent) {
        this.pointerDown = false;

        // Reset touch position when touch ends
        if (event.pointerType === "touch") {
            this.lastTouchX = null;
            this.lastTouchY = null;
        }
    }

    private zoom(delta: number) {
        if (this.targetZoomFactor + delta > 1 || this.targetZoomFactor + delta < 0.1) {
            return;
        }
        this.targetZoomFactor += delta;
    }

    private onPointerMove(event: PointerEvent) {
        // Check if camera movement is allowed
        if (
            this.usePointerLock && !this.isPointerLocked ||
            !this.usePointerLock && !this.pointerDown ||
            this.engine.isCameraLocked
        ) {
            return;
        }

        let deltaX = 0;
        let deltaY = 0;

        if (event.pointerType === "touch") {
            // For touch devices, consistently use clientX/Y to calculate delta
            if (this.lastTouchX !== null && this.lastTouchY !== null) {
                deltaX = event.clientX - this.lastTouchX;
                deltaY = event.clientY - this.lastTouchY;
            }
            // Always update the last touch position for the next move event
            this.lastTouchX = event.clientX;
            this.lastTouchY = event.clientY;
        } else {
            // For mouse, movementX/Y is reliable
            deltaX = event.movementX;
            deltaY = event.movementY;
        }

        if (deltaX === 0 && deltaY === 0) return;

        const thetaDelta = deltaX * 0.006;
        const phiDelta = deltaY * 0.004;

        this.targetSpherical.theta += thetaDelta;
        this.targetSpherical.phi -= phiDelta;

        this.targetSpherical.phi = THREE.MathUtils.clamp(this.targetSpherical.phi, 0.01, Math.PI * 0.99);

    }

    public update(deltaTime: number) {
        if (this.isPaused) return;
        if (this.enableCameraFollowBehavior) {
            this.updateCameraFollowBehavior(deltaTime);
        }
        this.updateCameraPosition(deltaTime);
        if (this.occlusionType === OCCLUSION_TYPES.TRANSPARENCY) {
            this.updateTransparencyOcclusion();
        }
    }

    private updateCameraFollowBehavior(deltaTime: number) {
        if (!this.character || this.controlType !== CAMERA_TYPES.THIRD_PERSON) return;

        const currentTime = performance.now() / 1000;
        const characterForward = this.characterForward.set(0, 0, 1).applyQuaternion(this.character.quaternion);
        const currentCharacterAngle = Math.atan2(characterForward.z, characterForward.x);

        // Initialize tracking on first update
        if (this.lastCharacterRotation === 0 && this.characterRotationStartTime === 0) {
            this.lastCharacterRotation = currentCharacterAngle;
            this.characterRotationStartAngle = currentCharacterAngle;
            this.characterRotationStartTime = currentTime;
            return;
        }

        // If pointer is down, player has full manual control - skip automatic camera adjustments
        if (this.pointerDown) {
            this.lastCharacterRotation = currentCharacterAngle;
            this.characterRotationStartAngle = currentCharacterAngle;
            this.characterRotationStartTime = currentTime;
            this.isReturningToCenter = false;
            return;
        }

        // --- Quick Turn Detection ---
        let frameRotationDelta = currentCharacterAngle - this.lastCharacterRotation;
        while (frameRotationDelta > Math.PI) frameRotationDelta -= Math.PI * 2;
        while (frameRotationDelta < -Math.PI) frameRotationDelta += Math.PI * 2;

        // If character is rotating significantly (threshold to avoid noise)
        if (Math.abs(frameRotationDelta) > 0.001) {
            let totalRotation = currentCharacterAngle - this.characterRotationStartAngle;
            while (totalRotation > Math.PI) totalRotation -= Math.PI * 2;
            while (totalRotation < -Math.PI) totalRotation += Math.PI * 2;

            const rotationDuration = currentTime - this.characterRotationStartTime;

            if (Math.abs(totalRotation) > this.frontViewFlipAngle) {
                if (rotationDuration < this.frontViewFlipSpeed) {
                    // Quick turn detected
                    // Check if the character is facing the camera
                    let angleToCamera = this.spherical.theta - currentCharacterAngle;
                    while (angleToCamera > Math.PI) angleToCamera -= Math.PI * 2;
                    while (angleToCamera < -Math.PI) angleToCamera += Math.PI * 2;

                    // Switch to front view only if character is facing the camera (within 90 degrees)
                    // Otherwise switch/stay in back view
                    this.isInFrontView = Math.abs(angleToCamera) < Math.PI / 2;

                    // Reset tracking
                    this.characterRotationStartAngle = currentCharacterAngle;
                    this.characterRotationStartTime = currentTime;
                } else {
                    // Too slow, reset start to current to avoid triggering later
                    this.characterRotationStartAngle = currentCharacterAngle;
                    this.characterRotationStartTime = currentTime;
                }
            }
        } else {
            // Stopped rotating
            this.characterRotationStartAngle = currentCharacterAngle;
            this.characterRotationStartTime = currentTime;
        }

        this.lastCharacterRotation = currentCharacterAngle;

        // --- Camera Positioning ---
        // Target angle: Back View = char + PI, Front View = char
        const offset = this.isInFrontView ? 0 : Math.PI;
        const targetCameraAngle = currentCharacterAngle + offset;

        let angleDiff = this.targetSpherical.theta - targetCameraAngle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        if (this.isInFrontView) {
            // Front View: Smoothly transition to center front
            const lambda = 4.0 / this.frontViewFlipTransitionSpeed;
            const t = 1.0 - Math.exp(-lambda * deltaTime);
            this.targetSpherical.theta -= angleDiff * t;
            this.isReturningToCenter = false;
        } else {
            // Back View: Only return if outside tolerance or already returning
            if (Math.abs(angleDiff) > this.backViewTolerance) {
                this.isReturningToCenter = true;
            }
            if (this.isReturningToCenter) {
                const lambda = 4.0 / this.backViewReturnSpeed;
                const t = 1.0 - Math.exp(-lambda * deltaTime);
                this.targetSpherical.theta -= angleDiff * t;
                // Stop returning when close to center
                if (Math.abs(angleDiff) < 0.01) {
                    this.isReturningToCenter = false;
                }
            }
        }
    }

    // TODO: refactor this, to make it easier to understand,
    // could be universal camera constrols like limits and offsets
    // and we setup this in character controller code to not have dependencies from this class on player object
    // that way we can have any type of camera view for any type of object without changing this class: Open-Closed principle from SOLID
    private updateCameraPosition(deltaTime: number) {
        this.spherical.theta += (this.targetSpherical.theta - this.spherical.theta) * this.angleLerpFactor;
        this.spherical.phi += (this.targetSpherical.phi - this.spherical.phi) * this.angleLerpFactor;

        // TODO: we should make controls for camera target offset and limits
        this.calculateTargetPosition();
        this.zoomFactor = MathUtils.damp(this.zoomFactor, this.targetZoomFactor, this.zoomDampLambda, deltaTime);
        let radius = this.controlType === CAMERA_TYPES.FIRST_PERSON ? this.farLimit : this.getControlRadius();

        let x, y, z;

        x = radius * Math.sin(this.spherical.phi) * Math.cos(this.spherical.theta) + this.targetPosition.x;
        y = radius * Math.cos(this.spherical.phi) + this.targetPosition.y;
        z = radius * Math.sin(this.spherical.phi) * Math.sin(this.spherical.theta) + this.targetPosition.z;

        this.camera.position.set(x, y, z);

        // handle fps no weapon until refactor is complete
        if (this.controlType === CAMERA_TYPES.FIRST_PERSON) {
            this.camera.position.copy(this.targetPosition);
        }

        const hesitationFactor = 0.1;
        this.camera.position.x += (x - this.camera.position.x) * hesitationFactor;
        this.camera.position.y += (y - this.camera.position.y) * hesitationFactor;
        this.camera.position.z += (z - this.camera.position.z) * hesitationFactor;

        ////TODO this will change after re-factoring of camera behaviors
        // if (this.scene && this.scene.userData && this.scene.userData.cameraType == CAMERA_TYPES.FIXED) {
        //     this.camera.position.y = this.player.position.y + this.scene.userData.cameraHeadHeight;
        // }

        this.camera.lookAt(this.targetPosition);
    }

    private getControlRadius() {
        // Calculate desired distance based on zoom factor
        // zoomFactor 1.0 = nearLimit (zoomed in), zoomFactor 0.1 = farLimit (zoomed out)
        const desiredDistance = THREE.MathUtils.lerp(this.nearLimit, this.farLimit, 1.0 - this.zoomFactor);

        if (!this.preventMeshPenetration || this.occlusionType !== OCCLUSION_TYPES.DISTANCE) {
            // Map zoomFactor (0.1-1.0) to distance range (farLimit-nearLimit)
            // zoomFactor 1.0 = nearLimit (zoomed in), zoomFactor 0.1 = farLimit (zoomed out)
            return THREE.MathUtils.clamp(desiredDistance, this.nearLimit, this.farLimit);
        }

        // Create a sphere centered at targetPosition with radius = desiredDistance for culling
        this.cameraSphere.set(this.targetPosition, desiredDistance);

        this.raycastCandidates.length = 0;
        for (const child of this.scene.children) {
            if (!isSprite(child) && this.isObjectInCameraRadius(child, this.cameraSphere) && this.isValidIntersect(child)) {
                this.raycastCandidates.push(child);
            }
        }

        if (this.raycastCandidates.length === 0) {
            this.targetDistance = desiredDistance;
            return desiredDistance;
        }

        this.camera.getWorldDirection(this.raycastDirection);
        this.raycastDirection.negate();

        this.raycaster.far = desiredDistance;
        this.raycaster.set(this.targetPosition, this.raycastDirection);
        this.raycaster.camera = this.camera;

        // We use isValidIntersect in the filter to reduce the number of objects passed to the raycaster, improving performance.
        // However, since raycasting with recursive: true can return nested child objects (not just direct children),
        // we must check isValidIntersect again for each intersected object to ensure it is valid.
        this.cameraCollisionIntersections.length = 0;
        this.raycaster.intersectObjects(this.raycastCandidates, true, this.cameraCollisionIntersections);

        let obstacleDistance = this.farLimit;

        // We check isValidIntersect again here because intersectObjects with recursive: true
        // may return nested objects that were not filtered out at the top level.
        for (const intersect of this.cameraCollisionIntersections) {
            if (this.isValidIntersect(intersect.object)) {
                obstacleDistance = Math.min(obstacleDistance, intersect.distance);
            }
        }

        // Clamp distance based on camera angle to prevent clipping through character
        const maxDistanceByAngle =
            this.characterHeadHeight / Math.cos(Math.PI - Math.max(this.spherical.phi, Math.PI / 2));
        const maxAllowedDistance = Math.min(this.farLimit, maxDistanceByAngle);

        // Add small offset when hitting obstacles to prevent clipping
        const clippingOffset = 1;
        const adjustedObstacleDistance =
            obstacleDistance > 0 ? Math.max(0.001, obstacleDistance - clippingOffset) : obstacleDistance;

        // Use the minimum of: desired zoom distance, obstacle distance, and max allowed by angle
        let distance = Math.min(desiredDistance, adjustedObstacleDistance, maxAllowedDistance);

        let lerpSpeed = this.distanceLerpSpeed;
        if (distance < this.targetDistance) {
            // Moving closer - instant (user zoom in)
            lerpSpeed = 1.0;
        }
        // else: moving away - smooth (obstacle avoidance)

        distance = THREE.MathUtils.lerp(this.targetDistance, distance, lerpSpeed);

        this.targetDistance = distance;

        return distance;
    }

    private isValidIntersect(object: Object3D | null, hasEnabledPhysics = false): boolean {
        if (!this.character) return false;
        if (!object) return hasEnabledPhysics;
        if (isParticleEmitterObject(object)) return false;
        return (
            object.uuid !== this.character.uuid &&
            !(object as SkinnedMesh).isSkinnedMesh &&
            object.userData?.disableCameraCollision !== true &&
            object.userData?.tempDisableCameraCollision !== true &&
            this.isValidIntersect(object.parent, hasEnabledPhysics || PhysicsUtil.isPhysicsEnabled(object))
        );
    }

    private isObjectInCameraRadius(object: THREE.Object3D, cameraSphere: THREE.Sphere): boolean {
        this.boxTmp.makeEmpty();
        this.boxTmp.setFromObject(object);
        if (this.boxTmp.isEmpty()) {
            return false;
        }
        return this.boxTmp.intersectsSphere(cameraSphere);
    }

    private calculateTargetPosition() {
        if (!this.character) return;
        this.targetPosition.copy(this.character.position);
        this.targetPosition.y += this.characterHeadHeight;
    }

    private updateTransparencyOcclusion() {
        if (!this.character) return;

        // Calculate the line of sight from camera to character head
        const cameraPosition = this.occlusionRayOrigin.copy(this.camera.position);
        const targetPosition = this.occlusionRayTarget.copy(this.targetPosition);
        const direction = this.occlusionRayDirection.subVectors(targetPosition, cameraPosition);
        const distance = direction.length();
        direction.normalize();

        // Setup raycaster
        this.raycaster.set(cameraPosition, direction);
        this.raycaster.far = distance;
        this.raycaster.camera = this.camera;

        // Find all objects that intersect the line of sight
        this.transparencyIntersections.length = 0;
        this.raycaster.intersectObjects(this.scene.children, true, this.transparencyIntersections);
        this.currentOccludingObjects.clear();

        // Process intersections
        for (const intersect of this.transparencyIntersections) {
            if (this.isValidOcclusionObject(intersect.object)) {
                this.currentOccludingObjects.add(intersect.object);

                // Make object transparent if not already
                if (!this.occludedObjects.has(intersect.object)) {
                    this.makeObjectTransparent(intersect.object);
                    this.occludedObjects.add(intersect.object);
                }
            }
        }

        // Restore objects that are no longer occluding
        for (const obj of this.occludedObjects) {
            if (!this.currentOccludingObjects.has(obj)) {
                this.restoreObjectMaterial(obj);
                this.occludedObjects.delete(obj);
            }
        }
    }

    private isValidOcclusionObject(object: THREE.Object3D): boolean {
        if (!object) return false;
        if (!this.character) return false;

        // Don't occlude the character itself or its children, and don't treat
        // VFX (three.quarks ParticleEmitter) or its descendants as occluders —
        // cloning their material to apply transparency corrupts particle rendering.
        let parent: THREE.Object3D | null = object;
        while (parent) {
            if (parent.uuid === this.character.uuid) return false;
            if (isParticleEmitterObject(parent)) return false;
            parent = parent.parent;
        }

        // Don't occlude sprites or skinned meshes
        if (isSprite(object) || (object as SkinnedMesh).isSkinnedMesh) return false;

        // Don't occlude if explicitly disabled
        if (object.userData?.disableCameraCollision === true || object.userData?.tempDisableCameraCollision === true) return false;

        // Only occlude meshes
        return (object as THREE.Mesh).isMesh === true;
    }

    private makeObjectTransparent(object: THREE.Object3D) {
        const mesh = object as THREE.Mesh;
        if (!mesh.material) return;

        // Store original material(s)
        this.originalMaterials.set(object, mesh.material);

        // Create transparent/wireframe material
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const newMaterials = materials.map(mat => {
            // Only apply wireframe to materials that support it
            if (
                (mat as THREE.MeshStandardMaterial).isMeshStandardMaterial ||
                (mat as THREE.MeshBasicMaterial).isMeshBasicMaterial ||
                (mat as THREE.MeshPhongMaterial).isMeshPhongMaterial
            ) {
                const transparentMat = mat.clone();
                transparentMat.transparent = true;
                transparentMat.opacity = 0.2;
                (transparentMat as THREE.MeshStandardMaterial).wireframe = true;
                transparentMat.depthWrite = false;
                return transparentMat;
            }
            return mat;
        });

        mesh.material = Array.isArray(mesh.material) ? newMaterials : newMaterials[0]!;
    }

    private restoreObjectMaterial(object: THREE.Object3D) {
        const mesh = object as THREE.Mesh;
        if (!mesh.material) return;

        const originalMaterial = this.originalMaterials.get(object);
        if (originalMaterial) {
            // Dispose temporary materials
            const currentMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            currentMaterials.forEach(mat => mat.dispose());

            // Restore original
            mesh.material = originalMaterial;
            this.originalMaterials.delete(object);
        }
    }

    public dispose() {
        this.removeEventListeners();

        // Restore all occluded objects
        for (const obj of this.occludedObjects) {
            this.restoreObjectMaterial(obj);
        }
        this.occludedObjects.clear();
        this.originalMaterials.clear();
    }

    public static getCameraOptions(camera: THREE.Object3D): CameraData | undefined {
        return camera?.userData?.cameraData as CameraData | undefined;
    }

    private alignWithCharacter() {
        if (!this.character) {
            console.warn("CameraControl: No character set!");
            return;
        }

        this.calculateTargetPosition();

        const lookDir = this.characterForward.set(0, 0, 1).applyQuaternion(this.character.quaternion);
        const characterAngle = Math.atan2(lookDir.z, lookDir.x);
        this.targetSpherical.theta = characterAngle + Math.PI;
        this.targetSpherical.phi = this.defaultPhi;
        this.spherical.radius = this.getControlRadius();

        // Initialize camera follow state
        this.lastCharacterRotation = characterAngle;
        this.characterRotationStartAngle = characterAngle;
        this.characterRotationStartTime = performance.now() / 1000;
        this.isInFrontView = false;

        this.updateCameraPosition(0.016);
    }
}

export {CameraControl};
