import {Timer} from "three";

/**
 * Clock-compatible adapter backed by THREE.Timer.
 *
 * THREE.Clock is deprecated as of r183, but engine callbacks still receive a
 * clock-shaped object. This preserves that surface while moving runtime timing
 * to Timer.
 */
export class FrameClock {
    autoStart: boolean;
    startTime = 0;
    oldTime = 0;
    elapsedTime = 0;
    running = false;

    private timer = new Timer();
    private documentRef: Document | null = null;

    constructor(autoStart = true) {
        this.autoStart = autoStart;
    }

    connect(documentRef: Document): this {
        this.documentRef = documentRef;
        this.timer.connect(documentRef);
        return this;
    }

    disconnect(): this {
        this.timer.disconnect();
        this.documentRef = null;
        return this;
    }

    start(): void {
        this.replaceTimer();
        this.timer.reset();

        this.startTime = performance.now();
        this.oldTime = this.startTime;
        this.elapsedTime = 0;
        this.running = true;
    }

    stop(): void {
        this.getElapsedTime();
        this.running = false;
        this.autoStart = false;
    }

    getElapsedTime(): number {
        this.getDelta();
        return this.elapsedTime;
    }

    getDelta(): number {
        if (this.autoStart && !this.running) {
            this.start();
            return 0;
        }

        if (!this.running) {
            return 0;
        }

        this.timer.update();
        const delta = this.timer.getDelta();
        this.elapsedTime += delta;
        this.oldTime = this.startTime + this.elapsedTime * 1000;
        return delta;
    }

    dispose(): void {
        this.timer.dispose();
        this.documentRef = null;
    }

    private replaceTimer(): void {
        this.timer.dispose();
        this.timer = new Timer();
        if (this.documentRef) {
            this.timer.connect(this.documentRef);
        }
    }
}

export default FrameClock;
