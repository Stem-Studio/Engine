
/**
 * Module: WebVR.js
 * Purpose: Contains logic for web vr.
 */


import {BufferGeometry, Group, Line, Vector3} from "three";
import {traverseObjectDepthFirst} from "../../utils/SceneTraverser";
import PlayerComponent from "./PlayerComponent";

const CONTROLLER_LINE_POINTS = [
    new Vector3(0, 0, 0),
    new Vector3(0, 0, -1),
];

class WebVR extends PlayerComponent {
    constructor(app) {
        super(app);
        this.onConnected = this.onConnected.bind(this);
        this.onDisconnected = this.onDisconnected.bind(this);
        this.onSelectStart = this.onSelectStart.bind(this);
        this.onSelectEnd = this.onSelectEnd.bind(this);
        this.controllerListeners = [];
        this.controlsGroup = null;
        this.ownedObjects = [];
        this.createGeneration = 0;
        this.disposed = false;
    }

    async create(scene, camera, renderer) {
        if (!this.app.options.enableVR) {
            return;
        }
        this.cleanupControlsGroup();
        this.disposed = false;
        const generation = ++this.createGeneration;
        const [{default: VRButton}, {default: XRControllerModelFactory}, {XRHandModelFactory}] = await Promise.all([
            import("../../webvr/VRButton"),
            import("../../webvr/XRControllerModelFactory"),
            import("../../webvr/XRHandModelFactory"),
        ]);
        if (generation !== this.createGeneration || this.disposed) {
            return;
        }

        if (!this.vrButton) {
            this.vrButton = VRButton.createButton(renderer);
        }
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;

        renderer.xr.enabled = true;
        this.app.container.appendChild(this.vrButton);

        // group
        const group = new Group();
        group.name = "vr-controls";
        scene.add(group);
        this.controlsGroup = group;

        // controllers
        const controller1 = renderer.xr.getController(0);
        this.addControllerListener(controller1, "connected", this.onConnected);
        this.addControllerListener(controller1, "disconnected", this.onDisconnected);
        this.addControllerListener(controller1, "selectstart", this.onSelectStart);
        this.addControllerListener(controller1, "selectend", this.onSelectEnd);
        group.add(controller1);

        const controller2 = renderer.xr.getController(1);
        this.addControllerListener(controller2, "connected", this.onConnected);
        this.addControllerListener(controller2, "disconnected", this.onDisconnected);
        this.addControllerListener(controller2, "selectstart", this.onSelectStart);
        this.addControllerListener(controller2, "selectend", this.onSelectEnd);
        group.add(controller2);

        this.addOwnedObject(controller1, this.createControllerLine());
        this.addOwnedObject(controller2, this.createControllerLine());

        if (generation !== this.createGeneration || this.disposed || this.controlsGroup !== group) {
            return;
        }

        const controllerModelFactory = new XRControllerModelFactory();
        const handModelFactory = new XRHandModelFactory().setPath("./models/fbx/");

        // Hand 1
        const controllerGrip1 = renderer.xr.getControllerGrip(0);
        this.addOwnedObject(controllerGrip1, controllerModelFactory.createControllerModel(controllerGrip1));
        group.add(controllerGrip1);

        const hand1 = renderer.xr.getHand(0);
        this.addOwnedObject(hand1, handModelFactory.createHandModel(hand1, "oculus")); // spheres, boxes, oculus
        group.add(hand1);

        // Hand 2
        const controllerGrip2 = renderer.xr.getControllerGrip(1);
        this.addOwnedObject(controllerGrip2, controllerModelFactory.createControllerModel(controllerGrip2));
        group.add(controllerGrip2);

        const hand2 = renderer.xr.getHand(1);
        this.addOwnedObject(hand2, handModelFactory.createHandModel(hand2, "oculus")); // spheres, boxes, oculus
        group.add(hand2);
    }

    createControllerLine() {
        const geometry = new BufferGeometry().setFromPoints(CONTROLLER_LINE_POINTS);
        const line = new Line(geometry);
        line.name = "line";
        line.scale.z = 5;
        return line;
    }

    addControllerListener(controller, eventName, handler) {
        controller.addEventListener(eventName, handler);
        this.controllerListeners.push([controller, eventName, handler]);
    }

    addOwnedObject(parent, object) {
        parent.add(object);
        this.ownedObjects.push(object);
    }

    onConnected(event) {
        // var setting = this.app.options.vrSetting;
        // var vrCamera = this.app.renderer.xr.getCamera(this.app.camera);
        // vrCamera.position.set(setting.cameraPosX, setting.cameraPosY, setting.cameraPosZ);
        // vrCamera.cameras.forEach(camera => {
        //     camera.position.copy(vrCamera.position);
        // });
        this.app.call("vrConnected", this, event);
    }

    onDisconnected(event) {
        this.app.call("vrDisconnected", this, event);
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh = null;
        }
    }

    onSelectStart(event) {
        this.app.call("vrSelectStart", this, event);
    }

    onSelectEnd(event) {
        this.app.call("vrSelectEnd", this, event);
    }

    update() {}

    dispose() {
        this.disposed = true;
        this.createGeneration++;
        this.cleanupControlsGroup();

        if (this.renderer?.xr) {
            this.renderer.xr.enabled = false;
        }

        if (this.vrButton) {
            if (this.vrButton.parentNode) {
                this.vrButton.parentNode.removeChild(this.vrButton);
            } else if (this.app.container?.contains?.(this.vrButton)) {
                this.app.container.removeChild(this.vrButton);
            }
            delete this.vrButton;
        }

        this.scene = null;
        this.camera = null;
        this.renderer = null;
    }

    cleanupControlsGroup() {
        this.controllerListeners.forEach(([controller, eventName, handler]) => {
            controller.removeEventListener(eventName, handler);
        });
        this.controllerListeners.length = 0;

        this.ownedObjects.forEach(object => {
            this.disposeObjectResources(object);
            object.removeFromParent();
        });
        this.ownedObjects.length = 0;

        if (this.controlsGroup) {
            this.disposeObjectResources(this.controlsGroup);
            this.controlsGroup.removeFromParent();
            this.controlsGroup = null;
        }
    }

    disposeObjectResources(root) {
        const geometries = new Set();
        const materials = new Set();
        traverseObjectDepthFirst(root, object => {
            if (object.geometry) {
                geometries.add(object.geometry);
            }
            const material = object.material;
            if (Array.isArray(material)) {
                material.forEach(entry => materials.add(entry));
            } else if (material) {
                materials.add(material);
            }
        });
        geometries.forEach(geometry => geometry.dispose?.());
        materials.forEach(material => material.dispose?.());
    }
}

export default WebVR;
