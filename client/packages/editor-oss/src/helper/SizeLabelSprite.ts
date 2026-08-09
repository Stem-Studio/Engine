import {Camera, CanvasTexture, LinearFilter, PerspectiveCamera, SRGBColorSpace, Sprite, SpriteMaterial, Vector2, Vector3} from "three";
import type {Object3DJSON} from "three";
import {convertFromMetersDisplay, getActiveDisplayUnit} from "./displayUnits";

export type SizeLabelAxis = "x" | "y" | "z";

export interface SizeLabelOptions {
    fontSize?: number;
    padding?: number;
    background?: string;
    color?: string;
    pixelHeight?: number;
    axis?: SizeLabelAxis;
}

const DEFAULTS: Required<Omit<SizeLabelOptions, "axis">> = {
    fontSize: 64,
    padding: 16,
    background: "rgba(20,20,20,0.85)",
    color: "#ffffff",
    pixelHeight: 0.036,
};

const formatLength = (value: number): string => {
    return value.toFixed(2);
};

/**
 * Sprite that displays a short text using a canvas texture. Sized in
 * world units relative to a desired pixel height; the parent should not
 * be non-uniformly scaled or the text will distort.
 */
export class SizeLabelSprite extends Sprite {
    private readonly _canvas: HTMLCanvasElement;
    private readonly _ctx: CanvasRenderingContext2D;
    private readonly _texture: CanvasTexture;
    private readonly _opts: Required<Omit<SizeLabelOptions, "axis">>;
    private _aspect = 1;
    private _pixelHeight: number;
    public readonly axis: SizeLabelAxis | null;
    public value = 0;

    constructor(options: SizeLabelOptions = {}) {
        const {axis = null, ...rest} = options;
        const opts = {...DEFAULTS, ...rest};
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 128;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("SizeLabelSprite: 2d context unavailable");
        const texture = new CanvasTexture(canvas);
        texture.colorSpace = SRGBColorSpace;
        texture.minFilter = LinearFilter;
        texture.magFilter = LinearFilter;
        const material = new SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            sizeAttenuation: false,
            toneMapped: false,
        });
        super(material);
        this.renderOrder = 9999;
        this.frustumCulled = false;
        this._canvas = canvas;
        this._ctx = ctx;
        this._texture = texture;
        this._opts = opts;
        this.axis = axis;
        this.userData.isObbSizeLabel = true;
        this._pixelHeight = opts.pixelHeight;
    }

    setText(text: string): void {
        const {fontSize, padding, background, color} = this._opts;
        const ctx = this._ctx;
        const font = `600 ${fontSize}px sans-serif`;
        ctx.font = font;
        const metrics = ctx.measureText(text);
        const textWidth = Math.ceil(metrics.width);
        const textHeight = fontSize;
        const w = textWidth + padding * 2;
        const h = textHeight + padding * 2;

        if (this._canvas.width !== w || this._canvas.height !== h) {
            this._canvas.width = w;
            this._canvas.height = h;
        }
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = background;
        const r = Math.min(16, h / 2);
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.lineTo(w - r, 0);
        ctx.quadraticCurveTo(w, 0, w, r);
        ctx.lineTo(w, h - r);
        ctx.quadraticCurveTo(w, h, w - r, h);
        ctx.lineTo(r, h);
        ctx.quadraticCurveTo(0, h, 0, h - r);
        ctx.lineTo(0, r);
        ctx.quadraticCurveTo(0, 0, r, 0);
        ctx.closePath();
        ctx.fill();
        ctx.font = font;
        ctx.fillStyle = color;
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        ctx.fillText(text, w / 2, h / 2);
        this._texture.needsUpdate = true;
        this._aspect = w / h;
        this._applyScale();
    }

    private _applyScale(): void {
        const h = this._pixelHeight;
        this.scale.set(h * this._aspect, h, 1);
    }

    setPixelHeight(h: number): void {
        if (Math.abs(this._pixelHeight - h) < 1e-5) return;
        this._pixelHeight = h;
        this._applyScale();
    }

    setOpacity(o: number): void {
        const mat = this.material;
        if (Math.abs(mat.opacity - o) < 1e-3) return;
        mat.opacity = o;
    }

    setLocalPosition(x: number, y: number, z: number): void {
        this.position.set(x, y, z);
    }

    dispose(): void {
        this._texture.dispose();
        (this.material).dispose();
    }

    toJSON(): Object3DJSON {
        this.updateMatrix();

        return {
            metadata: {version: 4.7, type: "Object", generator: "SizeLabelSprite.toJSON"},
            object: {
                uuid: this.uuid,
                type: this.type,
                name: this.name,
                visible: this.visible,
                layers: this.layers.mask,
                matrix: this.matrix.toArray(),
                up: this.up.toArray(),
                matrixAutoUpdate: this.matrixAutoUpdate,
                userData: {
                    ...this.userData,
                    axis: this.axis,
                    value: this.value,
                    isSizeLabelSprite: true,
                },
            },
        };
    }

    setSizeValue(value: number): void {
        const abs = Math.abs(value);
        this.value = abs;
        const axis = this.axis ? this.axis.toUpperCase() : "";
        const display = convertFromMetersDisplay(abs);
        const unit = getActiveDisplayUnit().label;
        const body = SizeLabelSprite.formatAxisSize(display);
        const text = axis ? `${axis} ${body}${unit ? " " + unit : ""}` : `${body}${unit ? " " + unit : ""}`;
        this.setText(text);
    }

    static formatAxisSize(value: number): string {
        return formatLength(Math.abs(value));
    }

    /**
     * NDC-space hit test for a sprite with sizeAttenuation:false.
     * Returns true if pointer (in NDC) is over the sprite as drawn.
     */
    hitTestNDC(pointerNDC: Vector2, camera: Camera): boolean {
        const center = _v.setFromMatrixPosition(this.matrixWorld).project(camera);
        if (center.z < -1 || center.z > 1) return false;
        const proj = (camera as PerspectiveCamera).projectionMatrix;
        const pxx = proj.elements[0];
        const pyy = proj.elements[5];
        const halfX = Math.abs(pxx) * this.scale.x * 0.5;
        const halfY = Math.abs(pyy) * this.scale.y * 0.5;
        const dx = pointerNDC.x - center.x;
        const dy = pointerNDC.y - center.y;
        return Math.abs(dx) <= halfX && Math.abs(dy) <= halfY;
    }

    /**
     * Returns screen-space NDC bounding rect of this sprite as drawn.
     */
    getNDCRect(camera: Camera, out: {cx: number; cy: number; hx: number; hy: number; z: number}): boolean {
        const center = _v.setFromMatrixPosition(this.matrixWorld).project(camera);
        if (center.z < -1 || center.z > 1) return false;
        const proj = (camera as PerspectiveCamera).projectionMatrix;
        out.cx = center.x;
        out.cy = center.y;
        out.hx = Math.abs(proj.elements[0]) * this.scale.x * 0.5;
        out.hy = Math.abs(proj.elements[5]) * this.scale.y * 0.5;
        out.z = center.z;
        return true;
    }
}

const _v = new Vector3();
