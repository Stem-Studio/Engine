// Dummy ObjectOutliner for backward compatibility. Proxies to event system.
import {Camera, Object3D, Scene} from "three";
import type {WebGLRenderer} from "three";
import global from "@stem/editor-oss/global";

// TODO: This class exists solely for backward compatibility.
// Remove once all legacy usages are migrated to the event-driven outline system.
class ObjectOutliner {
    private hasWarned = false;

    constructor(_scene: Scene, _camera: Camera, _renderer: WebGLRenderer) {
        // No-op: EffectRenderer handles outline logic now
    }

    setOutlinedObjects(objects: Object3D[]) {
        if (!this.hasWarned) {
            console.warn(
                "[DEPRECATED] ObjectOutliner.setOutlinedObjects is deprecated. Use the event system `app.call(\"outlineObjects\", this, objects);` instead.",
            );
            this.hasWarned = true;
        }
        global.app?.call("outlineObjects", this, objects);
    }

    update() {
        // No-op: handled by EffectRenderer
    }

    dispose() {
        // No-op: handled by EffectRenderer
    }
}

export default ObjectOutliner;
