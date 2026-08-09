import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const hoisted = vi.hoisted(() => ({
    addPanel: vi.fn(),
    panelUpdate: vi.fn(),
    panelUpdateGraph: vi.fn(),
}));

vi.mock('stats-gl', () => {
    class Panel {
        constructor(
            public name: string,
            public foreground: string,
            public background: string,
        ) {}

        update(value: number, max: number, min: number) {
            hoisted.panelUpdate(value, max, min);
        }

        updateGraph(value: number, max: number) {
            hoisted.panelUpdateGraph(value, max);
        }
    }

    class Stats {
        static Panel = Panel;

        addPanel(panel: Panel) {
            hoisted.addPanel(panel);
        }
    }

    return {default: Stats};
});

import Stats from 'stats-gl';
import type {WebGLRenderer} from 'three';

import {DrawcallPanelManager} from './DrawcallPanelManager';
import {RamPanelManager} from './RamPanelManager';

describe('Stats panel managers', () => {
    beforeEach(() => {
        Object.defineProperty(performance, 'memory', {
            configurable: true,
            value: {usedJSHeapSize: 64 * 1024 * 1024},
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        hoisted.addPanel.mockReset();
        hoisted.panelUpdate.mockReset();
        hoisted.panelUpdateGraph.mockReset();
        delete (globalThis as {requestAnimationFrame?: unknown}).requestAnimationFrame;
        delete (globalThis as {cancelAnimationFrame?: unknown}).cancelAnimationFrame;
        delete (performance as Performance & {memory?: unknown}).memory;
    });

    it('cancels RAM panel animation frames on stop', () => {
        const stats = new Stats();
        const requestAnimationFrame = vi.fn(() => 42);
        const cancelAnimationFrame = vi.fn();
        (globalThis as {requestAnimationFrame?: unknown}).requestAnimationFrame = requestAnimationFrame;
        (globalThis as {cancelAnimationFrame?: unknown}).cancelAnimationFrame = cancelAnimationFrame;

        const manager = new RamPanelManager(stats, 4);
        manager.start();
        manager.stop();

        expect(requestAnimationFrame).toHaveBeenCalledWith(expect.any(Function));
        expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
        expect(hoisted.panelUpdate).toHaveBeenCalledWith(64, 64, 0);
    });

    it('restores renderer info autoReset after drawcall panel stop', () => {
        const stats = new Stats();
        const requestAnimationFrame = vi.fn(() => 7);
        const cancelAnimationFrame = vi.fn();
        (globalThis as {requestAnimationFrame?: unknown}).requestAnimationFrame = requestAnimationFrame;
        (globalThis as {cancelAnimationFrame?: unknown}).cancelAnimationFrame = cancelAnimationFrame;
        const renderer = {
            info: {
                autoReset: true,
                render: {calls: 12},
                reset: vi.fn(),
            },
        } as unknown as WebGLRenderer;

        const manager = new DrawcallPanelManager(stats, renderer, 4);
        manager.start();
        manager.stop();

        expect(renderer.info.autoReset).toBe(true);
        expect(renderer.info.reset).toHaveBeenCalledOnce();
        expect(renderer.info.render.calls).toBe(0);
        expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
    });

    it('dispose stops and resets panels idempotently', () => {
        const stats = new Stats();
        const requestAnimationFrame = vi.fn(() => 5);
        const cancelAnimationFrame = vi.fn();
        (globalThis as {requestAnimationFrame?: unknown}).requestAnimationFrame = requestAnimationFrame;
        (globalThis as {cancelAnimationFrame?: unknown}).cancelAnimationFrame = cancelAnimationFrame;

        const manager = new RamPanelManager(stats, 4);
        manager.start();
        manager.dispose();
        manager.dispose();

        expect(cancelAnimationFrame).toHaveBeenCalledTimes(1);
        expect(hoisted.panelUpdate).toHaveBeenLastCalledWith(0, 1, 0);
    });
});
