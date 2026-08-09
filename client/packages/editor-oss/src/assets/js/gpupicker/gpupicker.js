// GPUPicker.js — WebGPU only
//
// Usage:
//   import { GPUPicker } from './GPUPicker.js';
//   const picker = new GPUPicker(renderer, scene, camera, 5, true);
//   const id = await picker.pick(x, y, (obj) => obj.visible !== false);
//   const hit = scene.getObjectById(id); // id === 0 => no hit

import {uniform} from "three/tsl";
import {
    Color,
    Vector4,
    RenderTarget,
    NearestFilter,
    FrontSide,
    BackSide,
    DoubleSide,
    NoColorSpace,
    NoBlending,
} from "three";
import {NodeMaterial} from "three/webgpu";

import global from "../../../global";

export class GPUPicker {
    constructor(renderer, scene, camera, pickSize = 1, debug = false) {
        if (!renderer?.isWebGPURenderer) {
            throw new Error("GPUPicker requires WebGPURenderer.");
        }

        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;

        // Ensure pickSize * 4 (bytesPerRow) is multiple of 256 (WebGPU requirement for CopyTextureToBuffer)
        pickSize = Math.max(1, pickSize | 0);
        while (pickSize * 4 % 256 !== 0) pickSize++; // minimal growth
        this.pickSize = pickSize;

        this.target = new RenderTarget(this.pickSize, this.pickSize, {
            minFilter: NearestFilter,
            magFilter: NearestFilter,
        });
        this.target.texture.colorSpace = NoColorSpace;

        this.pixelBuffer = new Uint8Array(4 * this.pickSize * this.pickSize);
        this.clearColor = new Color(0xffffff); // white => "no hit"
        this.currClearColor = new Color();

        this.shouldPickObjectCB = undefined;
        this.nonSelectableIds = new Set();
        this.materialCache = [];

        this.debug = !!debug;
        if (this.debug) this._initDebugCanvas();
    }

    async pick(x, y, shouldPickObject) {
        if (global?.app && typeof global.app.on === "function") {
            // create a one-time listener id
            const listenerId = `gpupicker_${Math.random() * 1e9 | 0}`;
            return new Promise((resolve, reject) => {
                const handler = async () => {
                    // detach listener
                    try {
                        global.app.on(`beforeRender.${listenerId}`, null);
                    } catch {
                        // Listener may already be detached; ignore.
                    }

                    try {
                        const result = await this._doPick(x, y, shouldPickObject);
                        resolve(result);
                    } catch (err) {
                        reject(err);
                    }
                };

                // register one-time handler
                try {
                    global.app.on(`beforeRender.${listenerId}`, handler);
                } catch {
                    // If registering fails, fall back to immediate pick
                    this._doPick(x, y, shouldPickObject).then(resolve, reject);
                }
            });
        }

        // Fallback: no global app available — do an immediate pick
        return this._doPick(x, y, shouldPickObject);
    }

    // Internal implementation of the pick pass (previously the body of `pick`).
    async _doPick(x, y, shouldPickObject) {
        this.shouldPickObjectCB = shouldPickObject;
        this.nonSelectableIds.clear();

        const size = this._prepareViewOffsetAndBuffers(x, y);

        const {renderer, scene, camera, target, clearColor, currClearColor} = this;
        const prevRT = renderer.getRenderTarget();
        const prevAlpha = renderer.getClearAlpha();
        renderer.getClearColor(currClearColor);

        // // Draw the picking pass
        renderer.setRenderTarget(target);
        renderer.setClearColor(clearColor);
        renderer.clear();

        const restoreList = this._applyPickingMaterials();
        renderer.render(scene, camera);
        this._restoreMaterials(restoreList);

        let readbackPromise;
        try {
            readbackPromise = renderer.readRenderTargetPixelsAsync(target, 0, 0, size, size);
        } finally {
            renderer.setRenderTarget(prevRT);
            renderer.setClearColor(currClearColor, prevAlpha);
            camera.clearViewOffset();
        }

        const data = await readbackPromise;

        if (data && data.length === this.pixelBuffer.length) this.pixelBuffer.set(data);
        else if (data) this.pixelBuffer = new Uint8Array(data);

        // this._blitDebug(size);
        return this._scanForHit(size);
    }

