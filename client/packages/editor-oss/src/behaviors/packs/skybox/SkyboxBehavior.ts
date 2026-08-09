import {Mesh} from "three";

import {traverseObjectDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";
import {BehaviorBase} from "../../Behavior";
import GameManager from "../../game/GameManager";

class SkyboxBehavior extends BehaviorBase {
    protected game: GameManager | null = null;

    init(game: GameManager) {
        this.game = game;
        this.scene = game.scene;
    }

    onAdded(): void {
        this.disableSkyboxPhysics();
        this.makeTransparent();
    }

    onEditorAdded(): void {
        this.disableSkyboxPhysics();
        this.makeTransparent();
    }

    private disableSkyboxPhysics(): void {
        if (this.target.userData.physics) {
            this.target.userData.physics.enabled = false;
        }

        this.game?.engine.physics!.removePhysicsObjectBody(this.target);
    }

    private makeTransparent(): void {
        traverseObjectDepthFirst(this.target, child => {
            // Disable shadow casting/receiving on all skybox children
            child.castShadow = false;
            child.receiveShadow = false;

            if (child instanceof Mesh) {
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(mat => {
                            mat.transparent = true;
                        });
                    } else {
                        child.material.transparent = true;
                    }
                }
            }
        });
    }
}

export default SkyboxBehavior;
