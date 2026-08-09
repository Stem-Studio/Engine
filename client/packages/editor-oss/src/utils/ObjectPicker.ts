import {WebGLRenderer, Raycaster, Camera, Scene, Vector2, Object3D, type Intersection} from "three";
import type {WebGPURenderer} from "three/webgpu";

import {DetectDevice} from "./DetectDevice";
import {QualityManager} from "../core/quality/QualityManager";
import SceneObjectLookup from "./SceneObjectLookup";

export enum PickerType {
    CLICK = "click",
    HOVER = "hover",
}

type ObjectPickerCallback = (origin: Object3D | undefined | null, object: Object3D | undefined | null) => void;
type GPUPickerLike = {
    pickSize: number;
    pick(x: number, y: number, shouldPickObject?: unknown): Promise<number>;
    dispose(): void;
};
type GPUPickerClass = new (
    renderer: WebGLRenderer | WebGPURenderer,
    scene: Scene,
    camera: Camera,
    pickDistance?: number,
    debug?: boolean,
) => GPUPickerLike;

let gpuPickerClassPromise: Promise<GPUPickerClass> | null = null;

function loadGPUPickerClass(): Promise<GPUPickerClass> {
    if (!gpuPickerClassPromise) {
        gpuPickerClassPromise = import("../assets/js/gpupicker/gpupicker").then(
            module => module.GPUPicker as GPUPickerClass,
        );
    }
    return gpuPickerClassPromise;
}

function isWebGPURenderer(renderer: unknown): renderer is WebGPURenderer {
    return (
        typeof renderer === "object" &&
        renderer !== null &&
        "isWebGPURenderer" in renderer &&
        (renderer as {isWebGPURenderer?: unknown}).isWebGPURenderer === true
    );
}

export interface IObjectPicker {
    on(type: string, callback: ObjectPickerCallback): void;
    off(type: string, callback: ObjectPickerCallback): void;
    clear(): void;
    dispose(): void;
    update(): void;
    pickObject(type: string, x: number, y: number): void;
    updateRenderer(renderer: WebGLRenderer | WebGPURenderer): void;
}

class ObjectPicker implements IObjectPicker {
    private scene: Scene;
    private readonly sceneObjectLookup: SceneObjectLookup;
    private camera: Camera;
    private renderer: WebGLRenderer | WebGPURenderer;
    private gpuPicker: GPUPickerLike | null = null;
    private gpuPickerLoadToken = 0;
    private desiredPickDistance: number;
    private raycaster: Raycaster = new Raycaster(); // WebGL fallback
    private pointerNdc = new Vector2();
    private mousePosition = {x: 0, y: 0};
    private raycastHits: Array<Intersection<Object3D>> = [];
    private pickingInProgress = false;
    private callbacks: Map<string, Set<ObjectPickerCallback>> = new Map();
    viewPortRect: DOMRect;
    //move state
    private pointerMoved: boolean = false;
    private pointerClicked: boolean = false;
    private pointerX: number = 0;
    private pointerY: number = 0;
    private pointerEventsSupported = window.PointerEvent !== undefined;
    private eventListeners: Array<{type: string; handler: EventListenerOrEventListenerObject}> = [];

    constructor(
        renderer: WebGLRenderer | WebGPURenderer,
        scene: Scene,
        camera: Camera,
        viewPortRect: DOMRect,
        pickDistance: number = 1,
    ) {
        this.scene = scene;
        this.sceneObjectLookup = new SceneObjectLookup(scene);
        this.camera = camera;
        this.viewPortRect = viewPortRect;
        this.renderer = renderer;
        this.desiredPickDistance = pickDistance;
        this.loadGpuPicker(pickDistance);

        this.callbacks.set(PickerType.CLICK, new Set());
        this.callbacks.set(PickerType.HOVER, new Set());
        this.initMouseEventListeners();
    }

    public on(type: string, callback: ObjectPickerCallback) {
        if (!this.callbacks.has(type)) {
            this.callbacks.set(type, new Set());
        }
        this.callbacks.get(type)?.add(callback);
    }

    public off(type: string, callback: ObjectPickerCallback) {
        this.callbacks.get(type)?.delete(callback);
    }

    public clear() {
        for (const callbacks of this.callbacks.values()) {
            callbacks.clear();
        }
    }

