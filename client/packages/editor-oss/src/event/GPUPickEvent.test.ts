import {afterEach, describe, expect, it, vi} from "vitest";
import * as THREE from "three";

import global from "../global";
import GPUPickEvent from "./GPUPickEvent";

function createApp() {
    const domElement = document.createElement("canvas");
    Object.defineProperties(domElement, {
        clientWidth: {value: 100},
        clientHeight: {value: 100},
    });

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 10, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const orthCamera = new THREE.OrthographicCamera();
    const app = {
        mode: "edit",
        storage: {selectMode: "whole"},
        editor: {
            renderer: {domElement},
            view: "perspective",
            camera,
            orthCamera,
            scene,
            gpuPickNum: 1,
        },
        on: vi.fn(),
        call: vi.fn(),
    };

    return app;
}

describe("GPUPickEvent", () => {
    const previousApp = global.app;

    afterEach(() => {
        global.app = previousApp;
        vi.restoreAllMocks();
    });

    it("reuses its fallback raycast buffer and emits the selected object", async () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        app.editor.scene.add(mesh);
        const pickEvent = new GPUPickEvent();
        pickEvent.isIn = true;
        pickEvent.waitTime = 0;
        pickEvent.offsetX = 50;
        pickEvent.offsetY = 50;
        const hitPoint = new THREE.Vector3(1, 2, 3);
        const hit = {object: mesh, distance: 7, point: hitPoint} as THREE.Intersection;

        const intersectObjects = vi.spyOn(pickEvent.raycaster, "intersectObjects").mockImplementation(
            (_objects: THREE.Object3D[], _recursive?: boolean, target?: THREE.Intersection[]) => {
                expect(target).toBe(pickEvent.intersections);
                target?.push(hit);
                return target ?? [hit];
            },
        );

        await pickEvent.onAfterRender();

        expect(intersectObjects).toHaveBeenCalledWith(app.editor.scene.children, true, pickEvent.intersections);
        expect(app.call).toHaveBeenCalledWith(
            "gpuPick",
            pickEvent,
            expect.objectContaining({
                object: mesh,
                point: pickEvent.world,
                distance: 7,
            }),
        );
        expect(pickEvent.world.equals(hitPoint)).toBe(true);
    });

    it("skips repeated pick passes until the pointer or scene is dirty again", async () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        app.editor.scene.add(mesh);
        const pickEvent = new GPUPickEvent();
        pickEvent.isIn = true;
        pickEvent.waitTime = 0;
        pickEvent.offsetX = 50;
        pickEvent.offsetY = 50;
        const hit = {object: mesh, distance: 7, point: new THREE.Vector3(1, 2, 3)} as THREE.Intersection;

        const intersectObjects = vi.spyOn(pickEvent.raycaster, "intersectObjects").mockImplementation(
            (_objects: THREE.Object3D[], _recursive?: boolean, target?: THREE.Intersection[]) => {
                target?.push(hit);
                return target ?? [hit];
            },
        );

        await pickEvent.onAfterRender();
        await pickEvent.onAfterRender();

        expect(intersectObjects).toHaveBeenCalledTimes(1);
        expect(app.call).toHaveBeenCalledTimes(1);

        pickEvent.onMouseMove({target: app.editor.renderer.domElement, offsetX: 51, offsetY: 50} as unknown as MouseEvent);
        await pickEvent.onAfterRender();

        expect(intersectObjects).toHaveBeenCalledTimes(2);
        expect(app.call).toHaveBeenCalledTimes(2);

        pickEvent.markPickDirty();
        await pickEvent.onAfterRender();

        expect(intersectObjects).toHaveBeenCalledTimes(3);
        expect(app.call).toHaveBeenCalledTimes(3);
    });

    it("subscribes scene and camera changes as GPU pick dirty signals", () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const pickEvent = new GPUPickEvent();

        pickEvent.start();

        expect(app.on).toHaveBeenCalledWith(`cameraChanged.${pickEvent.id}`, pickEvent.markPickDirty);
        expect(app.on).toHaveBeenCalledWith(`viewChanged.${pickEvent.id}`, pickEvent.markPickDirty);
        expect(app.on).toHaveBeenCalledWith(`objectChanged.${pickEvent.id}`, pickEvent.markPickDirty);
        expect(app.on).toHaveBeenCalledWith(`objectUpdated.${pickEvent.id}`, pickEvent.markPickDirty);
        expect(app.on).toHaveBeenCalledWith(`sceneGraphChanged.${pickEvent.id}`, pickEvent.markPickDirty);

        pickEvent.stop();

        expect(app.on).toHaveBeenCalledWith(`cameraChanged.${pickEvent.id}`, null);
        expect(app.on).toHaveBeenCalledWith(`viewChanged.${pickEvent.id}`, null);
        expect(app.on).toHaveBeenCalledWith(`objectChanged.${pickEvent.id}`, null);
        expect(app.on).toHaveBeenCalledWith(`objectUpdated.${pickEvent.id}`, null);
        expect(app.on).toHaveBeenCalledWith(`sceneGraphChanged.${pickEvent.id}`, null);
    });

    it("reuses its miss world point when fallback raycast hits nothing", async () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const pickEvent = new GPUPickEvent();
        pickEvent.isIn = true;
        pickEvent.waitTime = 0;
        pickEvent.offsetX = 50;
        pickEvent.offsetY = 50;

        vi.spyOn(pickEvent.raycaster, "intersectObjects").mockImplementation(
            (_objects: THREE.Object3D[], _recursive?: boolean, target?: THREE.Intersection[]) => target ?? [],
        );
        vi.spyOn(pickEvent.raycaster.ray, "intersectPlane").mockImplementation((_plane, target) => {
            target?.set(0, 0, 0);
            return target ?? null;
        });

        await pickEvent.onAfterRender();

        expect(app.call).toHaveBeenCalledWith(
            "gpuPick",
            pickEvent,
            expect.objectContaining({
                object: null,
                point: pickEvent.world,
            }),
        );
        expect(pickEvent.intersections).toHaveLength(0);
    });

    it("skips helper hits using the shared selection rules", async () => {
        const app = createApp();
        global.app = app as unknown as typeof global.app;
        const helperMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        helperMesh.userData.isSceneHelper = true;
        const selectableMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        app.editor.scene.add(helperMesh, selectableMesh);
        const pickEvent = new GPUPickEvent();
        pickEvent.isIn = true;
        pickEvent.waitTime = 0;
        pickEvent.offsetX = 50;
        pickEvent.offsetY = 50;
        const helperHit = {
            object: helperMesh,
            distance: 1,
            point: new THREE.Vector3(1, 0, 0),
        } as THREE.Intersection;
        const selectableHit = {
            object: selectableMesh,
            distance: 2,
            point: new THREE.Vector3(2, 0, 0),
        } as THREE.Intersection;

        vi.spyOn(pickEvent.raycaster, "intersectObjects").mockImplementation(
            (_objects: THREE.Object3D[], _recursive?: boolean, target?: THREE.Intersection[]) => {
                target?.push(helperHit, selectableHit);
                return target ?? [helperHit, selectableHit];
            },
        );

        await pickEvent.onAfterRender();

        expect(app.call).toHaveBeenCalledWith(
            "gpuPick",
            pickEvent,
            expect.objectContaining({
                object: selectableMesh,
                distance: 2,
            }),
        );
        expect(pickEvent.world.equals(selectableHit.point)).toBe(true);
    });
});
