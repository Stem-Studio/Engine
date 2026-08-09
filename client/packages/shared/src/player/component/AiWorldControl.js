import PlayerComponent from "./PlayerComponent";

class AiWorldControl extends PlayerComponent {
    constructor(app) {
        super(app);
        this.control = null;
    }

    create(scene, camera, renderer, sceneId, player) {
        return this._createControl(scene, camera, renderer, sceneId, player);
    }

    async _createControl(scene, camera, renderer, sceneId, player) {
        const {default: AIWorldController} = await import("../../controls/AiWorldController/AiWorldController");
        this.control = AIWorldController.getInstance(player);
    }

    update(clock, deltaTime) {
        if (this.control && this.control.update) {
            this.control.update(deltaTime);
        }
    }

    dispose() {
        if (this.control) {
            this.control.dispose();
            this.control = null;
        }
    }
}

export default AiWorldControl;