    public dispose() {
        this.gpuPickerLoadToken++;
        this.gpuPicker?.dispose();
        this.gpuPicker = null;
        this.eventListeners.forEach(({type, handler}) => {
            document.removeEventListener(type, handler);
        });
        this.eventListeners = [];
    }

    public updateRenderer(renderer: WebGLRenderer | WebGPURenderer) {
        this.renderer = renderer;

        // Preserve the current pick size/distance, if any, before recreating the GPUPicker.
        const previousPickDistance = this.gpuPicker?.pickSize ?? this.desiredPickDistance;

        this.gpuPicker?.dispose();
        this.gpuPicker = null;
        this.loadGpuPicker(previousPickDistance);
    }

    private loadGpuPicker(pickDistance: number = this.desiredPickDistance) {
        this.desiredPickDistance = pickDistance;
        const token = ++this.gpuPickerLoadToken;

        if (!isWebGPURenderer(this.renderer)) {
            this.gpuPicker = null;
            return;
        }

        void loadGPUPickerClass()
            .then(GPUPicker => {
                if (token !== this.gpuPickerLoadToken || !isWebGPURenderer(this.renderer)) {
                    return;
                }

                try {
                    this.gpuPicker?.dispose();
                    this.gpuPicker = new GPUPicker(this.renderer, this.scene, this.camera, pickDistance);
                } catch {
                    this.gpuPicker = null;
                }
            })
            .catch(() => {
                if (token === this.gpuPickerLoadToken) {
                    this.gpuPicker = null;
                }
            });
    }

    private hasCallbacks(callbacks: Set<ObjectPickerCallback> | undefined) {
        return callbacks !== undefined && callbacks.size > 0;
    }

    private isInsideViewport(x: number, y: number) {
        const {left, top, width, height} = this.viewPortRect;
        if (width <= 0 || height <= 0) {
            return false;
        }
        return x >= left && x <= left + width && y >= top && y <= top + height;
    }

    private getMousePosition(x: number, y: number) {
        this.mousePosition.x = x - this.viewPortRect.left;
        this.mousePosition.y = y - this.viewPortRect.top;
        return this.mousePosition;
    }

    private initMouseEventListeners() {
        if (this.pointerEventsSupported) {
            this._addEventListener("pointermove", this.pointerMoveHandler as EventListener);
            this._addEventListener("pointerup", this.pointerUpHandler as EventListener);
        } else {
            this._addEventListener("mousemove", this.fallbackMouseMoveHandler as EventListener);
            this._addEventListener("mouseup", this.fallbackMouseUpHandler as EventListener);
            this._addEventListener("touchmove", this.fallbackTouchMoveHandler as EventListener);
            this._addEventListener("touchend", this.fallbackTouchEndHandler as EventListener);
        }
    }

    private _addEventListener(
        type: string,
        handler: EventListenerOrEventListenerObject,
        options?: AddEventListenerOptions,
    ) {
        document.addEventListener(type, handler as EventListener, options);
        this.eventListeners.push({type, handler: handler});
    }

    private pointerMoveHandler = (event: PointerEvent) => {
        this.pointerMoved = true;
        this.pointerX = event.clientX;
        this.pointerY = event.clientY;
    };

    private pointerUpHandler = (event: PointerEvent) => {
        // TODO: consider setting maximum distance/delay to consider it a click
        this.pointerClicked = true;
        this.pointerX = event.clientX;
        this.pointerY = event.clientY;
    };

    private fallbackMouseMoveHandler = (event: MouseEvent) => {
        this.pointerMoved = true;
        this.pointerX = event.clientX;
        this.pointerY = event.clientY;
    };

    private fallbackMouseUpHandler = (event: MouseEvent) => {
        this.pointerClicked = true;
        this.pointerX = event.clientX;
        this.pointerY = event.clientY;
    };

    private fallbackTouchMoveHandler = (event: TouchEvent) => {
        if (event.touches.length > 0) {
            const touch = event.touches[0]!;
            this.pointerMoved = true;
            this.pointerX = touch.clientX;
            this.pointerY = touch.clientY;
        }
    };

    private fallbackTouchEndHandler = (event: TouchEvent) => {
        if (event.changedTouches.length > 0) {
            const touch = event.changedTouches[0]!;
            this.pointerClicked = true;
            this.pointerX = touch.clientX;
            this.pointerY = touch.clientY;
        }
    };