    dispose() {
        this.target?.dispose();
        this.materialCache.length = 0;
        if (this.debugCanvas?.parentNode) {
            try {
                this.debugCanvas.parentNode.removeChild(this.debugCanvas);
            } catch {
                // Canvas may already be detached; ignore.
            }
        }
    }

    _prepareViewOffsetAndBuffers(x, y) {
        const {renderer, camera} = this;
        const w = renderer.domElement.width;
        const h = renderer.domElement.height;
        const size = Math.max(1, this.pickSize | 0);
        const px = Math.max(0, Math.min(w - 2 * size, x - size));
        const py = Math.max(0, Math.min(h - 2 * size, y - size));

        if (this.target.width !== size || this.target.height !== size) {
            this.target.setSize(size, size);
            this.pixelBuffer = new Uint8Array(4 * size * size);
        }

        camera.setViewOffset(w, h, px, py, 2 * size, 2 * size);
        return size;
    }

    _bitIndexFor(object, material) {
        const useMorphing = !!material.morphTargets && !!object.geometry?.morphAttributes?.position?.length ? 1 : 0;
        const useSkinning = object.isSkinnedMesh ? 1 : 0;
        const useInstancing = object.isInstancedMesh ? 1 : 0;
        const frontSide = material.side === FrontSide ? 1 : 0;
        const backSide = material.side === BackSide ? 1 : 0;
        const doubleSide = material.side === DoubleSide ? 1 : 0;
        const sprite = object.isSprite ? 1 : 0;
        const sizeAttenuation = material.sizeAttenuation ? 1 : 0;
        return (
            useMorphing << 0 |
            useSkinning << 1 |
            useInstancing << 2 |
            frontSide << 3 |
            backSide << 4 |
            doubleSide << 5 |
            sprite << 6 |
            sizeAttenuation << 7
        );
    }

    _getPickingMaterialFor(object) {
        const srcMat = Array.isArray(object.material) ? object.material[0] : object.material;
        const index = this._bitIndexFor(object, srcMat);
        let m = this.materialCache[index];
        if (m) return m;
        const nodeMat = new NodeMaterial();
        const idUniform = uniform(new Vector4(1, 1, 1, 1));
        nodeMat.colorNode = idUniform.xyz;
        nodeMat.opacityNode = idUniform.w;
        nodeMat.side = srcMat.side;
        nodeMat.depthTest = true;
        nodeMat.depthWrite = true;
        nodeMat.transparent = false;
        nodeMat.toneMapped = false;
        nodeMat.fog = false;
        nodeMat.lights = false;
        nodeMat.blending = NoBlending;
        nodeMat.skinning = object.isSkinnedMesh === true;
        nodeMat.morphTargets = !!srcMat.morphTargets;
        Object.defineProperty(nodeMat, "__gpupicker_idUniform", {value: idUniform, enumerable: false});
        this.materialCache[index] = nodeMat;
        return nodeMat;
    }

    _applyPickingMaterials() {
        const restoreList = [];
        const shouldPickObject = this.shouldPickObjectCB;

        const stack = [];
        const rootChildren = this.scene.children;
        for (let i = rootChildren.length - 1; i >= 0; i--) {
            stack.push({object: rootChildren[i], inheritedNonSelectable: false});
        }

        while (stack.length) {
            const entry = stack.pop();
            const object = entry.object;
            if (!object) continue;

            const isVisible = object.visible !== false;
            if (!isVisible) {
                continue;
            }

            const userData = object.userData;
            const selfNonSelectable = !!(userData && (userData.isStatic === true || userData.isSelectable === false));
            const effectiveNonSelectable = entry.inheritedNonSelectable || selfNonSelectable;

            if (effectiveNonSelectable) {
                this.nonSelectableIds.add(object.id >>> 0);
            }

            let canApply = true;
            if (object.isBatchedMesh || object.isSprite) {
                canApply = false;
            }

            if (canApply) {
                const shouldApply = !shouldPickObject || shouldPickObject(object);
                if (shouldApply && (object.isMesh || object.isSkinnedMesh || object.isInstancedMesh || object.isPoints)) {
                    const original = {object, material: object.material, onBeforeRender: object.onBeforeRender};
                    const pickingMat = this._getPickingMaterialFor(object);
                    const idVec4 = new Vector4();
                    object.onBeforeRender = () => {
                        const objId = object.id >>> 0;
                        idVec4.set(
                            (objId >>> 24 & 255) / 255,
                            (objId >>> 16 & 255) / 255,
                            (objId >>> 8 & 255) / 255,
                            (objId & 255) / 255,
                        );
                        pickingMat.__gpupicker_idUniform.value.copy(idVec4);
                    };
                    object.material = pickingMat;
                    restoreList.push(original);
                }
            }

            const children = object.children;
            if (!children || children.length === 0) {
                continue;
            }
            for (let i = children.length - 1; i >= 0; i--) {
                stack.push({object: children[i], inheritedNonSelectable: effectiveNonSelectable});
            }
        }

        return restoreList;
    }

