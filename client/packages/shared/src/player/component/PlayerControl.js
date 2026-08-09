import {FlyControls} from "three/addons/controls/FlyControls.js";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import {PointerLockControls} from "three/addons/controls/PointerLockControls.js";
import {TrackballControls} from "three/addons/controls/TrackballControls.js";

import PlayerComponent from "./PlayerComponent";
import PackageManager from "../../package/PackageManager";
import {CAMERA_TYPES} from "../../types/editor";

class PlayerControl extends PlayerComponent {
    constructor(app) {
        super(app);
        this._packageManager = null;
        this.require = names => this.packageManager.require(names);

        this.control = null;
        this.input = null;
    }

    get packageManager() {
        if (this._packageManager === null) {
            this._packageManager = new PackageManager();
        }

        return this._packageManager;
    }

    set packageManager(packageManager) {
        this._packageManager = packageManager;
    }

    create(physics, scene, camera, renderer, player) {
        const cameraData = camera.userData.cameraData;
        const type = cameraData?.cameraType || CAMERA_TYPES.THIRD_PERSON;
        return this._createControl(type, physics, scene, camera, renderer, player);
    }

    _createControl(type, input, physics, scene, camera, renderer, player) {
        return new Promise((resolve, reject) => {
            console.log("Control type selectedModelName:", camera.userData);
            const cameraData = camera.userData.cameraData;
            switch (type) {
                case "FlyControls": {
                    this.control = new FlyControls(camera, renderer.domElement);
                    if (cameraData.flyOptions) {
                        Object.assign(this.control, cameraData.flyOptions);
                    }
                    resolve();
                    break;
                }
                case "PointerLockControls": {
                    this.control = new PointerLockControls(camera, renderer.domElement);
                    if (cameraData.pointerLockOptions) {
                        Object.assign(this.control, cameraData.pointerLockOptions);

                        if (this.control.isLocked) {
                            this.control.lock();
                        } else {
                            this.control.unlock();
                        }
                    }
                    resolve();
                    break;
                }
                case "TrackballControls": {
                    this.control = new TrackballControls(camera, renderer.domElement);
                    if (cameraData.trackballOptions) {
                        Object.assign(this.control, cameraData.trackballOptions);
                    }
                    resolve();
                    break;
                }
                // ANDREI: This should be handled by behaviors, by attaching custom control to this.control
                //TODO CharacterControls will be renamed to accommodate consolidated control code
                case CAMERA_TYPES.FORTNITE:
                case CAMERA_TYPES.FIRST_PERSON:
                case CAMERA_TYPES.THIRD_PERSON: {
                    new CharacterControls(
                        input,
                        physics,
                        scene,
                        camera,
                        renderer,
                        player,
                        renderer.domElement,
                    )
                        .create()
                        .then(control => {
                            this.control = control;
                            resolve();
                        })
                        .catch(e => {
                            console.error("Error", e);
                            reject(e);
                        });
                    break;
                }
                case CAMERA_TYPES.VEHICLE:
                    console.warn("Vehicle control type is deprecated. Use the vehicle behavior pack instead.");
                    reject("Vehicle control type is not supported");
                    break;

                case "OrbitControls": {
                    this.control = new OrbitControls(camera, renderer.domElement);
                    if (camera.userData.cameraData.orbitOptions) {
                        Object.assign(this.control, camera.userData.cameraData.orbitOptions);
                    }
                    resolve();
                    break;
                }
                default: {
                    console.error("Unsupported control type: " + type);
                    reject("Unsupported control type: " + type);
                }
            }
        });
    }

    update(clock, deltaTime) {
        if (this.input) {
            this.input.update();
        }

        if (this.control && this.control.update) {
            this.control.update(deltaTime);
        }
    }

    dispose() {
        if (this.control) {
            this.control.dispose();
            this.control = null;
        }

        if (this.input) {
            this.input.dispose();
            this.input = null;
        }
    }
}

export default PlayerControl;