    public update() {
        if (this.pickingInProgress) return;

        const hoverCallbacks = this.callbacks.get(PickerType.HOVER);
        const clickCallbacks = this.callbacks.get(PickerType.CLICK);

        if (this.pointerClicked) {
            this.pointerClicked = false;
            if (!this.hasCallbacks(clickCallbacks) && !this.hasCallbacks(hoverCallbacks)) {
                return;
            }
            const x = this.pointerX;
            const y = this.pointerY;
            this._doPick(PickerType.CLICK, x, y, resultObj => {
                // For click we also update hover callbacks with the same object
                if (resultObj) {
                    const sceneObj = this.getSceneObject(resultObj);
                    this.callCallbacks(clickCallbacks, resultObj, sceneObj);
                    this.callCallbacks(hoverCallbacks, resultObj, sceneObj);
                }
            });
        } else if (this.hasCallbacks(hoverCallbacks) && this.pointerMoved) {
            this.pointerMoved = false;
            this._doPick(PickerType.HOVER, this.pointerX, this.pointerY, resultObj => {
                if (resultObj) this.callCallbacks(hoverCallbacks, resultObj);
            });
        }
    }

    public pickObject(type: string, x: number, y: number) {
        this._doPick(type, x, y, origin => {
            if (!origin) return;
            const sceneObj = this.getSceneObject(origin);
            this.callCallbacks(this.callbacks.get(type), origin, sceneObj);
        });
    }

    private _doPick(_type: string, x: number, y: number, done: (origin: Object3D | null) => void) {
        if (!this.isInsideViewport(x, y)) {
            done(null);
            return;
        }

        const mousePos = this.getMousePosition(x, y);

        // GPU path
        if (this.gpuPicker) {
            const qualityManager = QualityManager.getInstance();
            const pixelRatio =
                Math.max(
                    1,
                    Math.min(
                        3,
                        (window.devicePixelRatio || 1) *
                            (qualityManager.getCurrentSettings().rendering.pixelRatio || 1),
                    ),
                ) * (DetectDevice.isMobile() ? 0.75 : 1);
            this.pickingInProgress = true;
            Promise.resolve(this.gpuPicker.pick(mousePos.x * pixelRatio, mousePos.y * pixelRatio, undefined))
                .then((objId: number) => {
                    if (objId) {
                        const origin = this.sceneObjectLookup.getById(objId);
                        done(origin);
                    } else {
                        done(null);
                    }
                })
                .catch(() => done(null))
                .finally(() => {
                    this.pickingInProgress = false;
                });
            return;
        }

        // WebGL fallback using Raycaster
        const ndcX = mousePos.x / this.viewPortRect.width * 2 - 1;
        const ndcY = -(mousePos.y / this.viewPortRect.height) * 2 + 1;
        this.pointerNdc.set(ndcX, ndcY);
        this.raycaster.setFromCamera(this.pointerNdc, this.camera);

        const hits = this.raycastHits;
        hits.length = 0;
        this.raycaster.intersectObjects(this.scene.children, true, hits);

        let picked: Object3D | null = null;
        for (let i = 0; i < hits.length; i++) {
            const object = hits[i]?.object;
            if (object?.userData?.isSelectable !== false) {
                picked = object ?? null;
                break;
            }
        }
        hits.length = 0;
        done(picked);
    }

    private callCallbacks(
        callbacks: Set<ObjectPickerCallback> | undefined,
        origin: Object3D | undefined | null,
        sceneObj?: Object3D | null,
    ) {
        if (callbacks && callbacks.size > 0 && origin) {
            sceneObj ??= this.getSceneObject(origin);
            callbacks.forEach(callback => callback(origin, sceneObj));
        }
    }

    private getSceneObject(obj: Object3D | undefined | null): Object3D | null {
        let ret: Object3D | undefined | null = obj;
        while (ret) {
            if (ret.parent && ret.parent.type === "Scene") {
                return ret;
            } else {
                ret = ret.parent;
            }
        }
        return null;
    }

    public setPickDistance(distance: number) {
        this.desiredPickDistance = distance;
        if (this.gpuPicker) {
            this.gpuPicker.pickSize = distance;
        }
    }
}

export default ObjectPicker;
