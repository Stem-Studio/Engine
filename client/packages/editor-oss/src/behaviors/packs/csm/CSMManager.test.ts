import {DirectionalLight, Group, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Scene, SphereGeometry} from "three";
import {CSMShadowNode} from "three/addons/csm/CSMShadowNode.js";
import {afterEach, describe, expect, it, vi} from "vitest";

import global from "@stem/editor-oss/global";
import {CSMManager, ExtendedCSMShadowNode} from "./CSMManager";

const addDeepObjectChain = (root: Object3D, depth = 12_000): Object3D => {
    let current = root;

    for (let i = 0; i < depth; i++) {
        const child = new Group();
        current.add(child);
        current = child;
    }

    return current;
};

describe("CSMManager", () => {
    const previousApp = global.app;

    afterEach(() => {
        global.app = previousApp;
        vi.restoreAllMocks();
        CSMManager.instance.disableCSM();
    });

    it("invalidates materials in deep scenes without recursive Object3D traversal", () => {
        const scene = new Scene();
        const leaf = addDeepObjectChain(scene);
        const material = new MeshBasicMaterial();
        const mesh = new Mesh(new SphereGeometry(1, 4, 2), material);
        leaf.add(mesh);
        global.app = {scene} as never;

        const initialVersion = material.version;
        const traverseSpy = vi.spyOn(scene, "traverse");

        expect(() => (CSMManager.instance as unknown as {invalidateSceneMaterials: () => void}).invalidateSceneMaterials())
            .not.toThrow();

        expect(material.version).toBeGreaterThan(initialVersion);
        expect(traverseSpy).not.toHaveBeenCalled();
    });

    it("only refreshes cascade frustums when projection or CSM inputs change", () => {
        const manager = CSMManager.instance as unknown as {
            shouldRefreshFrustums: (csm: unknown, camera: unknown) => boolean;
        };
        const csm = {
            maxFar: 130,
            cascades: 3,
            mode: "practical",
            fade: false,
            lightMargin: 200,
            customSplitsCallback: undefined as (() => void) | undefined,
        };
        const camera = {
            isPerspectiveCamera: true,
            near: 1,
            far: 1000,
            fov: 60,
            aspect: 16 / 9,
            zoom: 1,
        };

        expect(manager.shouldRefreshFrustums(csm, camera)).toBe(true);
        expect(manager.shouldRefreshFrustums(csm, camera)).toBe(false);

        camera.aspect = 1;
        expect(manager.shouldRefreshFrustums(csm, camera)).toBe(true);

        csm.maxFar = 180;
        expect(manager.shouldRefreshFrustums(csm, camera)).toBe(true);
        expect(manager.shouldRefreshFrustums(csm, camera)).toBe(false);
    });

    it("refreshes when the effective projection changes through a view offset", () => {
        const manager = CSMManager.instance as unknown as {
            shouldRefreshFrustums: (csm: unknown, camera: unknown) => boolean;
        };
        const csm = {
            maxFar: 130,
            cascades: 3,
            mode: "practical",
            fade: false,
            lightMargin: 200,
            customSplitsCallback: undefined as (() => void) | undefined,
        };
        const camera = new PerspectiveCamera(60, 16 / 9, 1, 1000);
        camera.updateProjectionMatrix();

        expect(manager.shouldRefreshFrustums(csm, camera)).toBe(true);
        expect(manager.shouldRefreshFrustums(csm, camera)).toBe(false);

        camera.setViewOffset(1920, 1080, 240, 0, 1680, 1080);
        camera.updateProjectionMatrix();
        expect(manager.shouldRefreshFrustums(csm, camera)).toBe(true);
        expect(manager.shouldRefreshFrustums(csm, camera)).toBe(false);

        camera.filmOffset = 12;
        expect(manager.shouldRefreshFrustums(csm, camera)).toBe(true);
        expect(manager.shouldRefreshFrustums(csm, camera)).toBe(false);

        csm.customSplitsCallback = () => {};
        expect(manager.shouldRefreshFrustums(csm, camera)).toBe(true);
    });

    it("gates the real update path and invalidates after projection changes", () => {
        const manager = CSMManager.instance as unknown as {
            csm: any;
            currentLight: DirectionalLight;
            update: () => void;
        };
        const camera = new PerspectiveCamera(60, 16 / 9, 1, 1000);
        camera.updateProjectionMatrix();
        const updateFrustums = vi.fn();
        const csm = {
            camera,
            mainFrustum: {},
            maxFar: 6,
            cascades: 3,
            mode: "practical",
            fade: false,
            lightMargin: 200,
            lights: [],
            updateFrustums,
            dispose: vi.fn(),
        };
        const light = new DirectionalLight();
        light.castShadow = true;
        global.app = {camera, call: vi.fn()} as never;
        manager.csm = csm;
        manager.currentLight = light;

        manager.update();
        manager.update();
        expect(updateFrustums).toHaveBeenCalledTimes(1);

        camera.setViewOffset(1920, 1080, 240, 0, 1680, 1080);
        camera.updateProjectionMatrix();
        manager.update();
        expect(updateFrustums).toHaveBeenCalledTimes(2);
    });

    it("skips stable cascade light placement until camera inputs change", () => {
        const parent = new Group();
        const light = new DirectionalLight();
        const cascade = new DirectionalLight();
        parent.add(light, light.target, cascade, cascade.target);

        const camera = new PerspectiveCamera(60, 1, 0.1, 100);
        camera.updateMatrixWorld(true);
        const node = new ExtendedCSMShadowNode(light, {cascades: 1});
        const internals = node as unknown as {
            camera: PerspectiveCamera;
            lights: DirectionalLight[];
            frustums: unknown[];
        };
        internals.camera = camera;
        internals.lights = [cascade];
        internals.frustums = [];
        const upstreamUpdate = vi.spyOn(CSMShadowNode.prototype, "updateBefore");

        node.updateBefore();
        node.updateBefore();
        expect(upstreamUpdate).toHaveBeenCalledTimes(1);

        camera.position.x = 1;
        camera.updateMatrixWorld(true);
        node.updateBefore();
        expect(upstreamUpdate).toHaveBeenCalledTimes(2);

        node.dispose();
    });

});
