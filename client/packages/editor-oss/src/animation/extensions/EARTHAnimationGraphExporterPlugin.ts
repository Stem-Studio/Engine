import {AnimationClip} from "three";
import {GLTFExporterPlugin, GLTFWriter} from "three/addons/exporters/GLTFExporter.js";

import {EARTHAnimationGraphExtension} from "./EARTH_animation_graph";
import {AnimationGraph} from "../AnimationGraph";

export class EARTHAnimationGraphExporterPlugin implements GLTFExporterPlugin {
    private writer: GLTFWriter;
    private animationGraph: AnimationGraph | null = null;
    private clips: AnimationClip[] = [];

    constructor(writer: GLTFWriter) {
        this.writer = writer;
    }

    /**
     * Set the animation graph and clips to be exported
     * @param graph
     * @param clips
     */
    public setAnimationData(graph: AnimationGraph, clips: AnimationClip[]): void {
        this.animationGraph = graph;
        this.clips = clips;
    }

    /**
     * Called before parsing begins
     */
    beforeParse(): void {
        // No pre-parse work required for this extension.
    }

    /**
     * Called after parsing is complete
     */
    afterParse(): void {
        if (!this.animationGraph || this.clips.length === 0) {
            return;
        }

        const extensionData = EARTHAnimationGraphExtension.serialize(this.animationGraph, this.clips);

        const writer = this.writer as any;
        const json = writer.json;
        if (!json.extensions) {
            json.extensions = {};
        }

        json.extensions[EARTHAnimationGraphExtension.EXTENSION_NAME] = extensionData;

        this.writer.extensionsUsed[EARTHAnimationGraphExtension.EXTENSION_NAME] = true;

        console.log(`EARTH_animation_graph extension exported with ${this.clips.length} clips`);
    }
}
