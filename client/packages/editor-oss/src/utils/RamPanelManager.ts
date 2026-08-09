import Stats from 'stats-gl';

import {RollingMaxWindow} from './RollingMaxWindow';

type StatsPanel = InstanceType<typeof Stats.Panel>;

export class RamPanelManager {
    private panel: StatsPanel;
    private history: RollingMaxWindow;
    private stats: Stats;
    private running: boolean = false;
    private animationFrameId: number | null = null;

    constructor(stats: Stats, maxSamples = 40) {
        this.stats = stats;
        this.history = new RollingMaxWindow(maxSamples, 1);
        this.panel = new Stats.Panel('RAM (MB)', '#ff0', '#222');
        this.stats.addPanel(this.panel);
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.updateLoop();
    }

    stop() {
        this.running = false;
        if (this.animationFrameId !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this.animationFrameId);
        }
        this.animationFrameId = null;
    }

    private updateLoop = () => {
        if (!this.running) return;
        this.animationFrameId = null;

        // Get used JS heap size in MB
        const usedHeapSize = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
        if (usedHeapSize !== undefined) {
            const usedHeapSizeMB = Math.round(usedHeapSize / (1024 * 1024));

            const maxHeapSize = this.history.push(usedHeapSizeMB);
            this.panel.update(usedHeapSizeMB, maxHeapSize, 0);
            this.panel.updateGraph(usedHeapSizeMB, maxHeapSize);
        }

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
