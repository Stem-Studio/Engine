import {RenderOrder} from "../../constants/RenderOrder";

type UIKitInitializationModule = Pick<
    typeof import("@ni2khanna/uikit"),
    "initGlyphNodeMaterials" | "initNodeMaterials" | "setDefaultRenderOrder"
>;

let initializationPromise: Promise<void> | null = null;

/**
 * Prepare UIKit's process-wide runtime defaults before any UIKit component is
 * constructed. This initializes the lazy Three.js TSL dependencies and places
 * all UIKit objects on the engine's UI render layer.
 *
 * Keep this bootstrap independent of a renderer instance: both WebGL and
 * WebGPU play paths can evaluate user behavior modules before the built-in HUD
 * exists, and user behaviors may construct UIKit even when the HTML HUD is
 * selected.
 */
export function ensureUIKitRuntimeInitialized(): Promise<void> {
    if (initializationPromise) {
        return initializationPromise;
    }

    initializationPromise = import("@ni2khanna/uikit").then(
        async (uikit: UIKitInitializationModule) => {
            await uikit.initNodeMaterials();
            await uikit.initGlyphNodeMaterials();
            uikit.setDefaultRenderOrder(RenderOrder.UI);
        },
    );

    return initializationPromise;
}