    _restoreMaterials(restoreList) {
        for (let i = 0; i < restoreList.length; i++) {
            const {object, material, onBeforeRender} = restoreList[i];
            object.material = material;
            object.onBeforeRender = onBeforeRender;
        }
    }

    _scanForHit(size) {
        const buf = this.pixelBuffer;
        const half = size / 2 | 0;
        const getValAt = (ix, iy) => {
            const idx = (iy * size + ix) * 4;
            return (buf[idx] << 24) + (buf[idx + 1] << 16) + (buf[idx + 2] << 8) + buf[idx + 3] >>> 0;
        };
        const cx = half,
            cy = half;
        for (let r = 0; r <= half; r++) {
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                    const ix = cx + dx,
                        iy = cy + dy;
                    if (ix < 0 || iy < 0 || ix >= size || iy >= size) continue;
                    const val = getValAt(ix, iy);
                    if (val !== 0xffffffff && !this.nonSelectableIds.has(val)) {
                        return val;
                    }
                }
            }
        }
        return 0;
    }

    _initDebugCanvas() {
        try {
            const c = document.createElement("canvas");
            const ctx = c.getContext("2d");
            c.style.position = "fixed";
            c.style.left = "10px";
            c.style.bottom = "10px";
            c.style.zIndex = "2147483647";
            c.style.background = "transparent";
            c.style.border = "2px solid rgba(0,0,0,0.6)";
            c.style.pointerEvents = "none";
            c.width = this.pickSize;
            c.height = this.pickSize;
            const displaySize = Math.max(100, this.pickSize * 1);
            c.style.width = displaySize + "px";
            c.style.height = displaySize + "px";
            if (ctx) {
                ctx.imageSmoothingEnabled = false;
                ctx.mozImageSmoothingEnabled = false;
                ctx.webkitImageSmoothingEnabled = false;
            }
            if (document?.body) document.body.appendChild(c);
            else window.addEventListener("DOMContentLoaded", () => document.body?.appendChild(c), {once: true});
            this.debugCanvas = c;
            this.debugCtx = ctx;
        } catch {
            this.debugCanvas = null;
            this.debugCtx = null;
        }
    }

    _blitDebug(size) {
        const {debugCtx: ctx, debugCanvas: c, pixelBuffer: src} = this;
        if (!ctx || !c) return;
        if (c.width !== size || c.height !== size) {
            c.width = size;
            c.height = size;
            c.style.width = size + "px";
            c.style.height = size + "px";
        }
        try {
            const imgData = ctx.createImageData(size, size);
            const dst = imgData.data;
            const rowBytes = size * 4;
            for (let yy = 0; yy < size; yy++) {
                const srcRow = (size - 1 - yy) * rowBytes; // flip Y
                dst.set(src.subarray(srcRow, srcRow + rowBytes), yy * rowBytes);
            }
            ctx.clearRect(0, 0, size, size);
            ctx.putImageData(imgData, 0, 0);
            const cx = size / 2 | 0,
                cy = size / 2 | 0;
            ctx.strokeStyle = "rgba(255,255,255,0.9)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx - 2, cy);
            ctx.lineTo(cx + 2, cy);
            ctx.moveTo(cx, cy - 2);
            ctx.lineTo(cx, cy + 2);
            ctx.stroke();
        } catch {
            for (let yy = 0; yy < size; yy++) {
                for (let xx = 0; xx < size; xx++) {
                    const i = (yy * size + xx) * 4;
                    ctx.fillStyle = `rgba(${src[i]},${src[i + 1]},${src[i + 2]},${src[i + 3] / 255})`;
                    ctx.fillRect(xx, yy, 1, 1);
                }
            }
        }
    }
}
