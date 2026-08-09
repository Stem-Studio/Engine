import * as THREE from "three";
import {ParticleEmitter, ParticleSystem} from "three.quarks";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {CameraControl} from "./CameraControl";
import {createFreshParticleConfig} from "@stem/editor-oss/services";
import {CAMERA_TYPES, OCCLUSION_TYPES} from "@stem/editor-oss/types/editor";

type CameraControlHarness = Record<string, unknown> & {
    isValidIntersect(object: THREE.Object3D | null): boolean;
    isValidOcclusionObject(object: THREE.Object3D): boolean;
    getControlRadius(): number;
    initPointerLockEvents(): void;
    removeEventListeners(): void;
    requestPointerLock(): Promise<void>;
    updateCameraPosition(deltaTime: number): void;
    updateTransparencyOcclusion(): void;
};

function makeEmitter(): ParticleEmitter {
    const system = new ParticleSystem(createFreshParticleConfig());
    return new ParticleEmitter(system);
}

function createControl(character: THREE.Object3D | null): CameraControlHarness {
    const ctrl = Object.create(CameraControl.prototype) as CameraControlHarness;
    ctrl.character = character;
    return ctrl;
}

function callIsValidIntersect(ctrl: CameraControlHarness, object: THREE.Object3D | null) {
    return ctrl.isValidIntersect(object);
}

function callIsValidOcclusionObject(ctrl: CameraControlHarness, object: THREE.Object3D) {
    return ctrl.isValidOcclusionObject(object);
}

function callGetControlRadius(ctrl: CameraControlHarness) {
    return ctrl.getControlRadius();
}

function callUpdateTransparencyOcclusion(ctrl: CameraControlHarness) {
    ctrl.updateTransparencyOcclusion();
}

function callUpdateCameraPosition(ctrl: CameraControlHarness, deltaTime = 1 / 60) {
    ctrl.updateCameraPosition(deltaTime);
}

function setPhysics(object: THREE.Object3D, enabled: boolean) {
    object.userData.physics = {enabled};
}

function makeIntersection(object: THREE.Object3D, distance: number): THREE.Intersection<THREE.Object3D> {
    return {
        distance,
        point: new THREE.Vector3(),
        object,
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("CameraControl.isValidIntersect (VFX exclusion)", () => {
    let character: THREE.Object3D;

    beforeEach(() => {
        character = new THREE.Object3D();
        character.name = "Player";
    });

    it("rejects a ParticleEmitter directly", () => {
        const ctrl = createControl(character);
        const emitter = makeEmitter();
        setPhysics(emitter, true); // even with physics enabled, VFX must be ignored

        expect(callIsValidIntersect(ctrl, emitter)).toBe(false);
    });

    it("rejects descendants of a ParticleEmitter via the parent walk", () => {
        const ctrl = createControl(character);
        const emitter = makeEmitter();
        const particleChild = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial(),
        );
        emitter.add(particleChild);
        setPhysics(emitter, true);

        expect(callIsValidIntersect(ctrl, particleChild)).toBe(false);
    });

    it("returns false when no character has been assigned", () => {
        const ctrl = createControl(null);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        setPhysics(mesh, true);

        expect(callIsValidIntersect(ctrl, mesh)).toBe(false);
    });

    it("rejects a mesh whose ancestor chain has no physics enabled", () => {
        const ctrl = createControl(character);
        const parent = new THREE.Group();
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        parent.add(mesh);

        expect(callIsValidIntersect(ctrl, mesh)).toBe(false);
    });

    it("accepts a mesh whose ancestor chain has physics enabled", () => {
        const ctrl = createControl(character);
        const parent = new THREE.Group();
        setPhysics(parent, true);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        parent.add(mesh);

        expect(callIsValidIntersect(ctrl, mesh)).toBe(true);
    });

    it("rejects the character itself", () => {
        const ctrl = createControl(character);
        setPhysics(character, true);

        expect(callIsValidIntersect(ctrl, character)).toBe(false);
    });

    it("rejects skinned meshes (player visual rig)", () => {
        const ctrl = createControl(character);
        const skinned = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        setPhysics(skinned, true);

        expect(callIsValidIntersect(ctrl, skinned)).toBe(false);
    });

    it("rejects objects flagged with disableCameraCollision", () => {
        const ctrl = createControl(character);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        setPhysics(mesh, true);
        mesh.userData.disableCameraCollision = true;

        expect(callIsValidIntersect(ctrl, mesh)).toBe(false);
    });

    it("ignores Light objects (lights are not pushable obstacles, no physics)", () => {
        const ctrl = createControl(character);
        const light = new THREE.PointLight();

        expect(callIsValidIntersect(ctrl, light)).toBe(false);
    });
});

describe("CameraControl.isValidOcclusionObject (VFX exclusion)", () => {
    let character: THREE.Object3D;

    beforeEach(() => {
        character = new THREE.Object3D();
        character.name = "Player";
    });

    it("rejects a ParticleEmitter so VFX materials are not cloned to transparency", () => {
        const ctrl = createControl(character);
        const emitter = makeEmitter();

        expect(callIsValidOcclusionObject(ctrl, emitter)).toBe(false);
    });

    it("rejects mesh descendants of a ParticleEmitter", () => {
        const ctrl = createControl(character);
        const emitter = makeEmitter();
        const child = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
        emitter.add(child);

        expect(callIsValidOcclusionObject(ctrl, child)).toBe(false);
    });

    it("rejects the character and its descendants", () => {
        const ctrl = createControl(character);
        const child = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        character.add(child);

        expect(callIsValidOcclusionObject(ctrl, child)).toBe(false);
    });

    it("rejects Light objects (not meshes, must never be made transparent)", () => {
        const ctrl = createControl(character);
        const light = new THREE.DirectionalLight();

        expect(callIsValidOcclusionObject(ctrl, light)).toBe(false);
    });

    it("accepts a regular standalone mesh between camera and player", () => {
        const ctrl = createControl(character);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());

        expect(callIsValidOcclusionObject(ctrl, mesh)).toBe(true);
    });
});

