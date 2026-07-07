import Hls from "hls.js";
import * as THREE from "three";
// import Hls from "@stem/editor-oss/assets/js/hls.js/dist/hls";

type RendererWithCapabilities = {
    capabilities?: {
        getMaxAnisotropy?: () => number;
    };
};

class VideoSource {
    //params
    private readonly url: string;
    private readonly isHLS: boolean;
    private readonly maxAnisotropy;
    private container: HTMLElement;
    private muted: boolean = false;

    //private state
    private elem: HTMLVideoElement | null = null;
    private pendingElem: HTMLVideoElement | null = null;
    private texture: THREE.VideoTexture | null = null;
    private hls: Hls | null = null;
    private released = false;
    private width: number = 0;
    private height: number = 0;

    //audio
    private audioCtx?: AudioContext;
    private gainNode?: GainNode;
    private mediaSource?: MediaElementAudioSourceNode;

    constructor(renderer: RendererWithCapabilities | null | undefined, container: HTMLElement, muted: boolean, url: string) {
        this.container = container;
        this.url = url;
        this.muted = muted;
        this.isHLS = url.includes(".m3u8");
        this.maxAnisotropy = renderer?.capabilities?.getMaxAnisotropy?.() ?? 1;
        const AudioContext = window.AudioContext || (window as Window & { webkitAudioContext?: typeof window.AudioContext }).webkitAudioContext;
        this.audioCtx = new AudioContext();
        this.gainNode = this.audioCtx.createGain();
    }

    public createVideoSource(): Promise<HTMLVideoElement> {
        if (this.elem) {
            return Promise.reject("Video BB: video source is already created");
        }
        this.released = false;
        const elem = document.createElement("video");
        this.pendingElem = elem;
        elem.crossOrigin = "anonymous";
        elem.playsInline = true;
        elem.loop = false;
        elem.muted = true;
        elem.style.width = "1px";
        elem.style.height = "1px";
        elem.style.position = "absolute";
        elem.style.opacity = "0";
        elem.style.zIndex = "-1000";
        elem.style.pointerEvents = "none";
        elem.style.overflow = "hidden";
        const needsPolyfill = this.isHLS && !elem.canPlayType("application/vnd.apple.mpegurl") && Hls.isSupported();
        if (needsPolyfill) {
            this.hls = new Hls();
            this.hls.loadSource(this.url);
            this.hls.attachMedia(elem);
        } else {
            elem.src = this.url;
        }
        //connect audio graph
        this.mediaSource = this.audioCtx!.createMediaElementSource(elem);
        this.mediaSource.connect(this.gainNode!).connect(this.audioCtx!.destination);
        //create video texture
        this.texture = new THREE.VideoTexture(elem);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;
        this.texture.anisotropy = this.maxAnisotropy;
        /**
         *
         * A regular video will load data automatically BUT a stream
         * needs to hit play() before it gets that data.
         *
         * The following code handles this for us, and when streaming
         * will hit play just until we get the data needed, then pause.
         */
        // eslint-disable-next-line no-async-promise-executor
        return new Promise(async (resolve, reject) => {
            let playing = false;
            let data = false;
            elem.addEventListener(
                "loadeddata",
                async () => {
                    if (this.released) {
                        reject(new Error(`Video source was released before load completed: ${this.url}`));
                        return;
                    }
                    // if we needed to hit play to fetch data then revert back to paused
                    //console.log('[video] loadeddata', { playing })
                    if (playing) elem.pause();
                    data = true;
                    // await new Promise(resolve => setTimeout(resolve, 2000))
                    this.width = elem.videoWidth;
                    this.height = elem.videoHeight;
                    this.elem = elem;
                    this.pendingElem = null;
                    this.container.appendChild(this.elem);
                    resolve(elem);
                },
                {once: true},
            );
            elem.addEventListener(
                "loadedmetadata",
                async () => {
                    // we need a gesture before we can potentially hit play
                    // console.log('[video] ready')
                    // await this.engine.driver.gesture
                    // if we already have data do nothing, we're done!
                    //console.log('[video] gesture', { data })
                    if (data) return;
                    // otherwise hit play to force data loading for streams
                    elem.play();
                    playing = true;
                },
                {once: true},
            );
            elem.addEventListener(
                "error",
                () => {
                    reject(new Error(`Video failed to load: ${this.url}`));
                },
                {once: true},
            );
        });
    }

    getTexture() {
        return this.texture;
    }

    getUrl() {
        return this.url;
    }

    isReady() {
        return !!this.elem;
    }

    isPlaying() {
        return (
            this.elem && this.elem.currentTime > 0 && !this.elem.paused && !this.elem.ended && this.elem.readyState > 2
        );
    }

    async play(restartIfPlaying = false) {
        if (!this.elem) {
            console.warn("Video BB: play is requested while video is not ready");
            return;
        }
        if (this.audioCtx!.state === "suspended") {
            void this.audioCtx!.resume();
        }
        if (restartIfPlaying) this.elem.currentTime = 0;
        this.elem.muted = this.muted;
        return this.elem.play();
    }

    pause() {
        if (!this.elem) {
            console.warn("Video BB: pause is requested while video is not ready");
            return;
        }
        this.elem.pause();
        this.elem.muted = true;
        this.gainNode!.gain.value = 0;
    }

    stop() {
        if (!this.elem) {
            console.warn("Video BB: stop is requested while video is not ready");
            return;
        }
        void this.audioCtx!.suspend();
        this.elem.currentTime = 0;
        this.elem.pause();
        this.elem.muted = true;
        this.gainNode!.gain.value = 0;
    }

    release() {
        this.released = true;
        const elem = this.elem ?? this.pendingElem;

        if (elem) {
            elem.pause();
            elem.muted = true;
            elem.removeAttribute("src");
            elem.load();
            elem.remove();
        }

        this.texture?.dispose();
        this.hls?.destroy();
        this.mediaSource?.disconnect();
        this.gainNode?.disconnect();
        void this.audioCtx?.close().catch(() => undefined);

        this.elem = null;
        this.pendingElem = null;
        this.texture = null;
        this.hls = null;
        this.mediaSource = undefined;
        this.gainNode = undefined;
        this.audioCtx = undefined;
        this.width = 0;
        this.height = 0;
    }

    getWidth() {
        return this.width;
    }

    getHeight() {
        return this.height;
    }

    isLoop() {
        if (!this.elem) {
            console.warn("Video BB: get loop is requested while video is not ready");
            return false;
        }
        return this.elem.loop;
    }

    setLoop(value: boolean) {
        if (!this.elem) {
            console.warn("Video BB: set loop is requested while video is not ready");
            return;
        }
        this.elem.loop = value;
    }

    setMuted(muted: boolean) {
        this.muted = muted;
        if (this.elem) {
            this.elem.muted = muted;
        }
    }

    isMuted() {
        return this.muted;
    }

    getCurrentTime() {
        if (!this.elem) {
            console.warn("Video BB: getCurrentTime is requested while video is not ready");
            return -1;
        }
        return this.elem.currentTime;
    }

    setCurrentTime(value: number) {
        if (!this.elem) {
            console.warn("Video BB: getCurrentTime is requested while video is not ready");
            return;
        }
        this.elem.currentTime = value;
    }

    setVolume(volume: number) {
        if (!this.gainNode) return;
        this.gainNode.gain.value = volume;
    }
}

export {VideoSource};
