import {AnimationClip, Object3D, Timer, type Clock} from "three";

import { AnimationGraph } from '@stem/editor-oss/animation/AnimationGraph';
import { AnimationState } from '@stem/editor-oss/animation/AnimationState';
import { BlendTreeState } from '@stem/editor-oss/animation/BlendTreeState';
import GameManager from '@stem/editor-oss/behaviors/game/GameManager';
import {setRuntimeUserDataValue} from "@stem/editor-oss/utils/userDataRuntime";

declare global {
    interface Window {
        AnimationGraph: typeof AnimationGraph;
        AnimationState: typeof AnimationState;
        BlendTreeState: typeof BlendTreeState;
    }
}

window.AnimationGraph = AnimationGraph;
window.AnimationState = AnimationState;
window.BlendTreeState = BlendTreeState;

export type AnimationGraphData = {
    graph: AnimationGraph;
    object: Object3D;
};

export class AnimationGraphController {
    game?: GameManager | null;
    graphs: AnimationGraphData[];
    clock?: Pick<Clock, "getDelta">;
    gameStarted: boolean = false;
    private frameCount = 0;
    private readonly fallbackTimer = new Timer();

    constructor() {
        this.graphs = [];
    }

    start = (gameManager: GameManager) => {
        this.game = gameManager;
        // Optionally listen to game events
    };

    addGraph = (
        object: Object3D,
        serializedGraph: string,
    ) => {
        const wrapped = object as {_obj?: {animations?: AnimationClip[]}};
        const animations =
            (wrapped._obj?.animations?.length ?? 0) > 0
                ? (wrapped._obj?.animations as AnimationClip[])
                : object.animations;

        const clipMap: Record<string, AnimationClip> = {};
        for (const clip of animations) {
            if (clip && clip.name) {
                clipMap[clip.name] = clip;
            }
        }

        const graph = new AnimationGraph(object);
        graph.fromJSON(serializedGraph, clipMap);
        this.graphs.push({ object, graph });

        return graph;
    };

    playGraphState = (object: Object3D, stateId: string, fadeIn: number = 0.2, fadeOut: number = 0.2) => {
        for (let i = 0; i < this.graphs.length; i++) {
            const entry = this.graphs[i];
            if (!entry) continue;
            if (entry.object.uuid === object.uuid) {
                entry.graph.setState(stateId, fadeIn, fadeOut);
                break;
            }
        }
    };

    setParameter = (object: Object3D, name: string, value: number | boolean) => {
        for (let i = 0; i < this.graphs.length; i++) {
            const entry = this.graphs[i];
            if (!entry) continue;
            if (entry.object.uuid === object.uuid) {
                entry.graph.setParameter(name, value);
                break;
            }
        }
    };

    stopGraph = (object: Object3D) => {
        // Optionally implement logic to stop all actions in the graph
        // For now, just remove the graph
        for (let i = 0; i < this.graphs.length; i++) {
            const entry = this.graphs[i];
            if (!entry) continue;
            if (entry.object.uuid === object.uuid) {
                this.graphs.splice(i, 1);
                break;
            }
        }
    };

    update = (clock?: Pick<Clock, "getDelta">, delta?: number) => {
        const dt = this.getFrameDelta(clock, delta);
        this.frameCount++;
        const camera = this.game?.camera;

        for (let i = 0; i < this.graphs.length; i++) {
            const entry = this.graphs[i];
            if (!entry) continue;
            const obj = entry.object;
            if (camera && obj.matrixWorld) {
                const skip = this.getSkipFrames(obj, camera);
                if (skip > 0) {
                    const hash = this.getObjectAnimationHash(obj);
                    if ((this.frameCount + hash) % (skip + 1) !== 0) continue;
                }
            }
            entry.graph.update(dt);
        }
    };

    private getSkipFrames(obj: Object3D, camera: { matrixWorld: { elements: number[] } }): number {
        const e = obj.matrixWorld.elements;
        const ce = camera.matrixWorld.elements;
        const dx = (e[12] ?? 0) - (ce[12] ?? 0), dy = (e[13] ?? 0) - (ce[13] ?? 0), dz = (e[14] ?? 0) - (ce[14] ?? 0);
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq > 10000) return 4;
        if (distSq > 2500) return 1;
        return 0;
    }

    private stableHash(uuid: string): number {
        let h = 0;
        for (let i = 0; i < uuid.length; i++) {
            h = (h << 5) - h + uuid.charCodeAt(i) | 0;
        }
        return Math.abs(h);
    }

    private getObjectAnimationHash(object: Object3D): number {
        let hash = object.userData._animHash;
        if (typeof hash !== "number" || !Number.isFinite(hash)) {
            hash = this.stableHash(object.uuid);
            this.cacheObjectAnimationHash(object, hash);
            return hash;
        }

        if (Object.prototype.propertyIsEnumerable.call(object.userData, "_animHash")) {
            this.cacheObjectAnimationHash(object, hash);
        }
        return hash;
    }

    private cacheObjectAnimationHash(object: Object3D, hash: number): void {
        setRuntimeUserDataValue(object, "_animHash", hash);
    }

    private getFrameDelta(clock?: Pick<Clock, "getDelta">, delta?: number): number {
        if (delta !== undefined) {
            return delta;
        }
        if (clock) {
            return clock.getDelta();
        }
        if (this.clock) {
            return this.clock.getDelta();
        }

        this.fallbackTimer.update();
        return this.fallbackTimer.getDelta();
    }

    dispose = () => {
        this.graphs = [];
        this.fallbackTimer.dispose();
    };
}

export default AnimationGraphController;