describe("CameraControl.updateCameraPosition", () => {
    it("orients the camera once after calculating the final frame position", () => {
        const character = new THREE.Object3D();
        character.position.set(1, 2, 3);

        const camera = new THREE.PerspectiveCamera();
        const lookAt = vi.spyOn(camera, "lookAt");
        const ctrl = createControl(character);

        ctrl.camera = camera;
        ctrl.controlType = CAMERA_TYPES.THIRD_PERSON;
        ctrl.spherical = new THREE.Spherical(4, Math.PI / 2, 0);
        ctrl.targetSpherical = new THREE.Spherical(4, Math.PI / 2, 0);
        ctrl.angleLerpFactor = 1;
        ctrl.characterHeadHeight = 2;
        ctrl.targetPosition = new THREE.Vector3();
        ctrl.nearLimit = 4;
        ctrl.farLimit = 8;
        ctrl.preventMeshPenetration = false;
        ctrl.zoomFactor = 1;
        ctrl.targetZoomFactor = 1;
        ctrl.zoomDampLambda = 10;

        callUpdateCameraPosition(ctrl);

        expect(lookAt).toHaveBeenCalledTimes(1);
        expect(lookAt).toHaveBeenCalledWith(ctrl.targetPosition);
        expect((ctrl.targetPosition as THREE.Vector3).toArray()).toEqual([1, 4, 3]);
    });
});

