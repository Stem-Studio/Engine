import BaseHelper from "./BaseHelper";
import global from "../global";

/**
 * HoverHelper - Highlights objects when the mouse hovers over them
 *
 * This helper provides visual feedback when the user hovers over objects in the scene.
 * It creates a visual highlight effect by rendering the hovered object with a special material or outline.
 */
class HoverHelper extends BaseHelper {
    constructor() {
        super();
        this.hoverEnabled = global.app.storage.hoverEnabled;
        this.hoveredColor = global.app.storage.hoveredColor;

        this.onGpuPick = this.onGpuPick.bind(this);
        this.onObjectRemoved = this.onObjectRemoved.bind(this);
        this.onStorageChanged = this.onStorageChanged.bind(this);
        this.onObjectHovered = this.onObjectHovered.bind(this);
        this.hoveredObject = null;
        this.app = global.app;
    }

    start() {
        global.app.on(`gpuPick.${this.id}`, this.onGpuPick);
        global.app.on(`objectRemoved.${this.id}`, this.onObjectRemoved);
        global.app.on(`storageChanged.${this.id}`, this.onStorageChanged);
        global.app.on(`objectHovered.${this.id}`, this.onObjectHovered);
    }

    stop() {
        global.app.on(`gpuPick.${this.id}`, null);
        global.app.on(`objectRemoved.${this.id}`, null);
        global.app.on(`storageChanged.${this.id}`, null);
        global.app.on(`objectHovered.${this.id}`, null);
        this.setHoveredObject(null);
    }

    onGpuPick(obj) {
        if (!this.hoverEnabled) {
            this.setHoveredObject(null);
            return;
        }

        let object = obj.object;

        if (!object) {
            this.setHoveredObject(null);
            return;
        }

        // Don't apply hover effect to text objects
        if (object.userData && object.userData.type === "text") {
            this.setHoveredObject(null);
            return;
        }

        this.setHoveredObject(object);
    }

    onObjectHovered(object) {
        if (!this.hoverEnabled) {
            this.setHoveredObject(null);
            return;
        }

        // Obsługa eventu "ObjectHovered"
        if (!object) {
            this.setHoveredObject(null);
            return;
        }
        if (object.userData && object.userData.type === "text") {
            this.setHoveredObject(null);
            return;
        }
        this.setHoveredObject(object);
    }

    setHoveredObject(object) {
        if (this.hoveredObject === object) return;

        if (this.hoveredObject) {
            global.app.call("objectUnoutlined", this, this.hoveredObject);
        }

        if (object) {
            global.app.call("objectOutlined", this, object);
        }

        this.hoveredObject = object;
    }

    onObjectRemoved(object) {
        if (object === this.hoveredObject) {
            this.setHoveredObject(null);
        }
    }

    onStorageChanged(key, value) {
        if (key === "hoverEnabled") {
            this.hoverEnabled = value;
            if (!value) {
                this.setHoveredObject(null);
            }
        } else if (key === "hoveredColor") {
            this.hoveredColor = value;
        }
    }
}

export default HoverHelper;
