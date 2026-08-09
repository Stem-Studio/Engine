import Stats from 'stats-gl';
import type { WebGLRenderer } from 'three';

import {RollingMaxWindow} from './RollingMaxWindow';

type StatsPanel = InstanceType<typeof Stats.Panel>;

export class DrawcallPanelManager {
    private panel: StatsPanel;
    private history: RollingMaxWindow;
    private stats: Stats;
    private renderer: WebGLRenderer;
    private running: boolean = false;
    private animationFrameId: number | null = null;
    private previousAutoReset: boolean | null = null;

    constructor(stats: Stats, renderer: WebGLRenderer, maxSamples = 40) {
        this.stats = stats;
        this.renderer = renderer;
        this.history = new RollingMaxWindow(maxSamples, 1);
        this.panel = new Stats.Panel('Drawcalls', '#0ff', '#222');
        this.stats.addPanel(this.panel);
    }

    start() {
        if (this.running) return;
        this.previousAutoReset = this.renderer.info.autoReset;
        this.running = true;
        this.updateLoop();
    }

    stop() {
        this.running = false;
        if (this.animationFrameId !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this.animationFrameId);
        }
        this.animationFrameId = null;

        if (this.previousAutoReset !== null) {
            this.renderer.info.autoReset = this.previousAutoReset;
            this.previousAutoReset = null;
        }
    }

    private updateLoop = () => {
        if (!this.running) return;
        this.animationFrameId = null;
        this.renderer.info.autoReset = false;
        const drawcalls = this.renderer.info.render.calls;

        if (drawcalls > 0) {
            const maxDrawcalls = this.history.push(drawcalls);
            this.panel.update(drawcalls, maxDrawcalls, 0);
            this.panel.updateGraph(drawcalls, maxDrawcalls);
        }

        this.renderer.info.reset();
        this.renderer.info.render.calls = 0;
        if (typeof requestAnimationFrame === 'function') {
            this.animationFrameId = requestAnimationFrame(this.updateLoop);
        }
    };

    reset() {
        this.panel.update(0, 1, 0);
        this.history.clear();
    }

    dispose() {
        this.stop();
        this.reset();
    }
}