describe("CameraControl raycast hot paths", () => {
    it("reuses the camera collision intersection target array", () => {
        const obstacle = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        const reusableIntersections: THREE.Intersection<THREE.Object3D>[] = [
            makeIntersection(obstacle, 99),
        ];
        const ctrl = createControl(new THREE.Object3D());
        const raycaster = {
            far: 0,
            camera: null,
            set: vi.fn(),
            intersectObjects: vi.fn(
                (_objects: THREE.Object3D[], _recursive: boolean, target: THREE.Intersection<THREE.Object3D>[]) => {
                    expect(target).toBe(reusableIntersections);
                    expect(target).toHaveLength(0);
                    target.push(makeIntersection(obstacle, 2));
                    return target;
                },
            ),
        };
        ctrl.preventMeshPenetration = true;
        ctrl.occlusionType = OCCLUSION_TYPES.DISTANCE;
        ctrl.nearLimit = 1;
        ctrl.farLimit = 5;
        ctrl.zoomFactor = 0.5;
        ctrl.targetDistance = 5;
        ctrl.distanceLerpSpeed = 1;
        ctrl.characterHeadHeight = 10;
        ctrl.spherical = new THREE.Spherical(1, Math.PI / 2, 0);
        ctrl.targetPosition = new THREE.Vector3();
        ctrl.cameraSphere = new THREE.Sphere();
        ctrl.raycastCandidates = [];
        ctrl.raycastDirection = new THREE.Vector3();
        ctrl.cameraCollisionIntersections = reusableIntersections;
        ctrl.scene = {children: [obstacle]};
        ctrl.camera = {
            getWorldDirection: vi.fn((direction: THREE.Vector3) => direction.set(0, 0, -1)),
        };
        ctrl.isObjectInCameraRadius = vi.fn(() => true);
        ctrl.isValidIntersect = vi.fn(() => true);
        ctrl.raycaster = raycaster;

        callGetControlRadius(ctrl);

        expect(raycaster.intersectObjects).toHaveBeenCalledWith([obstacle], true, reusableIntersections);
        expect(reusableIntersections).toHaveLength(1);
    });

    it("reuses transparency occlusion intersections and occluder set", () => {
        const occluder = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        const stale = new THREE.Object3D();
        const reusableIntersections: THREE.Intersection<THREE.Object3D>[] = [
            makeIntersection(stale, 99),
        ];
        const reusableOccluders = new Set<THREE.Object3D>([stale]);
        const occludedObjects = new Set<THREE.Object3D>();
        const makeObjectTransparent = vi.fn();
        const restoreObjectMaterial = vi.fn();
        const raycaster = {
            far: 0,
            camera: null,
            set: vi.fn(),
            intersectObjects: vi.fn(
                (_objects: THREE.Object3D[], _recursive: boolean, target: THREE.Intersection<THREE.Object3D>[]) => {
                    expect(target).toBe(reusableIntersections);
                    expect(target).toHaveLength(0);
                    target.push(makeIntersection(occluder, 1));
                    return target;
                },
            ),
        };
        const ctrl = createControl(new THREE.Object3D());
        ctrl.scene = {children: [occluder]};
        ctrl.camera = {position: new THREE.Vector3(0, 0, 5)};
        ctrl.targetPosition = new THREE.Vector3();
        ctrl.occlusionRayOrigin = new THREE.Vector3();
        ctrl.occlusionRayTarget = new THREE.Vector3();
        ctrl.occlusionRayDirection = new THREE.Vector3();
        ctrl.transparencyIntersections = reusableIntersections;
        ctrl.currentOccludingObjects = reusableOccluders;
        ctrl.occludedObjects = occludedObjects;
        ctrl.isValidOcclusionObject = vi.fn((object: THREE.Object3D) => object === occluder);
        ctrl.makeObjectTransparent = makeObjectTransparent;
        ctrl.restoreObjectMaterial = restoreObjectMaterial;
        ctrl.raycaster = raycaster;

        callUpdateTransparencyOcclusion(ctrl);

        expect(raycaster.intersectObjects).toHaveBeenCalledWith([occluder], true, reusableIntersections);
        expect(reusableOccluders.has(stale)).toBe(false);
        expect(reusableOccluders.has(occluder)).toBe(true);
        expect(makeObjectTransparent).toHaveBeenCalledWith(occluder);
        expect(occludedObjects.has(occluder)).toBe(true);
    });
});

describe("CameraControl pointer lock cleanup", () => {
    it("removes the same pointer lock listener that it registers", () => {
        const ctrl = createControl(null);
        const pointerLockChangeHandler = vi.fn();
        const pointerManager = {unregisterHandler: vi.fn()};
        ctrl.usePointerLock = true;
        ctrl.pointerLockChangeHandler = pointerLockChangeHandler;
        ctrl.pointerManager = pointerManager;
        ctrl.mouseWheelHandler = vi.fn();
        ctrl.keyDownHandler = vi.fn();

        const addEventListener = vi.spyOn(document, "addEventListener");
        const removeEventListener = vi.spyOn(document, "removeEventListener");

        ctrl.initPointerLockEvents();
        ctrl.removeEventListeners();

        expect(addEventListener).toHaveBeenCalledWith("pointerlockchange", pointerLockChangeHandler);
        expect(removeEventListener).toHaveBeenCalledWith("pointerlockchange", pointerLockChangeHandler);
    });

    it("does not log unsupported pointer lock when requestPointerLock is available", async () => {
        const ctrl = createControl(null);
        const requestPointerLock = vi.fn(() => Promise.resolve());
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const bodyWithPointerLock = document.body as HTMLBodyElement & {
            requestPointerLock?: () => Promise<void>;
        };
        const previousDescriptor = Object.getOwnPropertyDescriptor(bodyWithPointerLock, "requestPointerLock");

        ctrl.usePointerLock = true;
        Object.defineProperty(bodyWithPointerLock, "requestPointerLock", {
            configurable: true,
            value: requestPointerLock,
        });

        try {
            await ctrl.requestPointerLock();
        } finally {
            if (previousDescriptor) {
                Object.defineProperty(bodyWithPointerLock, "requestPointerLock", previousDescriptor);
            } else {
                Reflect.deleteProperty(bodyWithPointerLock, "requestPointerLock");
            }
        }

        expect(requestPointerLock).toHaveBeenCalledTimes(1);
        expect(consoleError).not.toHaveBeenCalledWith("Pointer Lock is not supported");
    });
});
