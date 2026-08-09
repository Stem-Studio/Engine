import {parseGIF, decompressFrames} from "gifuct-js";
import type {ParsedFrame, ParsedGif} from "gifuct-js";
import * as THREE from "three";

import global from "../global";
/**
 * Cache for the loaded gifs
 */
const $loaders: {[url: string]: GifData} = {};

const getGif = (url: string): GifData => {
    $loaders[url] ??= new GifData(url);

    return $loaders[url];
};

type GifEvents = {
    loaded: THREE.Event<string, GifData>;
    error: THREE.Event<string, GifData> & {message: string};
};

type GifAnimationClock = {
    getElapsedTime(): number;
};

/**
 * In charge to handle the load operation of the gif's data.
 */
class GifData extends THREE.EventDispatcher<GifEvents> {
    private _gif: ParsedGif | null;
    private _frames: ParsedFrame[];
    private _failed: boolean;
    private _isLoading: boolean;

    constructor(public readonly url: string) {
        super();
        this._gif = null;
        this._frames = [];
        this._failed = false;
        this._isLoading = false;

        this.load();
    }

    get isLoading() {
        return this._isLoading;
    }

    get hasFailed() {
        return this._failed;
    }

    private load() {
        this._isLoading = true;
        this._failed = false;

        void fetch(this.url)
            .then(resp => resp.arrayBuffer())
            .then(buff => {
                this._gif = parseGIF(buff);
                this._frames = decompressFrames(this._gif, true);
                this._isLoading = false;

                this.dispatchEvent({type: "loaded", target: this});
            })

            .catch(err => {
                this._failed = true;
                this._isLoading = false;

                this.dispatchEvent({type: "error", target: this, message: err.toString()});
            });
    }

    frameAt(frame: number) {
        return this._frames[frame];
    }

    get width() {
        return this._gif?.lsd.width;
    }

    get height() {
        return this._gif?.lsd.height;
    }

    get totalFrames() {
        return this._frames.length;
    }

    get parsedGif() {
        return this._gif;
    }
}

/**
 * Loads the gif and returns a new `GifTexture`
 * @param url the url to the .gif to load
 * @returns
 */
export function THREE_GetGifTexture(url: string): Promise<GifTexture> {
    return new Promise((resolve, reject) => {
        const gif = getGif(url);

        const clean = () => {
            gif.removeEventListener("loaded", onLoaded);
            gif.removeEventListener("error", onLoaded);
        };

        const onLoaded = () => {
            clean();

            const canvas = document.createElement("canvas");
            canvas.width = gif.width ?? 1;
            canvas.height = gif.height ?? 1;

            resolve(new GifTexture(canvas, gif));
        };

        const onError = (err?: unknown) => {
            clean();
            reject(new Error(typeof err === "string" ? err : String(err)));
        };

        if (gif.isLoading) {
            gif.addEventListener("loaded", onLoaded);
            gif.addEventListener("error", onError);
        } else if (gif.hasFailed) {
            onError("Failed to load the gif");
        } else {
            onLoaded();
        }
    });
}

export class GifTexture extends THREE.CanvasTexture {
    private tempCanvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D | null;
    private tmpCtx: CanvasRenderingContext2D | null;
    private frameIndex: number;
    private frameImageData: ImageData | null;
    private _lastFrameTime: number;
    private readonly renderLoopBound: (clock: GifAnimationClock) => void;
    private isRunning: boolean;
    public uuid: string;

    /**
     * @param c Source Canvas that will provide the texture
     * @param gif GIF handler
     * @param play true means it will play the gif frame by frame over time.
     */
    constructor(
        c: HTMLCanvasElement,
        public readonly gif: GifData,
        public play: boolean = true,
    ) {
        super(c);
        this._lastFrameTime = 0;
        this.frameImageData = null;
        this.isRunning = false;

        this.uuid = THREE.MathUtils.generateUUID();
        this.renderLoopBound = this.renderLoop.bind(this);

        this.tempCanvas = document.createElement("canvas");
        this.tmpCtx = this.tempCanvas.getContext("2d");
        this.ctx = this.canvas.getContext("2d");

        //--
        this.frameIndex = 0;

        if (!play) {
            this.renderFrame();
        } else {
            this.start();
        }
    }

    get canvas() {
        return this.source.data;
    }

    /**
     * The frame we are at. Starting from 1 not 0.
     */
    get frame() {
        return this.frameIndex + 1;
    }
    set frame(frameNumber: number) {
        this.frameIndex = Math.min(Math.max(0, frameNumber - 1), this.gif.totalFrames - 1);

        this.renderFrame();
    }

    public start() {
        this.play = true;
        if (this.isRunning) {
            return;
        }
        this.isRunning = true;
        global.app?.on(`animate.GifTexture${this.uuid}`, this.renderLoopBound);
    }

    public stop() {
        this.play = false;
        if (!this.isRunning) {
            return;
        }
        this.isRunning = false;
        global.app?.on(`animate.GifTexture${this.uuid}`, null);
    }

    /**
     * The main render loop of the gif.
     * It will render the frame and call itself back...
     * @param clock
     */
    private renderLoop(clock: GifAnimationClock) {
        if (!this.play) return;
        const frame = this.gif.frameAt(this.frameIndex);
        if (!frame) return;
        const delay = frame.delay;
        const now = clock.getElapsedTime() * 1000;

        if (!this._lastFrameTime) {
            this._lastFrameTime = now;
        }

        if (now < this._lastFrameTime + delay) {
            return;
        }
        this._lastFrameTime = now;
        this.renderFrame();

        this.frameIndex++;

        if (this.frameIndex >= this.gif.totalFrames) {
            this.frameIndex = 0;
        }
    }

    /**
     * Render a frame of the gif to the canvas
     */
    private renderFrame(): ParsedFrame | undefined {
        const frame = this.gif.frameAt(this.frameIndex);
        if (!frame) return undefined;

        if (frame.disposalType === 2) this.ctx?.clearRect(0, 0, Number(this.gif.width), Number(this.gif.height));

        this.drawPatch(frame);

        this.needsUpdate = true; //<-- trigger redraw of the canvas texture

        return frame;
    }

    private drawPatch(frame: ParsedFrame) {
        var dims = frame.dims;

        if (
            !this.frameImageData ||
            dims.width !== this.frameImageData.width ||
            dims.height !== this.frameImageData.height
        ) {
            this.tempCanvas.width = dims.width;
            this.tempCanvas.height = dims.height;
            this.frameImageData = this.tmpCtx?.createImageData(dims.width, dims.height) || null;
        }

        // set the patch data as an override
        this.frameImageData?.data.set(frame.patch);

        // draw the patch back over the canvas
        if (this.frameImageData) {
            this.tmpCtx?.putImageData(this.frameImageData, 0, 0);
        }

        this.ctx?.drawImage(this.tempCanvas, dims.left, dims.top);
    }

    dispose(): void {
        this.stop();
        super.dispose();
    }
}
