import {useCallback} from "react";
import {AnimationClip} from "three";
import {GLTFExporter} from "three/addons/exporters/GLTFExporter.js";
import * as WebGLTextureUtils from "three/addons/utils/WebGLTextureUtils.js";
import type {JSONDocument} from "@gltf-transform/core";
import {toast} from "toastywave";

import {AnimationGraph} from "../../../../../animation/AnimationGraph";
import {EARTHAnimationGraphExporterPlugin} from "../../../../../animation/extensions/EARTHAnimationGraphExporterPlugin";
import {useModelAnimationCombinerContext} from "@stem/editor-oss/context";
import {ModelUtils} from "@stem/editor-oss/utils/ModelUtils";

/**
 *
 * @param blob
 * @param filename
 * @param onDone
 */
function save(blob: Blob, filename: string, onDone: () => void) {
    const link = document.createElement("a");
    link.style.display = "none";
    document.body.appendChild(link);
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    onDone();
}

/**
 *
 * @param text
 * @param filename
 * @param onDone
 */
function saveString(text: string, filename: string, onDone: () => void) {
    save(new Blob([text], {type: "text/plain"}), filename, onDone);
}

/**
 *
 * @param buffer
 * @param filename
 * @param onDone
 */
function saveArrayBuffer(buffer: ArrayBuffer, filename: string, onDone: () => void) {
    save(new Blob([buffer], {type: "application/octet-stream"}), filename, onDone);
}

export const useModelExport = () => {
    const {mainModel, animations, toggleLoading, action, animationGraph} = useModelAnimationCombinerContext();

    const exportGLB = useCallback(async () => {
        if (!mainModel) return;
        action?.stop();
        toggleLoading();
        try {
            const exporter = new GLTFExporter();
            exporter.setTextureUtils(WebGLTextureUtils);

            const clips: AnimationClip[] = (animations as unknown as AnimationClip[]) || [];
            if (animationGraph && clips.length > 0) {
                exporter.register(writer => {
                    const plugin = new EARTHAnimationGraphExporterPlugin(writer);
                    plugin.setAnimationData(animationGraph as AnimationGraph, clips);
                    return plugin;
                });
            }

            exporter.parse(
                mainModel,
                async result => {
                    let arrayBuffer = result as ArrayBuffer;
                    arrayBuffer = (await ModelUtils.compressModel(
                        arrayBuffer,
                        {isJSON: false, disableMeshopt: true},
                        () => {
                            toast.warning("Could not compress model");
                        },
                    )) as ArrayBuffer;
                    const name = mainModel.userData?.Name?.split(".")[0] || "model";
                    saveArrayBuffer(arrayBuffer, `${name}.glb`, toggleLoading);
                },
                () => {},
                {trs: true, binary: true, includeCustomExtensions: true, animations: clips},
            );
        } catch {
            toggleLoading();
        }
    }, [mainModel, animations, toggleLoading, action, animationGraph]);

    const exportGLTF = useCallback(() => {
        if (!mainModel) return;
        action?.stop();
        try {
            toggleLoading();
            const exporter = new GLTFExporter();
            exporter.setTextureUtils(WebGLTextureUtils);

            const clips: AnimationClip[] = (animations as unknown as AnimationClip[]) || [];
            if (animationGraph && clips.length > 0) {
                exporter.register(writer => {
                    const plugin = new EARTHAnimationGraphExporterPlugin(writer);
                    plugin.setAnimationData(animationGraph as AnimationGraph, clips);
                    return plugin;
                });
            }

            exporter.parse(
                mainModel.children.length > 0 ? mainModel.children : mainModel,
                async result => {
                    let json = result as unknown as JSONDocument;
                    json = (await ModelUtils.compressModel(
                        json,
                        {isJSON: true, disableMeshopt: true},
                        () => {
                            toast.warning("Could not compress model");
                        },
                    )) as JSONDocument;
                    const output = JSON.stringify(json, null, 2);
                    const name = mainModel.userData?.Name?.split(".")[0] || "model";
                    saveString(output, `${name}.gltf`, toggleLoading);
                },
                () => {},
                {trs: true, binary: false, includeCustomExtensions: true, animations: clips},
            );
        } catch (error) {
            toggleLoading();
            console.error("Export error:", error);
            toast.error("Export failed. Try removing textures or contact support if the issue persists.");
        }
    }, [mainModel, animations, toggleLoading, action, animationGraph]);

    return {exportGLB, exportGLTF};
};
