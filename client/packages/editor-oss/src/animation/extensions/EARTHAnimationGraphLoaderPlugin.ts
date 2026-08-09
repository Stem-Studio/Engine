import {AnimationClip} from "three";
import {GLTFLoaderPlugin, GLTFParser} from "three/addons/loaders/GLTFLoader.js";

import {EARTHAnimationGraphExtension, EARTHAnimationGraphExtensionData} from "./EARTH_animation_graph";
import {AnimationGraph} from "../AnimationGraph";

export class EARTHAnimationGraphLoaderPlugin implements GLTFLoaderPlugin {
    public readonly name = "EARTH_animation_graph";
    private parser: GLTFParser;
    private animationGraph: AnimationGraph | null = null;

    constructor(parser: GLTFParser) {
        this.parser = parser;
    }

    /**
     * Called after the root is loaded
     * @param result
     */
    afterRoot?(result: any): Promise<void> | null {
        return this.processAnimationGraphExtension(result);
    }

    /**
     * Process the EARTH_animation_graph extension
     * @param result
     */
    private async processAnimationGraphExtension(result: any): Promise<void> {
        const json = this.parser.json;

        if (!json.extensions || !json.extensions[EARTHAnimationGraphExtension.EXTENSION_NAME]) {
            return;
        }

        const extensionData = json.extensions[
            EARTHAnimationGraphExtension.EXTENSION_NAME
        ] as EARTHAnimationGraphExtensionData;

        if (!EARTHAnimationGraphExtension.validate(extensionData)) {
            console.warn("Invalid EARTH_animation_graph extension data");
            return;
        }

        try {
            const clipMap: Record<string, AnimationClip> = {};
            result.animations.forEach((clip: AnimationClip) => {
                clipMap[clip.name] = clip;
            });

            const {graph, clips} = EARTHAnimationGraphExtension.deserialize(extensionData, clipMap);

            result.animationGraph = graph;
            result.animationGraphClips = clips;

            console.log(`EARTH_animation_graph extension loaded with ${clips.length} clips`);
        } catch (error) {
            console.error("Error loading EARTH_animation_graph extension:", error);
        }
    }

    /**
     * Get the loaded animation graph
     */
    public getAnimationGraph(): AnimationGraph | null {
        return this.animationGraph;
    }
}
